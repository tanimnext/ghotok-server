import { z } from 'zod';
import { DELETE_REASONS, HIDE_REASONS, REPORT_REASONS, SECTION_KEYS, optionValues } from '../shared/index.js';
import { imageAttachments } from './common.validation.js';

// Section contents are validated by the shared form schema (validateSection), not here.

export const sectionParams = z.object({ section: z.enum(SECTION_KEYS, { message: 'Unknown section' }) });

export const saveSection = z.object({ data: z.record(z.string(), z.unknown()).default({}) });

export const biodataNoParams = z.object({
  no: z
    .string()
    .trim()
    .regex(/^GH-\d{1,10}$/i, 'Invalid biodata number'),
});

export const createBiodata = z.object({
  pledge: z.literal(true, { message: 'Please accept the pledge to continue.' }),
});

export const visibility = z
  .object({
    hidden: z.boolean(),
    reason: z.enum(optionValues(HIDE_REASONS)).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => !v.hidden || v.reason, {
    message: 'Tell us why you are hiding your biodata.',
    path: ['reason'],
  })
  .refine((v) => !v.hidden || v.reason !== 'other' || v.note, {
    message: 'Please write your reason.',
    path: ['note'],
  });

const marriage = z.object({
  marriedOn: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + 864e5, 'The date cannot be in the future.')
    .optional(),
  place: z.string().trim().max(120).optional(),
  partnerBiodataNo: z
    .string()
    .trim()
    .regex(/^GH-\d{1,10}$/i, 'Enter a biodata number like GH-1024.')
    .optional(),
  partner: z
    .object({
      name: z.string().trim().max(80).optional(),
      district: z.string().trim().max(40).optional(),
      profession: z.string().trim().max(60).optional(),
      education: z.string().trim().max(60).optional(),
    })
    .optional(),
  story: z.string().trim().max(2000).optional(),
  shareStory: z.boolean().optional(),
});

export const partnerLookup = z.object({
  no: z
    .string()
    .trim()
    .regex(/^GH-\d{1,10}$/i),
});

export const deleteBiodata = z.object({
  reason: z.enum(optionValues(DELETE_REASONS)),
  note: z.string().trim().max(500).optional(),
  marriage: marriage.optional(),
});

export const restoreRequest = z.object({ reason: z.string().trim().max(1000).optional() });

export const proposal = z.object({ message: z.string().trim().max(1000).optional() });

export const report = z.object({
  reason: z.enum(optionValues(REPORT_REASONS)),
  details: z.string().trim().max(2000).optional(),
  attachments: imageAttachments,
});

const text = z.string().trim().max(200).optional();

/** Search filters. Unknown parameters are dropped; values are interpreted by search.service.js. */
export const searchQuery = z.object({
  type: text,
  religion: text,
  marital: text,
  complexion: text,
  profession: text,
  economic: text,
  division: text,
  district: z.string().trim().max(1000).optional(),
  upazila: z.string().trim().max(3000).optional(),
  presentDistrict: z.string().trim().max(1000).optional(),
  presentUpazila: z.string().trim().max(3000).optional(),
  medium: text,
  category: text,
  scope: text,
  ageMin: text,
  ageMax: text,
  heightMin: text,
  heightMax: text,
  education: text,
  q: text,
  sort: text,
  page: text,
  limit: text,
});

export const featuredQuery = z.object({ limit: z.coerce.number().int().min(1).max(12).catch(4) });
