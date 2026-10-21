import { z } from 'zod';
import { PROPOSAL_STATUS, optionValues } from '@ghotok/shared';
import { password } from './common.validation.js';

export const updateProfile = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  language: z.enum(['en', 'bn']).optional(),
});

export const changePassword = z.object({ currentPassword: z.string().min(1), newPassword: password });

export const deactivate = z.object({
  password: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

export const proposalsQuery = z.object({
  box: z.enum(['sent', 'received']).catch('received'),
  status: z.enum(optionValues(PROPOSAL_STATUS)).optional().catch(undefined),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const respondToProposal = z.object({
  action: z.enum(['accept', 'decline']),
  note: z.string().trim().max(500).optional(),
});
