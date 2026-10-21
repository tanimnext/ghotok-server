import express, { Router } from 'express';
import * as upload from '../controllers/upload.controller.js';
import { ATTACHMENT_TYPES, MAX_FILE_BYTES } from '../integrations/storage/index.js';

// Signed upload/download URLs of the local storage driver: /api/uploads
const router = Router();

router.put(
  '/local/:token',
  // Each signed upload names the type it accepts; the size limit per type is checked when saving.
  express.raw({ type: ATTACHMENT_TYPES, limit: MAX_FILE_BYTES }),
  upload.upload,
);
router.get('/file/:token', upload.download);

export default router;
