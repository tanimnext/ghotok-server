import mongoose from 'mongoose';

const { Schema } = mongoose;

const RETENTION_DAYS = 400;

/**
 * One row per viewer per biodata per day. Counting rows gives the
 * "visits today / 7 days / 30 days" figures on the user dashboard.
 * `viewerKey` is `u:<userId>` for members or `v:<cookie id>` for anonymous visitors.
 */
const profileVisitSchema = new Schema(
  {
    biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
    viewerKey: { type: String, required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (UTC)
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

profileVisitSchema.index({ biodata: 1, viewerKey: 1, day: 1 }, { unique: true });
profileVisitSchema.index({ biodata: 1, createdAt: -1 });
profileVisitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * RETENTION_DAYS });

export const ProfileVisit = mongoose.model('ProfileVisit', profileVisitSchema);
