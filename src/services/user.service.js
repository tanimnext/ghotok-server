import mongoose from 'mongoose';
import { can, isValidEmail, isValidPhone, normalizePhone } from '@ghotok/shared';
import {
  Biodata,
  ConnectionTransaction,
  ContactUnlock,
  Payment,
  Report,
  SupportTicket,
  User,
} from '../models/index.js';
import { toAdminRow } from '../serializers/biodata.serializer.js';
import { toUserDTO } from '../serializers/user.serializer.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/api-error.js';
import { hashPassword } from '../utils/crypto.js';
import { pageParams, paged } from '../utils/pagination.js';
import { escapeRegex } from '../utils/strings.js';
import { recordAudit } from './audit.service.js';
import { notify } from './notification.service.js';
import { revokeAllSessions } from './token.service.js';

// Staff management of accounts: search, roles, suspension, staff creation.

const INACTIVE = ['suspended', 'banned'];

/** Finds a user by id, email or phone number, or throws 404. */
export async function findUserByAny(ref) {
  const s = String(ref ?? '').trim();
  let user = null;
  if (mongoose.isValidObjectId(s)) user = await User.findById(s);
  else if (isValidEmail(s)) user = await User.findOne({ email: s.toLowerCase() });
  else if (isValidPhone(s)) user = await User.findOne({ phone: normalizePhone(s) });
  if (!user) throw notFound('User');
  return user;
}

export async function listUsers({ q, role, status, verified }, query) {
  const filter = {};
  if (role === 'staff') filter.role = { $in: ['support', 'super_admin'] };
  else if (role) filter.role = role;
  if (status) filter.status = status;
  if (verified === 'false') {
    filter.emailVerified = { $ne: true };
    filter.phoneVerified = { $ne: true };
  }
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: re }, { email: re }, { phone: re }];
    const byNumber = await Biodata.findOne({ biodataNo: q.toUpperCase() }).select('user');
    if (byNumber) filter.$or.push({ _id: byNumber.user });
  }
  const params = pageParams(query, { defaultLimit: 20 });
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit),
    User.countDocuments(filter),
  ]);
  const biodatas = await Biodata.find({ user: { $in: users.map((u) => u._id) } })
    .select('user biodataNo status')
    .lean();
  const byUser = new Map(
    biodatas.map((b) => [b.user.toString(), { biodataNo: b.biodataNo, status: b.status }]),
  );
  return paged(
    users.map((u) => ({ ...toUserDTO(u), biodata: byUser.get(u._id.toString()) ?? null })),
    total,
    params,
  );
}

export async function getUserDetail(id) {
  const user = await User.findById(id);
  if (!user) throw notFound('User');
  const [biodata, payments, ledger, unlocks, tickets, reportsAgainst] = await Promise.all([
    Biodata.findOne({ user: user._id }),
    Payment.find({ user: user._id }).sort({ createdAt: -1 }).limit(10).lean(),
    ConnectionTransaction.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('biodata', 'biodataNo')
      .populate('actor', 'name')
      .lean(),
    ContactUnlock.countDocuments({ user: user._id }),
    SupportTicket.countDocuments({ user: user._id }),
    Report.countDocuments({ targetUser: user._id }),
  ]);
  return {
    user: { ...toUserDTO(user), statusReason: user.statusReason ?? null },
    biodata: biodata ? toAdminRow(biodata) : null,
    payments: payments.map((p) => ({
      id: p._id,
      invoiceNo: p.invoiceNo,
      amount: p.amount,
      connections: p.connections,
      method: p.method,
      status: p.status,
      trxId: p.trxId ?? null,
      createdAt: p.createdAt,
    })),
    ledger: ledger.map((t) => ({
      id: t._id,
      type: t.type,
      delta: t.delta,
      balanceAfter: t.balanceAfter,
      reason: t.reason ?? null,
      biodataNo: t.biodata?.biodataNo ?? null,
      actor: t.actor?.name ?? null,
      createdAt: t.createdAt,
    })),
    counts: { unlocks, tickets, reportsAgainst },
  };
}

async function assertUnique(field, value, exceptId) {
  if (value && (await User.exists({ [field]: value, _id: { $ne: exceptId } }))) {
    throw conflict(
      'DUPLICATE',
      `Another account uses this ${field === 'email' ? 'email' : 'mobile number'}.`,
    );
  }
}

/**
 * Updates an account. Changing a role needs `roles.assign`; staff cannot demote or
 * suspend themselves. Suspending or banning hides the biodata and signs the user out.
 */
export async function updateUser(id, data, ctx) {
  const user = await User.findById(id);
  if (!user) throw notFound('User');
  const self = user._id.equals(ctx.actor._id);
  if (self && data.role && data.role !== user.role)
    throw forbidden('SELF_ROLE', 'You cannot change your own role.');
  if (self && data.status && data.status !== 'active')
    throw forbidden('SELF_STATUS', 'You cannot suspend your own account.');
  if (data.role && data.role !== user.role && !can(ctx.actor.role, 'roles.assign')) throw forbidden();

  if (data.email !== undefined) {
    await assertUnique('email', data.email, user._id);
    user.email = data.email ?? undefined;
  }
  if (data.phone !== undefined) {
    await assertUnique('phone', data.phone, user._id);
    user.phone = data.phone ?? undefined;
  }
  if (!user.email && !user.phone) {
    throw badRequest('VALIDATION_ERROR', 'An account needs an email or a mobile number.', {
      fields: { email: 'required' },
    });
  }
  const before = { role: user.role, status: user.status };
  for (const key of ['name', 'role', 'status', 'statusReason', 'emailVerified', 'phoneVerified']) {
    if (data[key] !== undefined) user[key] = data[key];
  }
  await user.save();

  if (data.status && data.status !== before.status) {
    const inactive = INACTIVE.includes(data.status);
    await Biodata.updateOne({ user: user._id }, { blocked: inactive });
    if (inactive) await revokeAllSessions(user._id);
    await recordAudit(ctx, 'user.status', {
      targetType: 'user',
      targetId: user._id,
      summary: `${user.name}: ${before.status} → ${data.status}`,
      meta: { reason: data.statusReason },
    });
  }
  if (data.role && data.role !== before.role) {
    await revokeAllSessions(user._id);
    await recordAudit(ctx, 'user.role', {
      targetType: 'user',
      targetId: user._id,
      summary: `${user.name}: ${before.role} → ${data.role}`,
    });
  }
  await recordAudit(ctx, 'user.update', {
    targetType: 'user',
    targetId: user._id,
    summary: `Updated ${user.name}`,
    meta: Object.keys(data),
  });
  return toUserDTO(user);
}

/** Creates an account from the admin panel (usually a staff member). It is treated as verified. */
export async function createUser({ name, email, phone, password, role }, ctx) {
  if (role !== 'user' && !can(ctx.actor.role, 'roles.assign')) throw forbidden();
  const or = [email && { email }, phone && { phone }].filter(Boolean);
  if (await User.exists({ $or: or }))
    throw conflict('ACCOUNT_EXISTS', 'An account with this email or mobile number already exists.');
  const user = await User.create({
    name,
    email,
    phone,
    role,
    passwordHash: await hashPassword(password),
    emailVerified: !!email,
    phoneVerified: !!phone,
  });
  await recordAudit(ctx, 'user.create', {
    targetType: 'user',
    targetId: user._id,
    summary: `Created ${role} ${user.name}`,
  });
  return toUserDTO(user);
}

export async function resetUserPassword(id, password, ctx) {
  const user = await User.findById(id);
  if (!user) throw notFound('User');
  user.passwordHash = await hashPassword(password);
  await user.save();
  await revokeAllSessions(user._id);
  await notify(user._id, 'password_reset_by_staff', {});
  await recordAudit(ctx, 'user.reset_password', {
    targetType: 'user',
    targetId: user._id,
    summary: `Reset password of ${user.name}`,
  });
}
