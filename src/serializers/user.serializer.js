import { PHONE_EMAIL_DOMAIN } from '../models/user.model.js';

/** The email to show, or null for SMS-only accounts (works for documents and lean objects). */
export const contactEmail = (user) =>
  user.email && !user.email.endsWith(`@${PHONE_EMAIL_DOMAIN}`) ? user.email : null;

/** Everything the account owner (or an admin) may see about an account. */
export function toUserDTO(user) {
  if (!user) return null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: contactEmail(user),
    phoneNumber: user.phoneNumber ?? null,
    role: user.role,
    status: user.status,
    emailVerified: !!user.emailVerified && !!contactEmail(user),
    phoneNumberVerified: !!user.phoneNumberVerified,
    isVerified: !!(user.emailVerified || user.phoneNumberVerified),
    connectionBalance: user.connectionBalance ?? 0,
    connectionsPurchased: user.connectionsPurchased ?? 0,
    connectionsUsed: user.connectionsUsed ?? 0,
    language: user.language ?? 'en',
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

/** A compact reference to a user, for admin lists. */
export function toUserSummary(user) {
  if (!user || !user._id) return null;
  return {
    id: user._id.toString(),
    name: user.name,
    email: contactEmail(user),
    phoneNumber: user.phoneNumber ?? null,
    role: user.role,
    status: user.status,
  };
}
