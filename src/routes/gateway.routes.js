import express, { Router } from 'express';
import * as payment from '../controllers/payment.controller.js';
import { validate } from '../middlewares/validate.js';
import { postbackParams } from '../validations/payment.validation.js';

// Payment gateway postbacks: /api/gateway. Mounted before the origin check (the
// gateway's own page submits the form), so nothing here trusts the request: every
// result is confirmed with the gateway's validation API before crediting.
const router = Router();
router.use(express.urlencoded({ extended: false, limit: '50kb' }));

router.post('/:method/return', validate({ params: postbackParams }), payment.gatewayReturn);
router.post('/:method/ipn', validate({ params: postbackParams }), payment.gatewayIpn);

export default router;
