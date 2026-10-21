import mongoose from 'mongoose';

const { Schema } = mongoose;

/** A paid contact unlock. Permanent: once a user pays for a contact, they keep access to it. */
const contactUnlockSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
    transaction: { type: Schema.Types.ObjectId, ref: 'ConnectionTransaction' },
    // Set when staff uphold the member's report about this biodata and return the connection.
    refundedAt: Date,
  },
  { timestamps: true },
);

// The unique index is what makes unlocking idempotent under concurrent requests.
contactUnlockSchema.index({ user: 1, biodata: 1 }, { unique: true });
contactUnlockSchema.index({ biodata: 1 });

export const ContactUnlock = mongoose.model('ContactUnlock', contactUnlockSchema);
