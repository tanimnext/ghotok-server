import { biodataCompletion, validateBiodata, validateSection } from '../shared/index.js';
import {
  Biodata,
  ContactUnlock,
  Dislike,
  Favorite,
  MarriageReport,
  PUBLIC_FILTER,
  Proposal,
  Report,
  RestoreRequest,
  nextSequence,
} from '../models/index.js';
import { toContact, toFullView } from '../serializers/biodata.serializer.js';
import { badRequest, conflict, forbidden, notFound, validationError } from '../utils/api-error.js';
import { recordAudit } from './audit.service.js';
import { visitStats } from './visit.service.js';

// A member's own biodata, and the public view of other members' biodatas.

const FIRST_BIODATA_NO = 1000;

const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The reviewer's correction requests, each marked `changed` once the owner has edited that answer. */
export function correctionsState(b) {
  const sections = b.sectionsObject();
  return (b.corrections ?? []).map((c) => ({
    section: c.section,
    field: c.field,
    note: c.note ?? null,
    // The answer when staff asked for the change (the owner's own data, so both views may show it).
    previous: c.previous ?? null,
    changed: !sameValue(sections[c.section]?.[c.field], c.previous),
  }));
}

/** The owner's view plus the editor's completion summary. */
export const ownerView = (b) => ({
  biodata: { ...toFullView(b), corrections: correctionsState(b) },
  completion: biodataCompletion(b.sectionsObject()),
});

export function findOwn(userId) {
  return Biodata.findOne({ user: userId });
}

async function requireOwn(userId) {
  const b = await findOwn(userId);
  if (!b) throw notFound('Biodata');
  return b;
}

/** The owner's biodata for editing; it must have been started (pledge accepted) first. */
async function requireStarted(userId) {
  const b = await findOwn(userId);
  if (!b)
    throw conflict('PLEDGE_REQUIRED', 'Please read and accept the pledge before creating your biodata.');
  return b;
}

function assertEditable(b) {
  if (b.deletedAt) {
    throw conflict('BIODATA_DELETED', 'This biodata has been deleted. Request a restore to edit it again.');
  }
  if (b.editSuspendedUntil && b.editSuspendedUntil > new Date()) {
    throw forbidden('EDIT_SUSPENDED', 'Editing your biodata has been paused by our team.', {
      until: b.editSuspendedUntil,
    });
  }
}

/**
 * Starts the member's biodata once they have accepted the eligibility rules and
 * the pledge (the API schema requires `pledge: true`). Idempotent.
 */
export async function createOwn(userId) {
  const existing = await findOwn(userId);
  if (existing) return existing;
  const seq = await nextSequence('biodata', FIRST_BIODATA_NO);
  return Biodata.create({ user: userId, biodataNo: `GH-${seq}`, pledgeAcceptedAt: new Date() });
}

/**
 * Saves one form section. Missing required fields are allowed (drafts); invalid
 * values are not. Changing a live biodata sends it back to review.
 * @returns {Promise<{ biodata: object, statusChanged: boolean }>}
 */
export async function saveSection(userId, section, data) {
  const b = await requireStarted(userId);
  assertEditable(b);
  const { value, errors } = validateSection(section, data, { biodata: b.sectionsObject(), partial: true });
  if (Object.keys(errors).length) throw validationError(errors);

  b.set(section, value);
  const wasApproved = b.status === 'approved';
  if (wasApproved) {
    const { complete } = biodataCompletion(b.sectionsObject());
    b.status = complete ? 'pending' : 'draft';
    if (complete) b.submittedAt = new Date();
  }
  await b.save();
  return { biodata: b, statusChanged: wasApproved };
}

/** Submits a complete biodata for review. */
export async function submitForReview(userId) {
  const b = await requireOwn(userId);
  assertEditable(b);
  const errors = validateBiodata(b.sectionsObject());
  if (Object.keys(errors).length) {
    throw badRequest('INCOMPLETE', 'Please complete every section before submitting.', { sections: errors });
  }
  const unchanged = correctionsState(b).filter((c) => !c.changed);
  if (b.status === 'rejected' && unchanged.length) {
    throw conflict('CORRECTIONS_PENDING', 'Please correct every flagged answer before submitting.', {
      fields: unchanged.map(({ section, field }) => ({ section, field })),
    });
  }
  if (b.status === 'draft' || b.status === 'rejected') {
    b.status = 'pending';
    b.submittedAt = new Date();
    b.rejectionReason = undefined;
    await b.save();
  }
  return b;
}

/** Hides a biodata from search (with the owner's reason) or makes it live again. */
export async function setHidden(userId, { hidden, reason, note }) {
  const b = await requireOwn(userId);
  assertEditable(b);
  b.isHidden = hidden;
  b.hideReason = hidden ? reason : undefined;
  b.hideNote = hidden ? note : undefined;
  await b.save();
  return b;
}

const MARRIED = ['married_via_ghotok', 'married_elsewhere'];

/** Records "we got married" details; the partner is linked when they were on Ghotok too. */
async function recordMarriage(userId, b, reason, marriage) {
  let partnerBiodata;
  if (marriage.partnerBiodataNo) {
    partnerBiodata = await Biodata.findOne({ biodataNo: marriage.partnerBiodataNo.toUpperCase() }).select(
      '_id',
    );
  }
  await MarriageReport.create({
    user: userId,
    biodata: b._id,
    viaGhotok: reason === 'married_via_ghotok',
    marriedOn: marriage.marriedOn,
    place: marriage.place,
    partnerBiodata: partnerBiodata?._id,
    partner: marriage.partner,
    story: marriage.story,
    shareStory: !!marriage.shareStory,
  });
}

/** Soft-deletes the owner's biodata. It can be restored through the recovery queue. */
export async function softDeleteOwn(userId, { reason, note, marriage }, ctx) {
  const b = await requireOwn(userId);
  if (b.deletedAt) return b;
  b.deletedAt = new Date();
  b.deleteReason = reason;
  b.deleteNote = note;
  await b.save();
  if (marriage && MARRIED.includes(reason)) await recordMarriage(userId, b, reason, marriage);
  await Proposal.updateMany({ from: userId, status: 'pending' }, { status: 'withdrawn' });
  await recordAudit(ctx, 'biodata.soft_delete', {
    targetType: 'biodata',
    targetId: b._id,
    summary: `${b.biodataNo} deleted by owner (${reason})`,
  });
  return b;
}

export async function latestRestoreRequest(userId) {
  const b = await findOwn(userId);
  return b ? RestoreRequest.findOne({ biodata: b._id }).sort({ createdAt: -1 }).lean() : null;
}

/**
 * Restores a deleted biodata straight away when it was never published. A
 * biodata that has been live needs staff approval (see requestRestore).
 */
export async function restoreOwn(userId) {
  const b = await requireOwn(userId);
  if (!b.deletedAt) throw conflict('NOT_DELETED', 'Your biodata is not deleted.');
  if (b.firstApprovedAt) {
    throw conflict(
      'RESTORE_NEEDS_APPROVAL',
      'This biodata was published before, so our team needs to approve the restore.',
    );
  }
  Object.assign(b, { deletedAt: null, deleteReason: undefined, deleteNote: undefined });
  await b.save();
  return b;
}

export async function requestRestore(userId, reason) {
  const b = await findOwn(userId);
  if (!b?.deletedAt) throw conflict('NOT_DELETED', 'Your biodata is not deleted.');
  if (await RestoreRequest.exists({ biodata: b._id, status: 'declined', permanent: true })) {
    throw conflict('RESTORE_BLOCKED', 'Restoring this biodata has been permanently declined.');
  }
  if (await RestoreRequest.exists({ biodata: b._id, status: 'pending' })) {
    throw conflict('ALREADY_REQUESTED', 'You have already asked for a restore. Please wait for our team.');
  }
  return RestoreRequest.create({ biodata: b._id, user: userId, reason });
}

export async function ownStats(userId) {
  const b = await findOwn(userId);
  if (!b) return { visits: { today: 0, week: 0, month: 0 }, favoritedBy: 0, unlocks: 0, views: 0 };
  const [visits, favoritedBy] = await Promise.all([
    visitStats(b._id),
    Favorite.countDocuments({ biodata: b._id }),
  ]);
  return { visits, favoritedBy, unlocks: b.stats?.unlocks ?? 0, views: b.stats?.views ?? 0 };
}

// ----- Public ------------------------------------------------------------------

/** Finds a public biodata by its number (e.g. "GH-1024") or throws 404. */
/**
 * Basic facts about a biodata by number, for the "we got married" form: enough to
 * recognise the partner, nothing private. Works for hidden or deleted biodatas too.
 */
export async function lookupPartner(biodataNo, userId) {
  const b = await Biodata.findOne({ biodataNo: String(biodataNo).toUpperCase() }).select(
    'biodataNo user type district profession educationLevel',
  );
  if (!b || b.user.equals(userId)) throw notFound('Biodata');
  return {
    biodataNo: b.biodataNo,
    type: b.type ?? null,
    district: b.district ?? null,
    profession: b.profession ?? null,
    education: b.educationLevel ?? null,
  };
}

export async function findPublic(biodataNo) {
  const b = await Biodata.findOne({ biodataNo: String(biodataNo).toUpperCase(), ...PUBLIC_FILTER });
  if (!b) throw notFound('Biodata');
  return b;
}

/** Finds any biodata by number, public or not (for removing list entries, reports). */
export async function findByNumber(biodataNo) {
  const b = await Biodata.findOne({ biodataNo: String(biodataNo).toUpperCase() });
  if (!b) throw notFound('Biodata');
  return b;
}

export function assertNotOwn(b, user, message = 'This is your own biodata.') {
  if (b.user.equals(user._id)) throw badRequest('OWN_BIODATA', message);
}

/** What a signed-in member sees about a biodata: lists, unlock, contact and proposal. */
export async function viewerState(user, biodataNo) {
  const b = await findPublic(biodataNo);
  const isOwner = b.user.equals(user._id);
  const [favorite, dislike, unlock, proposal, report] = await Promise.all([
    Favorite.exists({ user: user._id, biodata: b._id }),
    Dislike.exists({ user: user._id, biodata: b._id }),
    ContactUnlock.findOne({ user: user._id, biodata: b._id }).select('refundedAt').lean(),
    Proposal.findOne({
      $or: [
        { from: user._id, toBiodata: b._id },
        { from: b.user, to: user._id },
      ],
      status: { $in: ['pending', 'accepted'] },
    }).sort({ createdAt: -1 }),
    Report.findOne({ reporter: user._id, biodata: b._id })
      .sort({ createdAt: -1 })
      .select('status ticket')
      .lean(),
  ]);
  const unlocked = isOwner || !!unlock;
  return {
    isOwner,
    isFavorite: !!favorite,
    isDisliked: !!dislike,
    unlocked,
    contact: unlocked ? toContact(b) : null,
    // The connection was given back after the member's report was upheld.
    refunded: !!unlock?.refundedAt,
    report: report ? { status: report.status, ticketId: report.ticket?.toString() ?? null } : null,
    proposal: proposal
      ? {
          id: proposal._id,
          status: proposal.status,
          direction: proposal.from.equals(user._id) ? 'sent' : 'received',
        }
      : null,
    balance: user.connectionBalance,
  };
}
