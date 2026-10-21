import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { deliver } from '../integrations/messaging/index.js';
import { Otp } from '../models/index.js';
import { ApiError, badRequest } from '../utils/api-error.js';

// One-time codes for account verification and password reset, sent by email or SMS.

const TTL_MIN = 10;
const RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;

const hashCode = (identifier, code) =>
  crypto.createHmac('sha256', env.JWT_ACCESS_SECRET).update(`${identifier}:${code}`).digest('hex');

const MESSAGES = {
  verify: {
    subject: 'Verify your Ghotok account',
    text: (code) =>
      `Ghotok: your verification code is ${code}. It expires in ${TTL_MIN} minutes. / ঘটক যাচাই কোড: ${code}`,
  },
  login: {
    subject: 'Your Ghotok sign-in code',
    text: (code) =>
      `Ghotok: your sign-in code is ${code}. It expires in ${TTL_MIN} minutes. Never share it. / ঘটক লগইন কোড: ${code}`,
  },
  reset: {
    subject: 'Reset your Ghotok password',
    text: (code) =>
      `Ghotok: your password reset code is ${code}. It expires in ${TTL_MIN} minutes. / ঘটক পাসওয়ার্ড রিসেট কোড: ${code}`,
  },
};

/**
 * Creates and sends a 6-digit code, replacing any earlier unused code.
 * @param {string} identifier email or normalised phone number
 * @param {'verify' | 'reset'} purpose
 * @returns {Promise<string | undefined>} the code, only when OTP_DEV_ECHO is enabled
 * @throws {ApiError} 429 OTP_TOO_SOON when asked again within a minute
 */
export async function issueOtp(identifier, purpose) {
  const recent = await Otp.findOne({ identifier, purpose, consumedAt: null }).sort({ createdAt: -1 });
  if (recent && Date.now() - recent.createdAt.getTime() < RESEND_SECONDS * 1000) {
    throw new ApiError(
      429,
      'OTP_TOO_SOON',
      `Please wait ${RESEND_SECONDS} seconds before requesting another code.`,
    );
  }
  await Otp.updateMany({ identifier, purpose, consumedAt: null }, { consumedAt: new Date() });
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await Otp.create({
    identifier,
    purpose,
    codeHash: hashCode(identifier, code),
    expiresAt: new Date(Date.now() + TTL_MIN * 60e3),
  });
  await deliver(identifier, { subject: MESSAGES[purpose].subject, text: MESSAGES[purpose].text(code) });
  return env.OTP_DEV_ECHO ? code : undefined;
}

/** Like issueOtp, but returns undefined instead of failing when a code was sent moments ago. */
export async function issueOtpIfDue(identifier, purpose) {
  try {
    return await issueOtp(identifier, purpose);
  } catch (err) {
    if (err.code === 'OTP_TOO_SOON') return undefined;
    throw err;
  }
}

/**
 * Consumes a valid code.
 * @throws {ApiError} 400 OTP_INVALID for a wrong, expired or over-tried code
 */
export async function consumeOtp(identifier, purpose, code) {
  const otp = await Otp.findOne({
    identifier,
    purpose,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({
    createdAt: -1,
  });
  if (!otp || otp.attempts >= MAX_ATTEMPTS)
    throw badRequest('OTP_INVALID', 'The code is invalid or has expired.');
  const expected = Buffer.from(otp.codeHash, 'hex');
  const given = Buffer.from(hashCode(identifier, String(code ?? '').trim()), 'hex');
  if (!crypto.timingSafeEqual(expected, given)) {
    await Otp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw badRequest('OTP_INVALID', 'The code is invalid or has expired.');
  }
  await Otp.updateOne({ _id: otp._id }, { consumedAt: new Date() });
}
