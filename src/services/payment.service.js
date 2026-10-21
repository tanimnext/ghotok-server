import { PAYMENT_METHODS } from '@ghotok/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { gatewayFor, gateways } from '../integrations/payments/index.js';
import { Biodata, Package, Payment, RefundRequest, nextSequence } from '../models/index.js';
import { toPackageDTO, toPaymentDTO } from '../serializers/payment.serializer.js';
import { toUserSummary } from '../serializers/user.serializer.js';
import { ApiError, badRequest, conflict, notFound } from '../utils/api-error.js';
import { pageParams, paged, paginate } from '../utils/pagination.js';
import { escapeRegex } from '../utils/strings.js';
import { recordAudit } from './audit.service.js';
import { creditPayment } from './connection.service.js';
import { notify } from './notification.service.js';
import { getSetting } from './settings.service.js';

// Buying connection packages with bKash, Nagad or Rocket.
// Manual mode: the customer sends money and submits the transaction ID; staff verify it.
// Gateway mode: online checkout (bKash Tokenized Checkout / Nagad), credited on the callback.

const MAX_PENDING_MANUAL = 3;

/** Payment methods with their manual "Send Money" numbers and whether online checkout is available. */
export async function paymentMethods() {
  const settings = await getSetting('payments');
  return {
    verificationHours: settings.verificationHours,
    methods: PAYMENT_METHODS.map((m) => {
      const gateway = !!gateways[m.value]?.enabled;
      return {
        value: m.value,
        en: m.en,
        bn: m.bn,
        // A gateway-only method (SSLCommerz) is offered only when its gateway is configured.
        enabled: settings[m.value]?.enabled !== false && (!m.gatewayOnly || gateway),
        gatewayOnly: !!m.gatewayOnly,
        manualNumber: m.gatewayOnly ? null : settings[m.value]?.manualNumber || null,
        accountType: settings[m.value]?.accountType ?? 'personal',
        gateway,
      };
    }),
  };
}

/** The member's package discount in percent: members whose biodata is live may get one (site setting). */
export async function discountFor(user) {
  if (!user) return 0;
  const { approvedDiscountPercent = 0 } = await getSetting('payments');
  if (approvedDiscountPercent <= 0) return 0;
  const approved = await Biodata.exists({ user: user._id, status: 'approved', deletedAt: null });
  return approved ? Math.min(90, approvedDiscountPercent) : 0;
}

const discounted = (price, percent) => Math.round(price * (1 - percent / 100));

/** Active packages and payment methods; for a member with a discount, the price they pay. */
export async function catalogue(user) {
  const [packages, discount] = await Promise.all([
    Package.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }),
    discountFor(user),
  ]);
  return {
    packages: packages.map((p) => ({
      ...toPackageDTO(p),
      ...(discount ? { discountPercent: discount, finalPrice: discounted(p.price, discount) } : {}),
    })),
    ...(await paymentMethods()),
  };
}

async function nextInvoiceNo() {
  const d = new Date();
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
  return `INV-${ymd}-${await nextSequence('invoice', 10000)}`;
}

/**
 * Starts a purchase.
 * @returns {Promise<{ payment: object, redirectURL?: string }>} redirectURL for gateway checkout
 */
export async function createPayment(user, { packageId, method, mode, senderNumber, trxId }, { ip } = {}) {
  const pkg = await Package.findOne({ _id: packageId, isActive: true });
  if (!pkg) throw notFound('Package');
  const { methods } = await paymentMethods();
  const chosen = methods.find((m) => m.value === method);
  if (!chosen?.enabled || (chosen.gatewayOnly && mode !== 'gateway')) {
    throw badRequest('METHOD_DISABLED', 'This payment method is not available right now.');
  }
  const discount = await discountFor(user);
  const base = {
    user: user._id,
    package: pkg._id,
    packageName: pkg.name,
    connections: pkg.connections,
    amount: discounted(pkg.price, discount),
    method,
    invoiceNo: await nextInvoiceNo(),
  };
  return mode === 'gateway'
    ? startGatewayCheckout(base, { ip, user })
    : submitManualPayment(user, base, { senderNumber, trxId });
}

async function startGatewayCheckout(base, { ip, user }) {
  const gateway = gatewayFor(base.method);
  if (!gateway) {
    throw badRequest(
      'GATEWAY_UNAVAILABLE',
      'Online checkout is not available for this method. Please use Send Money.',
    );
  }
  const payment = await Payment.create({ ...base, mode: 'gateway', status: 'initiated' });
  try {
    const started = await gateway.startCheckout(payment, {
      callbackURL: `${env.API_PUBLIC_URL}/api/payments/${base.method}/callback`,
      // Gateways that post the result back (SSLCommerz) use these instead.
      returnURL: `${env.API_PUBLIC_URL}/api/gateway/${base.method}/return`,
      ipnURL: `${env.API_PUBLIC_URL}/api/gateway/${base.method}/ipn`,
      customer: { name: user.name, email: user.email, phone: user.phone },
      ip,
    });
    payment.gateway = { paymentId: started.paymentId, response: started.raw };
    await payment.save();
    return { payment: toPaymentDTO(payment), redirectURL: started.redirectURL };
  } catch (err) {
    logger.error({ err, invoice: payment.invoiceNo }, 'Gateway checkout failed to start');
    payment.status = 'failed';
    await payment.save();
    throw new ApiError(
      502,
      'GATEWAY_ERROR',
      'The payment gateway is not responding. Please try again or use Send Money.',
    );
  }
}

async function submitManualPayment(user, base, { senderNumber, trxId }) {
  if (
    await Payment.exists({ method: base.method, trxId, status: { $in: ['pending', 'verified', 'refunded'] } })
  ) {
    throw conflict('DUPLICATE_TRX', 'This transaction ID has already been submitted.');
  }
  const pending = await Payment.countDocuments({ user: user._id, mode: 'manual', status: 'pending' });
  if (pending >= MAX_PENDING_MANUAL) {
    throw new ApiError(
      429,
      'TOO_MANY_PENDING',
      `You already have ${MAX_PENDING_MANUAL} payments waiting for verification.`,
    );
  }
  const payment = await Payment.create({ ...base, mode: 'manual', status: 'pending', senderNumber, trxId });
  return { payment: toPaymentDTO(payment) };
}

/**
 * Handles the customer's return from bKash/Nagad. The gateway's own status API is
 * authoritative; the amount must match before connections are credited.
 * @returns {Promise<{ status: 'success' | 'failed' | 'cancelled', invoiceNo?: string }>}
 */
export async function completeGatewayCheckout(method, query) {
  const gateway = gatewayFor(method);
  if (!gateway) return { status: 'failed' };
  let result;
  try {
    result = await gateway.completeCheckout(query);
  } catch (err) {
    logger.error({ err, method }, 'Gateway callback failed');
    return { status: 'failed' };
  }
  const payment = result.paymentId
    ? await Payment.findOne({ 'gateway.paymentId': result.paymentId, method })
    : null;
  if (!payment) return { status: 'failed' };
  if (payment.status === 'verified') return { status: 'success', invoiceNo: payment.invoiceNo };

  const amountMatches = result.amount === undefined || Math.abs(result.amount - payment.amount) < 0.01;
  if (result.success && amountMatches) {
    await creditPayment(payment._id, { trxId: result.trxId, gatewayResponse: result.raw });
    return { status: 'success', invoiceNo: payment.invoiceNo };
  }
  const status = result.cancelled ? 'cancelled' : 'failed';
  await Payment.updateOne(
    { _id: payment._id, status: 'initiated' },
    { status, 'gateway.response': result.raw },
  );
  return { status, invoiceNo: payment.invoiceNo };
}

/** One of the member's payments by invoice number, for the receipt page. */
export async function paymentStatus(user, invoiceNo) {
  const payment = await Payment.findOne({ user: user._id, invoiceNo });
  if (!payment) throw notFound('Payment');
  return toPaymentDTO(payment);
}

/** A member's payments, each with its latest refund request. */
export async function myPayments(user, query) {
  const params = pageParams(query, { defaultLimit: 20 });
  const filter = { user: user._id, status: { $ne: 'initiated' } };
  const [items, total] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit),
    Payment.countDocuments(filter),
  ]);
  const refunds = await RefundRequest.find({ payment: { $in: items.map((i) => i._id) } })
    .sort({ createdAt: -1 })
    .lean();
  const refundOf = new Map();
  for (const r of refunds) {
    const key = r.payment.toString();
    if (!refundOf.has(key))
      refundOf.set(key, { id: r._id, status: r.status, resolution: r.resolution ?? null });
  }
  return paged(
    items.map((p) => ({ ...toPaymentDTO(p), refund: refundOf.get(p._id.toString()) ?? null })),
    total,
    params,
  );
}

// ----- Staff -------------------------------------------------------------------

export function listPayments({ status, method, mode, q }, query) {
  const filter = { status: status ?? { $ne: 'initiated' } };
  if (method) filter.method = method;
  if (mode) filter.mode = mode;
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ invoiceNo: re }, { trxId: re }, { senderNumber: re }];
  }
  return paginate(
    Payment.find(filter)
      .sort({ createdAt: status === 'pending' ? 1 : -1 })
      .populate('user', 'name email phone role status')
      .populate('reviewedBy', 'name'),
    Payment.countDocuments(filter),
    pageParams(query, { defaultLimit: 20 }),
    (p) => ({
      ...toPaymentDTO(p),
      user: toUserSummary(p.user),
      reviewedBy: p.reviewedBy?.name ?? null,
      reviewedAt: p.reviewedAt ?? null,
    }),
  );
}

export async function verifyPayment(id, ctx) {
  const payment = await creditPayment(id, { actor: ctx.actor._id });
  if (!payment) throw conflict('NOT_PENDING', 'This payment has already been processed.');
  await recordAudit(ctx, 'payment.verify', {
    targetType: 'payment',
    targetId: payment._id,
    summary: `Verified ${payment.invoiceNo} (${payment.method} ${payment.trxId ?? ''}) +${payment.connections}`,
  });
  return toPaymentDTO(payment);
}

export async function rejectPayment(id, reason, ctx) {
  const payment = await Payment.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { status: 'rejected', rejectReason: reason, reviewedBy: ctx.actor._id, reviewedAt: new Date() },
    { new: true },
  );
  if (!payment) throw conflict('NOT_PENDING', 'This payment has already been processed.');
  await notify(
    payment.user,
    'payment_rejected',
    { invoiceNo: payment.invoiceNo, reason },
    '/dashboard/connections',
  );
  await recordAudit(ctx, 'payment.reject', {
    targetType: 'payment',
    targetId: payment._id,
    summary: `Rejected ${payment.invoiceNo}`,
    meta: { reason },
  });
  return toPaymentDTO(payment);
}
