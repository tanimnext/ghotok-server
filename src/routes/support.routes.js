import { Router } from 'express';
import * as support from '../controllers/support.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { writeLimiter } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import { idParams } from '../validations/common.validation.js';
import * as schema from '../validations/support.validation.js';

const router = Router();

router.get('/tickets', requireAuth, support.list);
router.post('/tickets', requireAuth, writeLimiter, validate({ body: schema.createTicket }), support.create);
router.post(
  '/tickets/attachments/upload-url',
  requireAuth,
  writeLimiter,
  validate({ body: schema.attachmentUpload }),
  support.attachmentUploadUrl,
);
router.get('/tickets/:id', requireAuth, validate({ params: idParams }), support.get);
router.post(
  '/tickets/:id/messages',
  requireAuth,
  writeLimiter,
  validate({ params: idParams, body: schema.replyToTicket }),
  support.reply,
);
router.post('/tickets/:id/close', requireAuth, validate({ params: idParams }), support.close);
router.post('/contact', writeLimiter, validate({ body: schema.contactMessage }), support.contact);

export default router;
