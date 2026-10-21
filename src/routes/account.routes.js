import { Router } from 'express';
import * as account from '../controllers/account.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import * as schema from '../validations/account.validation.js';
import { idParams } from '../validations/common.validation.js';

// The signed-in member's own account: /api/me
const router = Router();
router.use(requireAuth);

router.get('/dashboard', account.dashboard);
router.patch('/', validate({ body: schema.updateProfile }), account.updateProfile);
router.post('/change-password', validate({ body: schema.changePassword }), account.changePassword);
router.delete('/', validate({ body: schema.deactivate }), account.deactivate);

router.get('/favorites', account.favorites);
router.get('/dislikes', account.dislikes);
router.get('/favorited-me', account.favoritedMe);
router.get('/unlocks', account.unlocks);
router.get('/connections', account.connections);

router.get('/proposals', validate({ query: schema.proposalsQuery }), account.proposals);
router.post(
  '/proposals/:id/respond',
  validate({ params: idParams, body: schema.respondToProposal }),
  account.respondToProposal,
);
router.post('/proposals/:id/withdraw', validate({ params: idParams }), account.withdrawProposal);

router.get('/notifications', account.notifications);
router.post('/notifications/read-all', account.markAllNotificationsRead);
router.post('/notifications/:id/read', validate({ params: idParams }), account.markNotificationRead);
router.delete('/notifications/:id', validate({ params: idParams }), account.deleteNotification);

export default router;
