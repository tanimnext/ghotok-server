import { Router } from 'express';
import * as content from '../controllers/content.controller.js';
import { writeLimiter } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import { pageParams } from '../validations/admin.validation.js';
import { idParams } from '../validations/common.validation.js';

// Public site content: /api/public
const router = Router();

router.get('/stats', content.stats);
router.get('/settings', content.settings);
router.get('/pages/:slug', validate({ params: pageParams }), content.page);
router.get('/faqs', content.faqs);
router.get('/success-stories', content.successStories);
router.get('/banners', content.banners);
router.post('/banners/:id/download', writeLimiter, validate({ params: idParams }), content.downloadBanner);

export default router;
