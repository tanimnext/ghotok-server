import { ageFromDob, publicSections } from '@ghotok/shared';
import { photoUrl } from '../integrations/storage/index.js';
import { toUserSummary } from './user.serializer.js';

// Output shapes for biodatas. Private data (names, the contact section, NID
// documents) only appears in toFullView, which is for the owner and staff.

const isPublic = (b) => b.status === 'approved' && !b.isHidden && !b.blocked && !b.deletedAt;

/** Summary used in search results, lists and the home page. No private data. */
export function toCard(b, { showPhoto = false } = {}) {
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
    nidVerified: b.nid?.status === 'verified',
    photoUrl: showPhoto || b.photo?.visibility === 'public' ? photoUrl(b.photo) : null,
    hasPhoto: !!b.photo?.imageId,
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
    verified: { email: !!owner?.emailVerified, phone: !!owner?.phoneVerified },
    sections: publicSections(b.sectionsObject()),
    views: b.stats?.views ?? 0,
    updatedAt: b.updatedAt,
  };
}

/** Everything the owner or staff may see, including private sections. */
export function toFullView(b) {
  return {
    ...toCard(b, { showPhoto: true }),
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
    photo: b.photo?.imageId ? { url: photoUrl(b.photo), visibility: b.photo.visibility } : null,
    nid: {
      status: b.nid?.status ?? 'not_submitted',
      submittedAt: b.nid?.submittedAt ?? null,
      note: b.nid?.note ?? null,
    },
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
    nidStatus: b.nid?.status ?? 'not_submitted',
    nidSubmittedAt: b.nid?.submittedAt ?? null,
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
