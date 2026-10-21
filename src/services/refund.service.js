import { Payment, RefundRequest } from '../models/index.js';
import { toPaymentDTO } from '../serializers/payment.serializer.js';
import { toUserSummary } from '../serializers/user.serializer.js';
import { conflict, notFound } from '../utils/api-error.js';
import { pageParams, paginate } from '../utils/pagination.js';
import { recordAudit } from './audit.service.js';
import { changeBalance } from './connection.service.js';
import { notify } from './notification.service.js';

// Refunds have two resolutions:
// - connection_credit: connections are added (e.g. a payment that could not be verified)
// - money_back: money is returned outside the system and the purchased, still unused
//   connections are taken back; the payment becomes "refunded".

const REFUNDABLE = ['verified', 'rejected', 'pending'];

export async function requestRefund(user, { paymentId, reason }) {
  const payment = await Payment.findOne({ _id: paymentId, user: user._id });
  if (!payment) throw notFound('Payment');
  if (!REFUNDABLE.includes(payment.status))
    throw conflict('NOT_REFUNDABLE', 'This payment cannot be refunded.');
  if (await RefundRequest.exists({ payment: payment._id, status: 'pending' })) {
    throw conflict('ALREADY_REQUESTED', 'A refund request for this payment is already pending.');
  }
  const refund = await RefundRequest.create({ user: user._id, payment: payment._id, reason });
  return { id: refund._id, status: refund.status };
}

export function myRefunds(user) {
  return RefundRequest.find({ user: user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('payment', 'invoiceNo amount method')
    .lean();
}

export function listRefunds({ status }, query) {
  const filter = status ? { status } : {};
  return paginate(
    RefundRequest.find(filter)
      .sort({ createdAt: status === 'pending' ? 1 : -1 })
      .populate('user', 'name email phone role status connectionBalance')
      .populate('payment')
      .populate('decidedBy', 'name'),
    RefundRequest.countDocuments(filter),
    pageParams(query, { defaultLimit: 20 }),
    (r) => ({
      id: r._id,
      status: r.status,
      reason: r.reason,
      resolution: r.resolution ?? null,
      connections: r.connections ?? null,
      amount: r.amount ?? null,
      refundTrxId: r.refundTrxId ?? null,
      note: r.note ?? null,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt ?? null,
      decidedBy: r.decidedBy?.name ?? null,
      user: r.user ? { ...toUserSummary(r.user), connectionBalance: r.user.connectionBalance } : null,
      payment: r.payment ? toPaymentDTO(r.payment) : null,
    }),
  );
}

export async function approveRefund(id, { resolution, connections, amount, refundTrxId, note }, ctx) {
  // Claim the request first so two admins cannot approve it twice.
  const refund = await RefundRequest.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { status: 'approved', decidedBy: ctx.actor._id, decidedAt: new Date() },
    { new: true },
  );
  if (!refund) throw conflict('NOT_PENDING', 'This refund request has already been decided.');
  const payment = await Payment.findById(refund.payment);
  const ledger = { payment: payment._id, refund: refund._id, actor: ctx.actor._id };
  try {
    if (resolution === 'connection_credit') {
      const qty = connections ?? payment.connections;
      if (qty > 0)
        await changeBalance(refund.user, qty, {
          ...ledger,
          type: 'refund_credit',
          reason: note ?? `Refund credit for ${payment.invoiceNo}`,
        });
      Object.assign(refund, { resolution, connections: qty, note });
    } else {
      const qty = connections ?? (payment.status === 'verified' ? payment.connections : 0);
      let revoked = 0;
      if (qty > 0) {
        const r = await changeBalance(refund.user, -qty, {
          ...ledger,
          type: 'refund_revoke',
          reason: note ?? `Refund of ${payment.invoiceNo}`,
          clamp: true,
        });
        revoked = -r.applied;
      }
      payment.status = 'refunded';
      payment.refundedAt = new Date();
      await payment.save();
      Object.assign(refund, {
        resolution,
        connections: revoked,
        amount: amount ?? payment.amount,
        refundTrxId,
        note,
      });
    }
    await refund.save();
  } catch (err) {
    await RefundRequest.updateOne(
      { _id: refund._id },
      { status: 'pending', $unset: { decidedBy: 1, decidedAt: 1 } },
    );
    throw err;
  }
  await notify(
    refund.user,
    'refund_approved',
    { invoiceNo: payment.invoiceNo, resolution, connections: refund.connections, amount: refund.amount },
    '/dashboard/connections',
  );
  await recordAudit(ctx, 'refund.approve', {
    targetType: 'refund',
    targetId: refund._id,
    summary: `Refund for ${payment.invoiceNo}: ${resolution}`,
    meta: { resolution, connections, amount, refundTrxId, note },
  });
}

export async function rejectRefund(id, note, ctx) {
  const refund = await RefundRequest.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { status: 'rejected', note, decidedBy: ctx.actor._id, decidedAt: new Date() },
    { new: true },
  ).populate('payment', 'invoiceNo');
  if (!refund) throw conflict('NOT_PENDING', 'This refund request has already been decided.');
  await notify(
    refund.user,
    'refund_rejected',
    { invoiceNo: refund.payment?.invoiceNo, note },
    '/dashboard/connections',
  );
  await recordAudit(ctx, 'refund.reject', {
    targetType: 'refund',
    targetId: refund._id,
    summary: `Rejected refund for ${refund.payment?.invoiceNo}`,
  });
}
