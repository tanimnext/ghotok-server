import { isStaff } from '@ghotok/shared';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { ApiError, badRequest, conflict } from '../utils/api-error.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { consumeOtp, issueOtp, issueOtpIfDue } from './otp.service.js';
import { revokeAllSessions, revokeSession, rotateSession, signAccessToken } from './token.service.js';

/** @typedef {{ field: 'email' | 'phone', value: string }} Identifier */

const INACTIVE = ['suspended', 'banned'];

const findByIdentifier = (id, { withPassword = false } = {}) => {
  const query = User.findOne({ [id.field]: id.value });
  return withPassword ? query.select('+passwordHash') : query;
};

function assertActive(user) {
  if (INACTIVE.includes(user.status)) {
    throw new ApiError(403, 'ACCOUNT_INACTIVE', `Your account is ${user.status}. Please contact support.`);
  }
}

/**
 * Creates an account. When verification is required, a code is sent and the
 * caller must call `verify` next; otherwise the new user can be signed in.
 * @returns {Promise<{ user: object, needsVerification: boolean, identifier?: string, devOtp?: string }>}
 */
export async function register({ name, email, phone, password, language }) {
  if (!email && !phone) {
    throw badRequest('VALIDATION_ERROR', 'Enter an email or a mobile number.', {
      fields: { email: 'required' },
    });
  }
  const or = [email && { email }, phone && { phone }].filter(Boolean);
  if (await User.exists({ $or: or })) {
    throw conflict('ACCOUNT_EXISTS', 'An account with this email or mobile number already exists.');
  }
  const user = await User.create({
    name,
    email,
    phone,
    passwordHash: await hashPassword(password),
    language,
  });
  if (!env.REQUIRE_VERIFICATION) return { user, needsVerification: false };
  const identifier = email ?? phone;
  const devOtp = await issueOtpIfDue(identifier, 'verify');
  return { user, needsVerification: true, identifier, devOtp };
}

/**
 * Checks credentials. Unverified members get a fresh code and a 403 NOT_VERIFIED.
 * @param {{ identifier: Identifier, password: string }} input
 */
export async function login({ identifier, password }) {
  const user = await findByIdentifier(identifier, { withPassword: true });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'The email/mobile number or password is incorrect.');
  }
  assertActive(user);
  const verified = user.emailVerified || user.phoneVerified;
  if (env.REQUIRE_VERIFICATION && !verified && !isStaff(user.role)) {
    const devOtp = await issueOtpIfDue(identifier.value, 'verify');
    throw new ApiError(403, 'NOT_VERIFIED', 'Please verify your account. We have sent you a code.', {
      identifier: identifier.value,
      ...(devOtp ? { devOtp } : {}),
    });
  }
  // Logging in again reactivates an account the member deactivated themselves.
  if (user.status === 'deactivated') {
    user.status = 'active';
    user.deactivatedAt = undefined;
  }
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

const markVerified = (user, field) => {
  if (field === 'email') user.emailVerified = true;
  else user.phoneVerified = true;
};

/**
 * Passwordless sign-in, step 1: sends a one-time code to the account's email or
 * phone. Answers the same way whether or not the account exists.
 */
export async function requestLoginCode({ identifier }) {
  const user = await findByIdentifier(identifier);
  if (!user || INACTIVE.includes(user.status)) return {};
  return { devOtp: await issueOtpIfDue(identifier.value, 'login') };
}

/** Passwordless sign-in, step 2: the code proves the member owns that email or phone. */
export async function loginWithCode({ identifier, code }) {
  const user = await findByIdentifier(identifier);
  if (!user) throw badRequest('OTP_INVALID', 'The code is invalid or has expired.');
  await consumeOtp(identifier.value, 'login', code);
  assertActive(user);
  markVerified(user, identifier.field);
  if (user.status === 'deactivated') {
    user.status = 'active';
    user.deactivatedAt = undefined;
  }
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

/** Confirms the verification code sent to an email or phone number. */
export async function verify({ identifier, code }) {
  const user = await findByIdentifier(identifier);
  if (!user) throw badRequest('OTP_INVALID', 'The code is invalid or has expired.');
  await consumeOtp(identifier.value, 'verify', code);
  markVerified(user, identifier.field);
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

/** Sends a new code. Answers the same way whether or not the account exists. */
export async function resendOtp({ identifier, purpose }) {
  const user = await findByIdentifier(identifier);
  if (!user) return {};
  const alreadyVerified = identifier.field === 'email' ? user.emailVerified : user.phoneVerified;
  if (purpose === 'verify' && alreadyVerified) return {};
  return { devOtp: await issueOtp(identifier.value, purpose) };
}

/** Sends a password reset code. Answers the same way whether or not the account exists. */
export async function forgotPassword({ identifier }) {
  const user = await findByIdentifier(identifier);
  if (!user) return {};
  return { devOtp: await issueOtpIfDue(identifier.value, 'reset') };
}

/**
 * Sets a new password with a reset code and signs out every device.
 * @returns {Promise<object | null>} the user to sign in, or null if the account is not active
 */
export async function resetPassword({ identifier, code, password }) {
  const user = await findByIdentifier(identifier);
  if (!user) throw badRequest('OTP_INVALID', 'The code is invalid or has expired.');
  await consumeOtp(identifier.value, 'reset', code);
  user.passwordHash = await hashPassword(password);
  // Receiving the code proves ownership of the email or phone number.
  markVerified(user, identifier.field);
  await user.save();
  await revokeAllSessions(user._id);
  return INACTIVE.includes(user.status) ? null : user;
}

/**
 * Rotates a refresh token and issues a new access token.
 * @returns {Promise<{ user: object, tokens: { accessToken: string, refreshToken: string, expiresIn: number } }>}
 * @throws {ApiError} 401 SESSION_EXPIRED
 */
export async function refresh(rawToken, client) {
  const rotated = await rotateSession(rawToken, client);
  const user = rotated && (await User.findById(rotated.userId));
  if (!user || INACTIVE.includes(user.status))
    throw new ApiError(401, 'SESSION_EXPIRED', 'Please log in again.');
  return {
    user,
    tokens: {
      accessToken: signAccessToken(user, rotated.family),
      refreshToken: rotated.token,
      persistent: rotated.persistent,
      expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60,
    },
  };
}

export const logout = (rawToken) => revokeSession(rawToken);

/**
 * Signs in with a verified Google profile: by linked Google account, else by the
 * same email (linking it), else as a new member with that email verified.
 */
export async function loginWithGoogle({ googleId, email, name }) {
  let user = (await User.findOne({ googleId })) ?? (await User.findOne({ email }));
  if (!user) {
    user = await User.create({ name: name.slice(0, 80), email, googleId, emailVerified: true });
  } else {
    assertActive(user);
    user.googleId ??= googleId;
    if (user.email === email) user.emailVerified = true;
    if (user.status === 'deactivated') {
      user.status = 'active';
      user.deactivatedAt = undefined;
    }
  }
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}
