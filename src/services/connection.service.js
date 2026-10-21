import { photoUrl } from '../integrations/storage/index.js';
import { logger } from '../config/logger.js';
import { Biodata, ConnectionTransaction, ContactUnlock, Payment, User } from '../models/index.js';
import { toContact } from '../serializers/biodata.serializer.js';
import { toLedgerEntryDTO } from '../serializers/payment.serializer.js';
import { toUserSummary } from '../serializers/user.serializer.js';
import { ApiError, notFound } from '../utils/api-error.js';
import { pageParams, paged, paginate } from '../utils/pagination.js';
import { recordAudit } from './audit.service.js';
import { assertNotOwn, findPublic } from './biodata.service.js';
import { notify } from './notification.service.js';
import { findUserByAny } from './user.service.js';

// The connection ledger. `User.connectionBalance` is changed only through
// changeBalance(), which uses atomic conditional updates (no transactions needed)
// and writes one ConnectionTransaction per change.

/**
 * Atomically changes a balance and records it.
 * Negative changes never take a balance below zero: they fail with 402, or with
 * `clamp` remove only what is left.
 * @returns {Promise<{ user: object, applied: number, transaction: object | null }>}
 */
export async function changeBalance(
  userId,
  delta,
  { type, reason, payment, biodata, refund, actor, clamp = false } = {},
) {
  if (!Number.isInteger(delta) || delta === 0)
    throw new ApiError(400, 'BAD_QUANTITY', 'Quantity must be a whole number.');
  let applied = delta;
  const inc = { connectionBalance: delta };
  if (type === 'unlock') inc.connectionsUsed = 1;
  if (type === 'purchase') inc.connectionsPurchased = delta;

  let user;
  if (delta > 0) {
    user = await User.findByIdAndUpdate(userId, { $inc: inc }, { new: true });
  } else {
    user = await User.findOneAndUpdate(
      { _id: userId, connectionBalance: { $gte: -delta } },
      { $inc: inc },
      { new: true },
    );
    if (!user && clamp) {
      const current = await User.findById(userId);
      if (!current) throw notFound('User');
      if (current.connectionBalance === 0) return { user: current, applied: 0, transaction: null };
      applied = -current.connectionBalance;
      user = await User.findOneAndUpdate(
        { _id: userId, connectionBalance: current.connectionBalance },
        { $inc: { connectionBalance: applied } },
        { new: true },
      );
    }
  }
  if (!user) {
    if (!(await User.exists({ _id: userId }))) throw notFound('User');
    throw new ApiError(
      402,
      'INSUFFICIENT_CONNECTIONS',
      'You do not have enough connections. Please buy a package.',
    );
  }
  const transaction = await ConnectionTransaction.create({
    user: userId,
    type,
    delta: applied,
    balanceAfter: user.connectionBalance,
    reason,
    payment,
    biodata,
    refund,
    actor,
  });
  return { user, applied, transaction };
}

/**
 * Marks a payment verified and credits its connections exactly once — safe when
 * two admins, or an admin and a gateway callback, act at the same moment.
 * @returns {Promise<object | null>} the payment, or null if it was already processed
 */
export async function creditPayment(paymentId, { actor, trxId, gatewayResponse } = {}) {
  const set = { status: 'verified', creditedAt: new Date(), reviewedAt: new Date() };
  if (actor) set.reviewedBy = actor;
  if (trxId) set.trxId = trxId;
  if (gatewayResponse) set['gateway.response'] = gatewayResponse;
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: { $in: ['initiated', 'pending'] }, creditedAt: null },
    { $set: set },
    { new: true },
  );
  if (!payment) return null;
  try {
    await changeBalance(payment.user, payment.connections, {
      type: 'purchase',
      payment: payment._id,
      actor,
      reason: payment.invoiceNo,
    });
  } catch (err) {
    // Put the payment back so it can be verified again.
    await Payment.updateOne({ _id: payment._id }, { $set: { status: 'pending' }, $unset: { creditedAt: 1 } });
    logger.error({ err, payment: payment.invoiceNo }, 'Crediting a payment failed');
    throw err;
  }
  await notify(
    payment.user,
    'payment_verified',
    { invoiceNo: payment.invoiceNo, connections: payment.connections },
    '/dashboard/connections',
  );
  return payment;
}

/**
 * Unlocks a biodata's guardian contact, charging one connection the first time
 * only. The unique (user, biodata) index makes double clicks and parallel
 * requests safe: the unlock row is created first, then the balance is charged.
 */
export async function unlockContact(user, biodataNo) {
  const b = await findPublic(biodataNo);
  assertNotOwn(b, user);
  const result = await unlockOnce(user, b);
  if (result.charged) await notify(b.user, 'contact_unlocked', { biodataNo: b.biodataNo });
  const showPhoto = !!b.photo?.imageId && b.photo.visibility !== 'hidden';
  return {
    unlocked: true,
    charged: result.charged,
    balance: result.balance,
    contact: toContact(b),
    photoUrl: showPhoto ? photoUrl(b.photo) : null,
  };
}

async function unlockOnce(user, biodata) {
  const existing = await ContactUnlock.findOne({ user: user._id, biodata: biodata._id });
  if (existing) return { charged: false, balance: user.connectionBalance };
  let unlock;
  try {
    unlock = await ContactUnlock.create({ user: user._id, biodata: biodata._id });
  } catch (err) {
    if (err?.code === 11000) return { charged: false, balance: user.connectionBalance };
    throw err;
  }
  try {
    const { user: updated, transaction } = await changeBalance(user._id, -1, {
      type: 'unlock',
      biodata: biodata._id,
      reason: biodata.biodataNo,
    });
    unlock.transaction = transaction._id;
    await unlock.save();
    await Biodata.updateOne({ _id: biodata._id }, { $inc: { 'stats.unlocks': 1 } });
    return { charged: true, balance: updated.connectionBalance };
  } catch (err) {
    await ContactUnlock.deleteOne({ _id: unlock._id });
    throw err;
  }
}

/** A member's balance and connection history. */
export async function myConnections(user, query) {
  const params = pageParams(query, { defaultLimit: 20 });
  const filter = { user: user._id };
  const [ledger, total] = await Promise.all([
    ConnectionTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(params.skip)
      .limit(params.limit)
      .populate('biodata', 'biodataNo')
      .populate('payment', 'invoiceNo method')
      .lean(),
    ConnectionTransaction.countDocuments(filter),
  ]);
  return {
    balance: user.connectionBalance,
    purchased: user.connectionsPurchased,
    used: user.connectionsUsed,
    ledger: paged(ledger.map(toLedgerEntryDTO), total, params),
  };
}

const ADJUSTMENT_TYPES = { grant: 'admin_grant', revoke: 'admin_revoke', refund_credit: 'refund_credit' };

/** Staff: grant, revoke or refund connections by hand. The reason is kept in the audit log. */
export async function adjustConnections({ user: ref, action, quantity, reason }, ctx) {
  const user = await findUserByAny(ref);
  const delta = action === 'revoke' ? -quantity : quantity;
  const { user: updated, transaction } = await changeBalance(user._id, delta, {
    type: ADJUSTMENT_TYPES[action],
    actor: ctx.actor._id,
    reason,
  });
  await notify(
    user._id,
    'connections_adjusted',
    { delta, balance: updated.connectionBalance, reason },
    '/dashboard/connections',
  );
  await recordAudit(ctx, `connections.${action}`, {
    targetType: 'user',
    targetId: user._id,
    summary: `${delta > 0 ? '+' : ''}${delta} connections for ${user.name}`,
    meta: { reason },
  });
  return { user: toUserSummary(updated), balance: updated.connectionBalance, transactionId: transaction._id };
}

/** Staff: the ledger across all users, optionally for one user or one type. */
export async function listLedger({ user, type }, query) {
  const filter = {};
  if (user) filter.user = (await findUserByAny(user))._id;
  if (type) filter.type = type;
  return paginate(
    ConnectionTransaction.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'name email phone role status')
      .populate('actor', 'name')
      .populate('biodata', 'biodataNo')
      .populate('payment', 'invoiceNo')
      .lean(),
    ConnectionTransaction.countDocuments(filter),
    pageParams(query, { defaultLimit: 25 }),
    (t) => ({ ...toLedgerEntryDTO(t), user: toUserSummary(t.user), actor: t.actor?.name ?? null }),
  );
}
