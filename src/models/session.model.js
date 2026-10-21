import mongoose from 'mongoose';

const { Schema } = mongoose;

// One row per issued refresh token. Tokens rotate on every refresh; a reused
// (already rotated) token revokes its whole family.
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedAt: Date,
    userAgent: String,
    ip: String,
    // false when the member did not tick "Remember me": the cookies then end with the browser session.
    persistent: { type: Boolean, default: true },
  },
  { timestamps: true },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model('Session', sessionSchema);
