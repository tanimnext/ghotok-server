import { z } from 'zod';
import { isValidEmail, isValidPhone, normalizePhone } from '@ghotok/shared';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const idParams = z.object({ id: objectId });

/** Optional pagination params; the values are read with utils/pagination.js. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const i18nText = (max) =>
  z.object({ en: z.string().max(max).default(''), bn: z.string().max(max).default('') });

/** Accepts an email or a Bangladeshi mobile number (any common format) and normalises it. */
export const identifier = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .transform((value, ctx) => {
    if (value.includes('@')) {
      const email = value.toLowerCase();
      if (isValidEmail(email)) return { field: 'email', value: email };
    } else {
      const phone = normalizePhone(value);
      if (isValidPhone(phone)) return { field: 'phone', value: phone };
    }
    ctx.addIssue({ code: 'custom', message: 'Enter a valid email or mobile number.' });
    return z.NEVER;
  });

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
