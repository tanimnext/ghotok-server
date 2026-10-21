import { biodataCompletion, validateBiodata, validateSection } from '@ghotok/shared';
import { storage } from '../integrations/storage/index.js';
import { Biodata, ContactUnlock, Favorite, Proposal, Report, RestoreRequest, User } from '../models/index.js';
import { toAdminRow, toFullView } from '../serializers/biodata.serializer.js';
import { toUserSummary } from '../serializers/user.serializer.js';
import { badRequest, conflict, notFound, validationError } from '../utils/api-error.js';
import { pageParams, paginate } from '../utils/pagination.js';
import { escapeRegex } from '../utils/strings.js';
import { recordAudit } from './audit.service.js';
import { notify } from './notification.service.js';
import { getSetting } from './settings.service.js';
import { correctionsState } from './biodata.service.js';
import { changeBalance } from './connection.service.js';
import { visitStats } from './visit.service.js';

// Staff work on biodatas: review queue, approval, edits, hiding, deletion,
// NID verification and the soft-delete recovery queue.

const OWNER_FIELDS = 'name email phone role status';

async function load(id) {
  const b = await Biodata.findById(id).populate('user', OWNER_FIELDS);
  if (!b) throw notFound('Biodata');
  return b;
}

export async function listBiodatas({ status, nid, type, religion, hidden, blocked, deleted, q }, query) {
  const filter = {};
  if (deleted === 'true') filter.deletedAt = { $ne: null };
  else if (deleted !== 'all') filter.deletedAt = null;
  if (status) filter.status = status;
  if (nid) filter['nid.status'] = nid;
  if (type) filter.type = type;
  if (religion) filter.religion = religion;
  if (hidden === 'true') filter.isHidden = true;
  if (blocked === 'true') filter.blocked = true;
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({ $or: [{ name: re }, { email: q.toLowerCase() }, { phone: q }] })
      .select('_id')
      .limit(50);
    filter.$or = [
      { biodataNo: new RegExp(`^${escapeRegex(q)}`, 'i') },
      { user: { $in: users.map((u) => u._id) } },
    ];
  }
  // The review queue is first-in, first-out.
  const sort = status === 'pending' ? { submittedAt: 1 } : { updatedAt: -1 };
  return paginate(
    Biodata.find(filter).sort(sort).populate('user', OWNER_FIELDS),
    Biodata.countDocuments(filter),
    pageParams(query, { defaultLimit: 20 }),
    toAdminRow,
  );
}

export async function getBiodataForReview(id) {
  const b = await load(id);
  const [visits, favoritedBy, unlocks, proposals, reports, restoreRequest] = await Promise.all([
    visitStats(b._id),
    Favorite.countDocuments({ biodata: b._id }),
    ContactUnlock.countDocuments({ biodata: b._id }),
    Proposal.countDocuments({ toBiodata: b._id }),
    Report.find({ biodata: b._id }).sort({ createdAt: -1 }).limit(10).lean(),
    RestoreRequest.findOne({ biodata: b._id }).sort({ createdAt: -1 }).lean(),
  ]);
  return {
    biodata: {
      ...toFullView(b),
      corrections: correctionsState(b),
      deleteNote: b.deleteNote ?? null,
      reviewedAt: b.reviewedAt ?? null,
    },
    completion: biodataCompletion(b.sectionsObject()),
    owner: toUserSummary(b.user),
    activity: { visits, favoritedBy, unlocks, proposals },
    reports: reports.map((r) => ({ id: r._id, reason: r.reason, status: r.status, createdAt: r.createdAt })),
    restoreRequest,
  };
}

/** Approves a complete biodata; it becomes public. */
export async function approveBiodata(id, ctx) {
  const b = await load(id);
  if (b.deletedAt) throw conflict('BIODATA_DELETED', 'Restore the biodata before approving it.');
  const errors = validateBiodata(b.sectionsObject());
  if (Object.keys(errors).length) {
    throw badRequest('INCOMPLETE', 'This biodata is incomplete and cannot be approved.', {
      sections: errors,
    });
  }
  const moderation = await getSetting('moderation');
  if (moderation.requireNidForApproval && b.nid?.status !== 'verified') {
    throw conflict('NID_REQUIRED', 'Verify the NID before approving.');
  }
  const now = new Date();
  const firstApproval = !b.firstApprovedAt;
  Object.assign(b, {
    status: 'approved',
    approvedAt: now,
    reviewedAt: now,
    reviewedBy: ctx.actor._id,
    rejectionReason: undefined,
    corrections: [],
  });
  b.firstApprovedAt ??= now;
  await b.save();
  // A one-time gift of connections the first time a biodata goes live.
  const { approvalGift } = await getSetting('payments');
  if (firstApproval && approvalGift > 0) {
    await changeBalance(b.user._id, approvalGift, {
      type: 'gift',
      biodata: b._id,
      actor: ctx.actor._id,
      reason: `Approval gift for ${b.biodataNo}`,
    });
    await notify(b.user._id, 'connections_gift', { n: approvalGift }, '/dashboard/connections');
  }
  await notify(b.user._id, 'biodata_approved', { biodataNo: b.biodataNo }, `/biodatas/${b.biodataNo}`);
  await recordAudit(ctx, 'biodata.approve', {
    targetType: 'biodata',
    targetId: b._id,
    summary: `Approved ${b.biodataNo}`,
  });
  return toAdminRow(b);
}

/**
 * Sends a biodata back to its owner with the changes needed: a general message and,
 * optionally, the specific answers to correct (each with a note). The owner cannot
 * resubmit until every flagged answer has changed.
 */
export async function rejectBiodata(id, { reason, corrections = [] }, ctx) {
  const b = await load(id);
  const sections = b.sectionsObject();
  Object.assign(b, {
    status: 'rejected',
    rejectionReason: reason,
    reviewedAt: new Date(),
    reviewedBy: ctx.actor._id,
    corrections: corrections.map((c) => ({ ...c, previous: sections[c.section]?.[c.field] ?? null })),
  });
  await b.save();
  await notify(b.user._id, 'biodata_rejected', { biodataNo: b.biodataNo, reason }, '/dashboard/biodata');
  await recordAudit(ctx, 'biodata.reject', {
    targetType: 'biodata',
    targetId: b._id,
    summary: `Rejected ${b.biodataNo}`,
    meta: { reason, corrections: corrections.map((c) => `${c.section}.${c.field}`) },
  });
  return toAdminRow(b);
}

/** Staff correction of one section. Does not change the review status. */
export async function editSection(id, section, data, ctx) {
  const b = await load(id);
  const { value, errors } = validateSection(section, data, { biodata: b.sectionsObject(), partial: true });
  if (Object.keys(errors).length) throw validationError(errors);
  b.set(section, value);
  await b.save();
  await recordAudit(ctx, 'biodata.edit', {
    targetType: 'biodata',
    targetId: b._id,
    summary: `Edited ${section} of ${b.biodataNo}`,
  });
  return { biodata: toFullView(b), completion: biodataCompletion(b.sectionsObject()) };
}

/** Pauses (or resumes, with `until: null`) the owner's editing and resubmitting. */
export async function setEditSuspension(id, { until, reason }, ctx) {
  const b = await load(id);
  b.editSuspendedUntil = until ?? null;
  await b.save();
  if (until)
    await notify(
      b.user._id,
      'edit_suspended',
      { biodataNo: b.biodataNo, until, reason },
      '/dashboard/biodata',
    );
  await recordAudit(ctx, until ? 'biodata.suspend_edit' : 'biodata.resume_edit', {
    targetType: 'biodata',
    targetId: b._id,
    summary: until
      ? `Editing of ${b.biodataNo} paused until ${until.toISOString().slice(0, 10)}`
      : `Editing of ${b.biodataNo} resumed`,
    meta: { reason },
  });
  return toAdminRow(b);
}

/** Hides (or un-hides) a biodata from the public, independent of the owner's own setting. */
export async function setBlocked(id, { blocked, reason }, ctx) {
  const b = await load(id);
  b.blocked = blocked;
  await b.save();
  await recordAudit(ctx, blocked ? 'biodata.block' : 'biodata.unblock', {
    targetType: 'biodata',
    targetId: b._id,
    summary: `${blocked ? 'Hid' : 'Unhid'} ${b.biodataNo}`,
    meta: { reason },
  });
  return toAdminRow(b);
}

export async function softDelete(id, reason, ctx) {
  const b = await load(id);
  if (!b.deletedAt) {
    Object.assign(b, {
      deletedAt: new Date(),
      deleteReason: 'other',
      deleteNote: `Removed by staff: ${reason}`,
    });
    await b.save();
    await Proposal.updateMany({ toBiodata: b._id, status: 'pending' }, { status: 'withdrawn' });
  }
  await recordAudit(ctx, 'biodata.soft_delete', {
    targetType: 'biodata',
    targetId: b._id,
    summary: `Deleted ${b.biodataNo}`,
    meta: { reason },
  });
  return toAdminRow(b);
}

async function restore(b, note, ctx) {
  Object.assign(b, { deletedAt: null, deleteReason: undefined, deleteNote: undefined });
  await b.save();
  await RestoreRequest.updateMany(
    { biodata: b._id, status: 'pending' },
    { status: 'approved', decidedBy: ctx.actor._id, decidedAt: new Date(), note },
  );
  await notify(b.user._id ?? b.user, 'restore_approved', { biodataNo: b.biodataNo }, '/dashboard');
  await recordAudit(ctx, 'biodata.restore', {
    targetType: 'biodata',
    targetId: b._id,
    summary: `Restored ${b.biodataNo}`,
  });
}

export async function restoreBiodata(id, note, ctx) {
  const b = await load(id);
  if (!b.deletedAt) throw conflict('NOT_DELETED', 'This biodata is not deleted.');
  await restore(b, note, ctx);
  return toAdminRow(b);
}

// ----- NID ---------------------------------------------------------------------

/** Short-lived links to the NID images. Every view is audited. */
export async function nidDocuments(id, ctx) {
  const b = await load(id);
  if (!b.nid?.frontKey) throw notFound('NID documents');
  const [front, back] = await Promise.all([
    storage.privateUrl(b.nid.frontKey),
    storage.privateUrl(b.nid.backKey),
  ]);
  await recordAudit(ctx, 'nid.view', {
    targetType: 'biodata',
    targetId: b._id,
    summary: `Viewed NID of ${b.biodataNo}`,
  });
  return { status: b.nid.status, submittedAt: b.nid.submittedAt, front, back, note: b.nid.note ?? null };
}

/** @param {'verified' | 'rejected'} status */
export async function decideNid(id, status, note, ctx) {
  if (status === 'rejected' && !note) throw validationError({ note: 'Add a note for the user.' });
  const b = await load(id);
  if (b.nid?.status !== 'pending') throw conflict('NOT_PENDING', 'There is no NID waiting for verification.');
  Object.assign(b.nid, { status, note, reviewedAt: new Date(), reviewedBy: ctx.actor._id });
  await b.save();
  await notify(
    b.user._id,
    status === 'verified' ? 'nid_verified' : 'nid_rejected',
    { biodataNo: b.biodataNo, note },
    '/dashboard/biodata',
  );
  await recordAudit(ctx, status === 'verified' ? 'nid.verify' : 'nid.reject', {
    targetType: 'biodata',
    targetId: b._id,
    summary: `NID ${status} for ${b.biodataNo}`,
    meta: { note },
  });
  return toAdminRow(b);
}

// ----- Recovery queue ------------------------------------------------------------

export function listRestoreRequests({ status }, query) {
  const filter = status ? { status } : {};
  return paginate(
    RestoreRequest.find(filter)
      .sort({ createdAt: status === 'pending' ? 1 : -1 })
      .populate('biodata', 'biodataNo deletedAt deleteReason deleteNote type')
      .populate('user', OWNER_FIELDS)
      .lean(),
    RestoreRequest.countDocuments(filter),
    pageParams(query, { defaultLimit: 20 }),
    (r) => ({
      id: r._id,
      status: r.status,
      reason: r.reason ?? null,
      note: r.note ?? null,
      permanent: !!r.permanent,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt ?? null,
      biodata: r.biodata
        ? {
            id: r.biodata._id,
            biodataNo: r.biodata.biodataNo,
            deletedAt: r.biodata.deletedAt,
            deleteReason: r.biodata.deleteReason,
            deleteNote: r.biodata.deleteNote ?? null,
          }
        : null,
      user: toUserSummary(r.user),
    }),
  );
}

export async function approveRestoreRequest(id, note, ctx) {
  const request = await RestoreRequest.findOne({ _id: id, status: 'pending' });
  if (!request) throw notFound('Request');
  const b = await Biodata.findById(request.biodata);
  if (!b) throw notFound('Biodata');
  await restore(b, note, ctx);
}

export async function declineRestoreRequest(id, { note, permanent = false }, ctx) {
  const request = await RestoreRequest.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { status: 'declined', note, permanent, decidedBy: ctx.actor._id, decidedAt: new Date() },
    { new: true },
  ).populate('biodata', 'biodataNo');
  if (!request) throw notFound('Request');
  await notify(
    request.user,
    'restore_declined',
    { biodataNo: request.biodata?.biodataNo, note },
    '/dashboard/settings',
  );
  await recordAudit(ctx, 'restore.decline', {
    targetType: 'restore_request',
    targetId: request._id,
    summary: `Declined restore of ${request.biodata?.biodataNo}`,
  });
}
