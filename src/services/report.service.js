import { REPORT_REASONS, optionLabel } from '@ghotok/shared';
import { ContactUnlock, Report, SupportTicket } from '../models/index.js';
import { toAdminRow } from '../serializers/biodata.serializer.js';
import { toUserSummary } from '../serializers/user.serializer.js';
import { conflict, notFound } from '../utils/api-error.js';
import { pageParams, paged } from '../utils/pagination.js';
import { recordAudit } from './audit.service.js';
import { findByNumber } from './biodata.service.js';
import { changeBalance } from './connection.service.js';
import { notify } from './notification.service.js';
import { openTicket } from './ticket.service.js';

const ACTIVE = ['open', 'in_review'];

/**
 * A member reports a biodata (and its owner). One active report per member per
 * biodata. Each report opens a support conversation, so staff can ask for details
 * and the member sees the outcome in the same thread.
 */
export async function reportBiodata(user, biodataNo, { reason, details, attachments }) {
  const b = await findByNumber(biodataNo);
  const existing = await Report.findOne({ reporter: user._id, biodata: b._id, status: { $in: ACTIVE } });
  if (existing) {
    throw conflict(
      'ALREADY_REPORTED',
      'You have already reported this biodata. Our team is looking into it.',
      {
        ticketId: existing.ticket?.toString() ?? null,
      },
    );
  }
  const report = await Report.create({
    reporter: user._id,
    biodata: b._id,
    targetUser: b.user,
    reason,
    details,
  });
  const reasonText = optionLabel(REPORT_REASONS, reason, 'en');
  const ticket = await openTicket(
    user,
    {
      subject: `Report about ${b.biodataNo}: ${reasonText}`.slice(0, 160),
      category: 'report',
      message: details || reasonText,
      attachments,
    },
    { report: report._id, biodata: b._id },
  );
  report.ticket = ticket.id;
  await report.save();
  return { id: report._id, status: report.status, ticketId: ticket.id };
}

/** Staff: reports, newest first, with how often each target has been reported. */
export async function listReports({ status }, query) {
  const filter = {};
  if (status === 'active') filter.status = { $in: ACTIVE };
  else if (status) filter.status = status;
  const params = pageParams(query, { defaultLimit: 20 });
  const [items, total] = await Promise.all([
    Report.find(filter)
      .sort({ createdAt: -1 })
      .skip(params.skip)
      .limit(params.limit)
      .populate('reporter', 'name email phone role status')
      .populate('targetUser', 'name email phone role status')
      .populate('biodata')
      .populate('handledBy', 'name'),
    Report.countDocuments(filter),
  ]);
  const counts = await Report.aggregate([
    { $match: { targetUser: { $in: items.map((r) => r.targetUser?._id).filter(Boolean) } } },
    { $group: { _id: '$targetUser', n: { $sum: 1 } } },
  ]);
  const countOf = new Map(counts.map((c) => [c._id.toString(), c.n]));
  // Whether each reporter paid to unlock the biodata they reported (a refund is then possible).
  const pairs = items
    .filter((r) => r.biodata && r.reporter)
    .map((r) => ({ user: r.reporter._id, biodata: r.biodata._id }));
  const unlocks = pairs.length ? await ContactUnlock.find({ $or: pairs }).select('user biodata').lean() : [];
  const unlocked = new Set(unlocks.map((u) => `${u.user}:${u.biodata}`));
  return paged(
    items.map((r) => ({
      id: r._id,
      reason: r.reason,
      details: r.details ?? null,
      status: r.status,
      actionTaken: r.actionTaken ?? null,
      ticketId: r.ticket?.toString() ?? null,
      connectionRefunded: !!r.connectionRefunded,
      reporterUnlocked: unlocked.has(`${r.reporter?._id}:${r.biodata?._id}`),
      createdAt: r.createdAt,
      handledAt: r.handledAt ?? null,
      handledBy: r.handledBy?.name ?? null,
      reporter: toUserSummary(r.reporter),
      targetUser: toUserSummary(r.targetUser),
      timesReported: r.targetUser ? (countOf.get(r.targetUser._id.toString()) ?? 1) : 1,
      biodata: r.biodata ? toAdminRow(r.biodata) : null,
    })),
    total,
    params,
  );
}

/** Staff: move a report through open → in_review → resolved | dismissed. */
/**
 * Moves a report through review. Closing it (resolved or dismissed) notifies the
 * reporter and posts the outcome in the report's conversation. When an upheld
 * report is about a contact the reporter paid to unlock, `refundConnection`
 * returns that connection (once).
 */
export async function updateReport(id, { status, actionTaken, refundConnection }, ctx) {
  const closing = status === 'resolved' || status === 'dismissed';
  const r = await Report.findById(id).populate('biodata', 'biodataNo');
  if (!r) throw notFound('Report');
  Object.assign(r, {
    status,
    actionTaken,
    ...(closing ? { handledBy: ctx.actor._id, handledAt: new Date() } : {}),
  });

  if (refundConnection && status === 'resolved' && !r.connectionRefunded) {
    const unlock = await ContactUnlock.findOneAndUpdate(
      { user: r.reporter, biodata: r.biodata?._id, refundedAt: null },
      { refundedAt: new Date() },
    );
    if (!unlock)
      throw conflict('NOTHING_TO_REFUND', 'The reporter did not spend a connection on this biodata.');
    await changeBalance(r.reporter, 1, {
      type: 'report_refund',
      biodata: r.biodata?._id,
      actor: ctx.actor._id,
      reason: `Report about ${r.biodata?.biodataNo} upheld`,
    });
    r.connectionRefunded = true;
  }
  await r.save();

  if (closing) {
    await notify(r.reporter, 'report_closed', {
      biodataNo: r.biodata?.biodataNo,
      status,
      refunded: r.connectionRefunded,
    });
    if (r.ticket) {
      const outcome = [
        status === 'resolved' ? 'Your report was upheld.' : 'Your report was reviewed and closed.',
        actionTaken,
      ]
        .concat(r.connectionRefunded ? ['The connection you used has been returned to your balance.'] : [])
        .filter(Boolean)
        .join('\n\n');
      const now = new Date();
      await SupportTicket.updateOne(
        { _id: r.ticket },
        {
          $push: { messages: { author: ctx.actor._id, staff: true, body: outcome } },
          status: 'closed',
          closedAt: now,
          lastMessageAt: now,
          lastStaffMessageAt: now,
        },
      );
    }
  }
  await recordAudit(ctx, 'report.update', {
    targetType: 'report',
    targetId: r._id,
    summary: `Report on ${r.biodata?.biodataNo ?? 'user'} → ${status}${r.connectionRefunded ? ' (connection refunded)' : ''}`,
    meta: { status, actionTaken },
  });
}
