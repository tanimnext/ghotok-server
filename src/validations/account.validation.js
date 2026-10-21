import { z } from 'zod';
import { PROPOSAL_STATUS, optionValues } from '../shared/index.js';

export const updateProfile = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  language: z.enum(['en', 'bn']).optional(),
});

export const deactivate = z.object({
  // Required when the account has a password (members who only use codes or Google have none).
  password: z.string().max(128).optional(),
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
