import { Router } from 'express';
import * as payment from '../controllers/payment.controller.js';
import { requireAuth, requireVerified } from '../middlewares/auth.js';
import { writeLimiter } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import * as schema from '../validations/payment.validation.js';

const router = Router();

router.get('/packages', payment.catalogue);
router.post(
  '/payments',
  requireAuth,
  requireVerified,
  writeLimiter,
  validate({ body: schema.createPayment }),
  payment.create,
);
router.get('/payments/mine', requireAuth, payment.mine);
router.get(
  '/payments/status/:invoiceNo',
  requireAuth,
  validate({ params: schema.invoiceParams }),
  payment.status,
);
router.get('/payments/:method/callback', payment.gatewayCallback);
router.post(
  '/refunds',
  requireAuth,
  writeLimiter,
  validate({ body: schema.requestRefund }),
  payment.requestRefund,
);
router.get('/refunds/mine', requireAuth, payment.myRefunds);

export default router;
