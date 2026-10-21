import mongoose from 'mongoose';
import { ROLE_OPTIONS, USER_STATUS_OPTIONS, optionValues } from '../shared/index.js';

const { Schema } = mongoose;

/** Members who sign up with an SMS code get a placeholder email on this domain (see config/auth.js). */
export const PHONE_EMAIL_DOMAIN = 'phone.ghotok.local';

/**
 * An account, stored in Better Auth's `user` collection. Better Auth creates and
 * signs in accounts (name, email, emailVerified, image, phoneNumber,
 * phoneNumberVerified, role, status, connectionBalance, language); this model adds
 * the fields only the API uses and lets the rest of the code query accounts.
 *
 * `role` is "user" for members and "admin" for admins. Passwords live in Better
 * Auth's `account` collection and sessions in `session`.
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
    emailVerified: { type: Boolean, default: false },
    image: String,
    phoneNumber: { type: String, trim: true, maxlength: 20 },
    phoneNumberVerified: { type: Boolean, default: false },
    role: { type: String, enum: optionValues(ROLE_OPTIONS), default: 'user', index: true },
    status: { type: String, enum: optionValues(USER_STATUS_OPTIONS), default: 'active', index: true },
    statusReason: { type: String, maxlength: 500 },
    connectionBalance: { type: Number, default: 0, min: 0 },
    connectionsPurchased: { type: Number, default: 0 },
    connectionsUsed: { type: Number, default: 0 },
    language: { type: String, enum: ['en', 'bn'], default: 'en' },
    lastLoginAt: Date,
    deactivatedAt: Date,
  },
  // Better Auth writes createdAt/updatedAt itself; Mongoose keeps them current on its own writes.
  { collection: 'user', timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index(
  { phoneNumber: 1 },
  { unique: true, partialFilterExpression: { phoneNumber: { $type: 'string' } } },
);
userSchema.index({ createdAt: -1 });

/** The email to show and contact, or null for SMS-only accounts. */
userSchema.virtual('contactEmail').get(function contactEmail() {
  return this.email?.endsWith(`@${PHONE_EMAIL_DOMAIN}`) ? null : this.email;
});

userSchema.virtual('isVerified').get(function isVerified() {
  return !!(this.emailVerified || this.phoneNumberVerified);
});

export const User = mongoose.model('User', userSchema);
