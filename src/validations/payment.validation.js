import { z } from 'zod';
import {
  ADJUSTMENT_ACTIONS,
  LEDGER_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  REFUND_RESOLUTIONS,
  REFUND_STATUS,
  isValidPhone,
  normalizePhone,
  optionValues,
} from '@ghotok/shared';
import { objectId } from './common.validation.js';

const method = z.enum(optionValues(PAYMENT_METHODS));

/** Manual payments need the sender number and transaction ID; gateway checkouts do not. */
export const createPayment = z
  .object({
    packageId: objectId,
    method,
    mode: z.enum(['manual', 'gateway']).default('manual'),
    senderNumber: z.string().trim().max(20).optional(),
    trxId: z.string().trim().max(40).optional(),
  })
  .transform((v, ctx) => {
    if (v.mode === 'gateway') return { packageId: v.packageId, method: v.method, mode: v.mode };
    const senderNumber = normalizePhone(v.senderNumber);
    const trxId = String(v.trxId ?? '').toUpperCase();
    if (!isValidPhone(senderNumber)) {
      ctx.addIssue({
        code: 'custom',
        path: ['senderNumber'],
        message: 'Enter the mobile number you paid from.',
      });
    }
    if (!/^[A-Z0-9]{6,20}$/.test(trxId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['trxId'],
        message: 'Enter the transaction ID from the confirmation SMS.',
      });
    }
    return { ...v, senderNumber, trxId };
  });

export const requestRefund = z.object({
  paymentId: objectId,
  reason: z.string().trim().min(10, 'Please explain the reason.').max(1000),
});

// ----- Staff -------------------------------------------------------------------

export const paymentsQuery = z.object({
  status: z.enum(optionValues(PAYMENT_STATUS)).optional().catch(undefined),
  method: method.optional().catch(undefined),
  mode: z.enum(['manual', 'gateway']).optional().catch(undefined),
  q: z.string().trim().max(60).optional(),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const rejectPayment = z.object({
  reason: z.string().trim().min(3, 'Add a reason for the user.').max(500),
});

export const refundsQuery = z.object({
  status: z.enum(optionValues(REFUND_STATUS)).optional().catch(undefined),
  page: z.string().optional(),
  limit: z.string().optional(),
});

export const approveRefund = z.object({
  resolution: z.enum(optionValues(REFUND_RESOLUTIONS)),
  connections: z.number().int().min(0).max(1000).optional(),
  amount: z.number().min(0).max(1_000_000).optional(),
  refundTrxId: z.string().trim().max(40).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const rejectRefund = z.object({
  note: z.string().trim().min(3, 'Add a note for the user.').max(1000),
});

export const adjustConnections = z.object({
  user: z.string().trim().min(3, 'Enter a user id, email or mobile number.'),
  action: z.enum(optionValues(ADJUSTMENT_ACTIONS)),
  quantity: z.number().int().min(1).max(1000),
  reason: z.string().trim().min(3, 'The reason is saved in the audit log.').max(500),
});

export const ledgerQuery = z.object({
  user: z.string().trim().max(120).optional(),
  type: z.enum(optionValues(LEDGER_TYPES)).optional().catch(undefined),
  page: z.string().optional(),
  limit: z.string().optional(),
});

const packageFields = {
  name: z.object({ en: z.string().trim().min(1).max(60), bn: z.string().trim().max(60).optional() }),
  description: z
    .object({ en: z.string().trim().max(200).optional(), bn: z.string().trim().max(200).optional() })
    .optional(),
  connections: z.number().int().min(1).max(1000),
  price: z.number().int().min(1).max(1_000_000),
  isActive: z.boolean().optional(),
  highlight: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
};

export const createPackage = z.object(packageFields);
export const updatePackage = z.object(packageFields).partial();

export const invoiceParams = z.object({
  invoiceNo: z
    .string()
    .trim()
    .regex(/^INV-[A-Z0-9-]{4,40}$/i),
});

/** Gateways that post their result back to us (form posts from the customer's browser and IPN). */
export const postbackParams = z.object({ method: z.enum(['sslcommerz']) });
