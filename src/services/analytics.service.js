import { can } from '@ghotok/shared';
import {
  Biodata,
  ConnectionTransaction,
  ContactMessage,
  Payment,
  ProfileVisit,
  RefundRequest,
  Report,
  RestoreRequest,
  SupportTicket,
  User,
} from '../models/index.js';
import { toAdminRow } from '../serializers/biodata.serializer.js';
import { toPaymentDTO } from '../serializers/payment.serializer.js';
import { toUserSummary } from '../serializers/user.serializer.js';

// Admin overview (work queues) and analytics (time series and breakdowns).
// Days are grouped in Bangladesh time.

const TZ = 'Asia/Dhaka';
const LIVE = { status: 'approved', deletedAt: null, isHidden: false, blocked: { $ne: true } };

/** Work queues for the admin overview. Finance figures only for staff allowed to see payments. */
export async function adminOverview(actor) {
  const [
    pendingBiodatas,
    pendingNid,
    openReports,
    pendingRestores,
    openTickets,
    newMessages,
    reports,
    restores,
    biodatas,
  ] = await Promise.all([
    Biodata.countDocuments({ status: 'pending', deletedAt: null }),
    Biodata.countDocuments({ 'nid.status': 'pending', deletedAt: null }),
    Report.countDocuments({ status: { $in: ['open', 'in_review'] } }),
    RestoreRequest.countDocuments({ status: 'pending' }),
    SupportTicket.countDocuments({ status: { $in: ['open', 'waiting'] } }),
    ContactMessage.countDocuments({ status: 'new' }),
    Report.find({ status: { $in: ['open', 'in_review'] } })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('biodata', 'biodataNo')
      .populate('targetUser', 'name')
      .lean(),
    RestoreRequest.find({ status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(5)
      .populate('biodata', 'biodataNo deletedAt')
      .lean(),
    Biodata.find({ status: 'pending', deletedAt: null })
      .sort({ submittedAt: 1 })
      .limit(5)
      .populate('user', 'name email phone role status'),
  ]);
  const overview = {
    kpis: { pendingBiodatas, pendingNid, openReports, pendingRestores, openTickets, newMessages },
    reports: reports.map((r) => ({
      id: r._id,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
      biodataNo: r.biodata?.biodataNo ?? null,
      targetName: r.targetUser?.name ?? null,
    })),
    restores: restores.map((r) => ({
      id: r._id,
      createdAt: r.createdAt,
      biodataNo: r.biodata?.biodataNo ?? null,
      deletedAt: r.biodata?.deletedAt ?? null,
    })),
    biodatas: biodatas.map(toAdminRow),
  };
  if (can(actor.role, 'payments.manage')) {
    const since30 = new Date(Date.now() - 30 * 864e5);
    const [pendingPayments, pendingRefunds, revenue, payments] = await Promise.all([
      Payment.countDocuments({ status: 'pending' }),
      RefundRequest.countDocuments({ status: 'pending' }),
      Payment.aggregate([
        { $match: { status: 'verified', creditedAt: { $gte: since30 } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payment.find({ status: 'pending' })
        .sort({ createdAt: 1 })
        .limit(6)
        .populate('user', 'name email phone role status'),
    ]);
    Object.assign(overview.kpis, { pendingPayments, pendingRefunds, revenue30: revenue[0]?.total ?? 0 });
    overview.payments = payments.map((p) => ({ ...toPaymentDTO(p), user: toUserSummary(p.user) }));
  }
  return overview;
}

function lastDays(days) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return Array.from({ length: days }, (_, i) => fmt.format(new Date(Date.now() - (days - 1 - i) * 864e5)));
}

async function perDay(Model, dateField, match, since, sumField) {
  const rows = await Model.aggregate([
    { $match: { ...match, [dateField]: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: TZ } },
        n: { $sum: sumField ? `$${sumField}` : 1 },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, r.n]));
}

const groupCount = (Model, match, field) =>
  Model.aggregate([
    { $match: match },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);

const asBreakdown = (rows) =>
  rows.map((r) => ({
    key: r._id ?? 'unknown',
    count: r.n,
    ...(r.amount !== undefined ? { amount: r.amount } : {}),
  }));

/** Daily series and breakdowns for the analytics page. */
export async function analytics(days) {
  const since = new Date(Date.now() - days * 864e5);
  const sold = { status: { $in: ['verified', 'refunded'] } };
  const [revenue, sales, signups, submissions, approvals, unlocks, visits] = await Promise.all([
    perDay(Payment, 'creditedAt', sold, since, 'amount'),
    perDay(Payment, 'creditedAt', sold, since),
    perDay(User, 'createdAt', { role: 'user' }, since),
    perDay(Biodata, 'submittedAt', {}, since),
    perDay(Biodata, 'approvedAt', {}, since),
    perDay(ConnectionTransaction, 'createdAt', { type: 'unlock' }, since),
    perDay(ProfileVisit, 'createdAt', {}, since),
  ]);
  const series = lastDays(days).map((day) => ({
    day,
    revenue: revenue.get(day) ?? 0,
    sales: sales.get(day) ?? 0,
    signups: signups.get(day) ?? 0,
    submissions: submissions.get(day) ?? 0,
    approvals: approvals.get(day) ?? 0,
    unlocks: unlocks.get(day) ?? 0,
    visits: visits.get(day) ?? 0,
  }));

  const [users, biodataStatus, type, religion, district, paymentMethod, totals, connections, deleteReasons] =
    await Promise.all([
      groupCount(User, {}, 'role'),
      groupCount(Biodata, { deletedAt: null }, 'status'),
      groupCount(Biodata, LIVE, 'type'),
      groupCount(Biodata, LIVE, 'religion'),
      Biodata.aggregate([
        { $match: LIVE },
        { $group: { _id: '$district', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 10 },
      ]),
      Payment.aggregate([
        { $match: { status: 'verified' } },
        { $group: { _id: '$method', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      Payment.aggregate([
        { $match: sold },
        { $group: { _id: '$status', amount: { $sum: '$amount' }, n: { $sum: 1 } } },
      ]),
      ConnectionTransaction.aggregate([{ $group: { _id: '$type', n: { $sum: '$delta' } } }]),
      groupCount(Biodata, { deletedAt: { $ne: null } }, 'deleteReason'),
    ]);
  return {
    days,
    series,
    totals: {
      revenue: totals.find((t) => t._id === 'verified')?.amount ?? 0,
      refunded: totals.find((t) => t._id === 'refunded')?.amount ?? 0,
      sales: totals.reduce((sum, t) => sum + t.n, 0),
      connectionsSold: connections.find((c) => c._id === 'purchase')?.n ?? 0,
      connectionsUsed: -(connections.find((c) => c._id === 'unlock')?.n ?? 0),
    },
    breakdowns: {
      users: asBreakdown(users),
      biodataStatus: asBreakdown(biodataStatus),
      type: asBreakdown(type),
      religion: asBreakdown(religion),
      district: asBreakdown(district),
      paymentMethod: asBreakdown(paymentMethod),
      deleteReasons: asBreakdown(deleteReasons),
    },
  };
}
