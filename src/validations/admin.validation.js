import { z } from 'zod';
import {
  BIODATA_SECTIONS,
  BIODATA_STATUS,
  NID_STATUS,
  RELIGIONS,
  RESTORE_STATUS,
  ROLE_OPTIONS,
  USER_STATUS_OPTIONS,
  optionValues,
} from '@ghotok/shared';
import { i18nText, optionalEmail, optionalPhone, password } from './common.validation.js';

const list = { page: z.string().optional(), limit: z.string().optional() };
const loose = (schema) => schema.optional().catch(undefined);

// ----- Biodatas ------------------------------------------------------------------

export const biodatasQuery = z.object({
  status: loose(z.enum(optionValues(BIODATA_STATUS))),
  nid: loose(z.enum(optionValues(NID_STATUS))),
  type: loose(z.enum(['bride', 'groom'])),
  religion: loose(z.enum(optionValues(RELIGIONS))),
  hidden: z.string().optional(),
  blocked: z.string().optional(),
  deleted: loose(z.enum(['true', 'false', 'all'])),
  q: z.string().trim().max(80).optional(),
  ...list,
});

const correction = z
  .object({
    section: z.string(),
    field: z.string(),
    note: z.string().trim().max(300).optional(),
  })
  .refine(
    (c) => BIODATA_SECTIONS.some((s) => s.key === c.section && s.fields.some((f) => f.key === c.field)),
    'Unknown biodata field.',
  );

export const rejectBiodata = z.object({
  reason: z.string().trim().min(5, 'Tell the user what to change.').max(1000),
  corrections: z.array(correction).max(60).optional(),
});

export const suspendEdit = z.object({
  until: z.coerce
    .date()
    .refine((d) => d.getTime() > Date.now(), 'Choose a date in the future.')
    .nullable(),
  reason: z.string().trim().max(500).optional(),
});

export const blockBiodata = z.object({ blocked: z.boolean(), reason: z.string().trim().max(500).optional() });

export const deleteBiodata = z.object({ reason: z.string().trim().min(3).max(500) });

export const note = z.object({ note: z.string().trim().max(500).optional() });

export const declineRestore = z.object({
  note: z.string().trim().max(500).optional(),
  permanent: z.boolean().optional(),
});

export const restoreRequestsQuery = z.object({
  status: loose(z.enum(optionValues(RESTORE_STATUS))),
  ...list,
});

// ----- Users -------------------------------------------------------------------

export const usersQuery = z.object({
  q: z.string().trim().max(80).optional(),
  role: loose(z.enum([...optionValues(ROLE_OPTIONS), 'staff'])),
  status: loose(z.enum(optionValues(USER_STATUS_OPTIONS))),
  verified: z.string().optional(),
  ...list,
});

/** `null` clears an email or phone number; `undefined` leaves it unchanged. */
const clearable = (schema) => z.union([z.null(), z.literal('').transform(() => null), schema]);

export const updateUser = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: clearable(optionalEmail).optional(),
  phone: clearable(optionalPhone).optional(),
  role: z.enum(optionValues(ROLE_OPTIONS)).optional(),
  status: z.enum(optionValues(USER_STATUS_OPTIONS)).optional(),
  statusReason: z.string().trim().max(500).optional(),
  emailVerified: z.boolean().optional(),
  phoneVerified: z.boolean().optional(),
});

export const createUser = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: optionalEmail,
    phone: optionalPhone,
    password,
    role: z.enum(optionValues(ROLE_OPTIONS)).default('support'),
  })
  .refine((v) => v.email || v.phone, { message: 'Enter an email or a mobile number.', path: ['email'] });

export const resetUserPassword = z.object({ password });

// ----- Content and settings -----------------------------------------------------------

export const settingsParams = z.object({ key: z.enum(['site', 'payments', 'stats', 'moderation']) });

export const updateSettings = z.object({
  value: z
    .record(z.string(), z.unknown())
    .refine((v) => JSON.stringify(v).length <= 20000, 'Setting value is too large.'),
});

export const pageParams = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,60}$/, 'Use lowercase letters, numbers and dashes.'),
});

export const upsertPage = z.object({
  title: i18nText(160),
  body: i18nText(60000),
  isPublished: z.boolean().default(true),
});

// No defaults here: zod applies defaults inside .partial(), which would reset fields on update.
const faqFields = z.object({
  question: i18nText(300),
  answer: i18nText(5000),
  category: z.string().trim().max(40),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export const createFaq = faqFields.partial({ category: true, sortOrder: true, isActive: true });
export const updateFaq = faqFields.partial();

export const analyticsQuery = z.object({ days: z.coerce.number().int().min(7).max(365).catch(30) });

export const auditQuery = z.object({
  action: z.string().trim().max(60).optional(),
  targetId: z.string().trim().max(60).optional(),
  ...list,
});

// ----- Success stories and banners ------------------------------------------------

export const storiesQuery = z.object({ status: loose(z.enum(['pending', 'published', 'hidden'])), ...list });

export const updateStory = z.object({
  storyStatus: z.enum(['pending', 'published', 'hidden']).optional(),
  publishedStory: z.string().trim().max(2000).optional(),
});

const MB = 1024 * 1024;
export const bannerUpload = z
  .object({
    kind: z.enum(['preview', 'file']),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    size: z
      .number()
      .int()
      .min(1)
      .max(10 * MB),
  })
  .refine((v) => (v.kind === 'file') === (v.contentType === 'application/pdf'), {
    message: 'Upload the design as a PDF and the preview as an image.',
    path: ['contentType'],
  })
  .refine((v) => v.kind === 'file' || v.size <= 5 * MB, {
    message: 'The preview image can be at most 5 MB.',
    path: ['size'],
  });

const bannerFields = {
  title: z.object({ en: z.string().trim().min(1).max(120), bn: z.string().trim().max(120).optional() }),
  fileName: z.string().trim().max(120).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
};
export const createBanner = z.object({
  ...bannerFields,
  previewTicket: z.string().min(10),
  fileTicket: z.string().min(10),
});
export const updateBanner = z.object(bannerFields).partial();
