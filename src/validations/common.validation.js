import { z } from 'zod';
import { isValidEmail, isValidPhone, normalizePhone } from '../shared/index.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const idParams = z.object({ id: objectId });

/** Optional pagination params; the values are read with utils/pagination.js. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const i18nText = (max) =>
  z.object({ en: z.string().max(max).default(''), bn: z.string().max(max).default('') });

export const password = z.string().min(8, 'Use at least 8 characters.').max(128);

export const optionalEmail = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v.toLowerCase() : undefined))
  .refine((v) => !v || isValidEmail(v), 'Enter a valid email address.');

export const optionalPhone = z
  .string()
  .trim()
  .max(20)
  .optional()
  .transform((v) => (v ? normalizePhone(v) : undefined))
  .refine((v) => !v || isValidPhone(v), 'Enter a valid mobile number (01XXXXXXXXX).');

// Images are uploaded by the browser straight to ImgBB; the API only stores the links.
// Accepting only ImgBB hosts keeps arbitrary third-party URLs out of tickets and banners.
const IMGBB_HOSTS = new Set(['i.ibb.co', 'ibb.co']);

export function isImgbbUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && IMGBB_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export const imgbbUrl = z
  .string()
  .trim()
  .max(500)
  .refine(isImgbbUrl, 'Upload the image through ImgBB (https://i.ibb.co/…).');

/** Up to five ImgBB image links attached to a support message or report. */
export const imageAttachments = z.array(imgbbUrl).max(5, 'Attach at most 5 images.').optional();
