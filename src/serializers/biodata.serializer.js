import { ageFromDob, publicSections } from '../shared/index.js';
import { contactEmail, toUserSummary } from './user.serializer.js';

// Output shapes for biodatas. Private data (names and the contact section) only
// appears in toFullView, which is for the owner and staff.

const isPublic = (b) => b.status === 'approved' && !b.isHidden && !b.blocked && !b.deletedAt;

/** Summary used in search results, lists and the home page. No private data. */
export function toCard(b) {
  return {
    id: b._id.toString(),
    biodataNo: b.biodataNo,
    type: b.type ?? null,
    age: ageFromDob(b.birthDate),
    maritalStatus: b.maritalStatus ?? null,
    religion: b.religion ?? null,
    heightIn: b.heightIn ?? null,
    complexion: b.complexion ?? null,
    district: b.district ?? null,
    division: b.division ?? null,
    educationLevel: b.educationLevel ?? null,
    institution: b.education?.institution ?? null,
    profession: b.profession ?? null,
    jobTitle: b.occupation?.jobTitle ?? null,
    approvedAt: b.approvedAt ?? null,
  };
}

/**
 * Public profile: every non-private field.
 * @param {object} [owner] the owner's account, for the verified email/phone badges
 */
export function toPublicDetail(b, owner) {
  return {
    ...toCard(b),
    verified: {
      email: !!owner?.emailVerified && !!contactEmail(owner),
      phone: !!owner?.phoneNumberVerified,
    },
    sections: publicSections(b.sectionsObject()),
    views: b.stats?.views ?? 0,
    updatedAt: b.updatedAt,
  };
}

/** Everything the owner or staff may see, including private sections. */
export function toFullView(b) {
  return {
    ...toCard(b),
    status: b.status,
    rejectionReason: b.rejectionReason ?? null,
    submittedAt: b.submittedAt ?? null,
    isHidden: b.isHidden,
    hideReason: b.hideReason ?? null,
    hideNote: b.hideNote ?? null,
    blocked: !!b.blocked,
    deletedAt: b.deletedAt ?? null,
    deleteReason: b.deleteReason ?? null,
    // Whether the biodata has ever been live (a deleted one then needs staff approval to restore).
    wasPublished: !!b.firstApprovedAt,
    editSuspendedUntil:
      b.editSuspendedUntil && b.editSuspendedUntil > new Date() ? b.editSuspendedUntil : null,
    pledgeAcceptedAt: b.pledgeAcceptedAt ?? null,
    completion: b.completion,
    stats: b.stats,
    sections: b.sectionsObject(),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

/** A biodata in a personal list: the card while it is public, otherwise only its number. */
export function toListEntry(b, extra = {}) {
  if (!b) return { unavailable: true, ...extra };
  return isPublic(b) ? { ...toCard(b), ...extra } : { biodataNo: b.biodataNo, unavailable: true, ...extra };
}

/** The guardian contact details revealed by an unlock. */
export function toContact(b) {
  const c = typeof b.contact?.toObject === 'function' ? b.contact.toObject() : (b.contact ?? {});
  return { ...c };
}

/** Row for staff tables. */
export function toAdminRow(b) {
  return {
    id: b._id.toString(),
    biodataNo: b.biodataNo,
    status: b.status,
    type: b.type ?? null,
    religion: b.religion ?? null,
    maritalStatus: b.maritalStatus ?? null,
    district: b.district ?? null,
    age: ageFromDob(b.birthDate),
    completion: b.completion,
    isHidden: b.isHidden,
    blocked: !!b.blocked,
    deletedAt: b.deletedAt ?? null,
    deleteReason: b.deleteReason ?? null,
    submittedAt: b.submittedAt ?? null,
    approvedAt: b.approvedAt ?? null,
    updatedAt: b.updatedAt,
    views: b.stats?.views ?? 0,
    user: b.user?.name ? toUserSummary(b.user) : null,
  };
}

export { isPublic };
