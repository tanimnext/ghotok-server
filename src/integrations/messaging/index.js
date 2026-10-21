import { logger } from '../../config/logger.js';
import { sendEmail } from './email.js';
import { sendSms } from './sms.js';

export { sendEmail, sendSms };

/** Sends a message to an email address or a phone number, whichever `to` is. Never throws. */
export async function deliver(to, { subject, text }) {
  try {
    if (to.includes('@')) await sendEmail({ to, subject, text });
    else await sendSms({ to, message: text });
  } catch (err) {
    logger.error({ err, to }, 'Message delivery failed');
  }
}
