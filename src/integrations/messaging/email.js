import nodemailer from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

let transport;

function getTransport() {
  if (!env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transport;
}

/** Sends an email through SMTP, or logs it when SMTP is not configured (development). */
export async function sendEmail({ to, subject, text, html }) {
  const t = getTransport();
  if (!t) {
    logger.info({ to, subject, text }, 'Email (SMTP not configured, logged instead)');
    return;
  }
  await t.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
}
