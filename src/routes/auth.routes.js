import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { authLimiter, otpLimiter } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import * as schema from '../validations/auth.validation.js';

const router = Router();

router.post('/register', authLimiter, validate({ body: schema.register }), auth.register);
router.post('/login', authLimiter, validate({ body: schema.login }), auth.login);
router.post('/login/code', otpLimiter, validate({ body: schema.loginCodeRequest }), auth.requestLoginCode);
router.post(
  '/login/code/verify',
  authLimiter,
  validate({ body: schema.loginCodeVerify }),
  auth.loginWithCode,
);
router.get('/google/start', authLimiter, validate({ query: schema.googleStart }), auth.googleStart);
router.get('/google/callback', authLimiter, validate({ query: schema.googleCallback }), auth.googleCallback);
router.post('/verify', otpLimiter, validate({ body: schema.verify }), auth.verify);
router.post('/resend-otp', otpLimiter, validate({ body: schema.resendOtp }), auth.resendOtp);
router.post('/forgot-password', otpLimiter, validate({ body: schema.forgotPassword }), auth.forgotPassword);
router.post('/reset-password', authLimiter, validate({ body: schema.resetPassword }), auth.resetPassword);
router.post('/refresh', auth.refresh);
router.post('/logout', auth.logout);
router.get('/me', requireAuth, auth.me);
router.get('/sessions', requireAuth, auth.sessions);
router.delete(
  '/sessions/:id',
  requireAuth,
  validate({ params: schema.sessionParams }),
  auth.revokeSessionById,
);
router.post('/logout-all', requireAuth, auth.logoutEverywhere);

export default router;
