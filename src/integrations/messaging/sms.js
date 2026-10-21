import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Sends an SMS through any GET-based Bangladeshi SMS API configured in SMS_API_URL
 * ({number} → 8801XXXXXXXXX, {message} → the text), or logs it when not configured.
 */
export async function sendSms({ to, message }) {
  if (!env.SMS_API_URL) {
    logger.info({ to, message }, 'SMS (gateway not configured, logged instead)');
    return;
  }
  const url = env.SMS_API_URL.replace('{number}', encodeURIComponent(`88${to}`)).replace(
    '{message}',
    encodeURIComponent(message),
  );
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
}
