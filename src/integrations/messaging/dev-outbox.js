import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

// With OTP_DEV_ECHO (development and tests only) the last code sent to each email or
// phone number is kept in memory and logged, so you can sign in without a mail or SMS
// provider. The API refuses to start in production with OTP_DEV_ECHO on.

const codes = new Map();

export function recordDevCode(to, code) {
  if (!env.OTP_DEV_ECHO) return;
  codes.set(to, code);
  logger.info({ to, code }, 'Development one-time code');
}

/** The last code sent to `to` (tests and local development only). */
export function lastDevCode(to) {
  return codes.get(to);
}
