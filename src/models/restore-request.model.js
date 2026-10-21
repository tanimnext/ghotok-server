import mongoose from 'mongoose';
import { RESTORE_STATUS, optionValues } from '@ghotok/shared';

const { Schema } = mongoose;

/** A member's request to bring back their soft-deleted biodata (the "recovery queue"). */
const restoreRequestSchema = new Schema(
  {
    biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, maxlength: 1000 },
    status: { type: String, enum: optionValues(RESTORE_STATUS), default: 'pending', index: true },
    note: { type: String, maxlength: 500 },
    // A permanent decline stops the member from asking again.
    permanent: { type: Boolean, default: false },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
  },
  { timestamps: true },
);

restoreRequestSchema.index({ biodata: 1, createdAt: -1 });

export const RestoreRequest = mongoose.model('RestoreRequest', restoreRequestSchema);
