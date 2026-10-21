import mongoose from 'mongoose';
import {
  BIODATA_SECTIONS,
  BIODATA_STATUS,
  DELETE_REASONS,
  EDUCATION_LEVELS,
  HIDE_REASONS,
  NID_STATUS,
  PHOTO_VISIBILITY,
  biodataCompletion,
  divisionOf,
  optionValues,
} from '@ghotok/shared';

const { Schema } = mongoose;

// Mongoose sub-schemas are generated from the shared form definition so the
// database shape can never drift from the form. Values are validated with the
// shared validator before they reach the model.
function fieldType(field) {
  if (field.type === 'multiselect') return [String];
  if (field.type === 'number' || (field.type === 'select' && field.numeric)) return Number;
  return String;
}

const sectionSchemas = Object.fromEntries(
  BIODATA_SECTIONS.map((section) => [
    section.key,
    {
      type: new Schema(Object.fromEntries(section.fields.map((f) => [f.key, { type: fieldType(f) }])), {
        _id: false,
        minimize: true,
      }),
      default: () => ({}),
    },
  ]),
);

/**
 * A member's biodata (one per user).
 *
 * Lifecycle (`status`): draft → pending (submitted) → approved | rejected.
 * Editing an approved biodata sends it back to pending. Visibility is separate:
 * `isHidden` (owner's choice), `blocked` (staff), and `deletedAt` (soft delete,
 * restorable through the recovery queue). Only PUBLIC_FILTER matches are public.
 */
const biodataSchema = new Schema(
  {
    biodataNo: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    status: { type: String, enum: optionValues(BIODATA_STATUS), default: 'draft', index: true },
    rejectionReason: { type: String, maxlength: 1000 },
    // When the owner accepted the eligibility rules and pledge before starting.
    pledgeAcceptedAt: Date,
    submittedAt: Date,
    approvedAt: Date,
    firstApprovedAt: Date,
    reviewedAt: Date,
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },

    isHidden: { type: Boolean, default: false },
    hideReason: { type: String, enum: [...optionValues(HIDE_REASONS), null] },
    hideNote: { type: String, maxlength: 500 },
    // Answers a reviewer asked the owner to correct ("Needs changes"). Cleared on approval.
    corrections: [
      new Schema(
        {
          section: { type: String, required: true },
          field: { type: String, required: true },
          note: { type: String, maxlength: 300 },
          // The value when the correction was requested, to tell whether it has changed since.
          previous: Schema.Types.Mixed,
        },
        { _id: false },
      ),
    ],
    // Staff can pause editing and resubmitting until this date (repeated misuse).
    editSuspendedUntil: { type: Date, default: null },
    // Set by staff when the owner's account is suspended or banned.
    blocked: { type: Boolean, default: false },

    deletedAt: { type: Date, default: null, index: true },
    deleteReason: { type: String, enum: [...optionValues(DELETE_REASONS), null] },
    deleteNote: { type: String, maxlength: 500 },

    photo: {
      imageId: String,
      storage: { type: String, enum: ['local', 'cloudflare'] },
      visibility: { type: String, enum: optionValues(PHOTO_VISIBILITY), default: 'after_unlock' },
    },

    nid: {
      status: { type: String, enum: optionValues(NID_STATUS), default: 'not_submitted', index: true },
      frontKey: String,
      backKey: String,
      submittedAt: Date,
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      note: { type: String, maxlength: 500 },
    },

    stats: {
      views: { type: Number, default: 0 },
      favorites: { type: Number, default: 0 },
      unlocks: { type: Number, default: 0 },
    },

    completion: { type: Number, default: 0 },

    ...sectionSchemas,

    // Denormalised search fields, recomputed from the sections on every save.
    type: { type: String, index: true },
    religion: String,
    maritalStatus: String,
    birthDate: Date,
    heightIn: Number,
    complexion: String,
    division: String,
    district: String,
    presentDistrict: String,
    upazila: String,
    presentUpazila: String,
    educationMedium: String,
    specialCategories: { type: [String], default: undefined },
    educationLevel: String,
    educationRank: Number,
    profession: String,
    economicStatus: String,
  },
  { timestamps: true, minimize: true },
);

biodataSchema.index({ status: 1, isHidden: 1, blocked: 1, deletedAt: 1, type: 1, approvedAt: -1 });
biodataSchema.index({ religion: 1, maritalStatus: 1, birthDate: 1 });
biodataSchema.index({ district: 1, upazila: 1 });
biodataSchema.index({ presentDistrict: 1, presentUpazila: 1 });

biodataSchema.pre('validate', function syncDerived(next) {
  const g = this.general ?? {};
  const a = this.address ?? {};
  this.type = g.biodataType;
  this.religion = g.religion;
  this.maritalStatus = g.maritalStatus;
  this.birthDate = g.dateOfBirth ? new Date(`${g.dateOfBirth}T00:00:00.000Z`) : undefined;
  this.heightIn = g.height;
  this.complexion = g.complexion;
  this.district = a.permanentDistrict;
  this.division = a.permanentDivision ?? divisionOf(a.permanentDistrict);
  const inBangladesh = a.presentLocation === 'bangladesh';
  this.presentDistrict = inBangladesh ? a.presentDistrict : undefined;
  this.upazila = a.permanentUpazila || undefined;
  this.presentUpazila = inBangladesh ? a.presentUpazila || undefined : undefined;
  this.educationMedium = this.education?.educationMedium;
  const categories = this.personal?.specialCategories;
  this.specialCategories = categories?.length ? [...categories] : undefined;
  this.educationLevel = this.education?.highestEducation;
  const rank = EDUCATION_LEVELS.findIndex((e) => e.value === this.educationLevel);
  this.educationRank = rank >= 0 ? rank : undefined;
  this.profession = this.occupation?.profession;
  this.economicStatus = this.family?.economicStatus;
  this.completion = biodataCompletion(this.sectionsObject()).percent;
  next();
});

/** Plain object with only the form sections, for the shared validator. */
biodataSchema.methods.sectionsObject = function sectionsObject() {
  const out = {};
  for (const s of BIODATA_SECTIONS) {
    const v = this[s.key];
    out[s.key] = v && typeof v.toObject === 'function' ? v.toObject() : { ...(v ?? {}) };
  }
  return out;
};

biodataSchema.methods.isPublic = function isPublic() {
  return this.status === 'approved' && !this.isHidden && !this.blocked && !this.deletedAt;
};

/** Mongo filter for biodatas visible to the public. */
export const PUBLIC_FILTER = Object.freeze({
  status: 'approved',
  isHidden: false,
  blocked: { $ne: true },
  deletedAt: null,
});

export const Biodata = mongoose.model('Biodata', biodataSchema);
