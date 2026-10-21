import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { google } from '../integrations/oauth/google.js';
import * as authService from '../services/auth.service.js';
import {
  familyOf,
  issueTokens,
  listSessions,
  revokeAllSessions,
  revokeFamily,
} from '../services/token.service.js';
import { toUserDTO } from '../serializers/user.serializer.js';
import { notFound } from '../utils/api-error.js';
import { clearAuthCookies, readRefreshToken, setAuthCookies } from '../utils/auth-cookies.js';
import { requestContext } from '../utils/request.js';

/** Signs a user in: sets the cookies and returns the user plus tokens (for non-browser clients). */
async function signIn(req, res, user, status = 200, { persistent = true } = {}) {
  const tokens = await issueTokens(user, requestContext(req), { persistent });
  setAuthCookies(res, tokens);
  res.status(status).json({ user: toUserDTO(user), ...tokens });
}

export async function register(req, res) {
  const result = await authService.register(req.body);
  if (!result.needsVerification) return signIn(req, res, result.user, 201);
  res.status(201).json({
    needsVerification: true,
    identifier: result.identifier,
    ...(result.devOtp ? { devOtp: result.devOtp } : {}),
  });
}

export async function login(req, res) {
  await signIn(req, res, await authService.login(req.body), 200, { persistent: req.body.remember });
}

export async function requestLoginCode(req, res) {
  const { devOtp } = await authService.requestLoginCode(req.body);
  res.json({ ok: true, ...(devOtp ? { devOtp } : {}) });
}

export async function loginWithCode(req, res) {
  await signIn(req, res, await authService.loginWithCode(req.body), 200, { persistent: req.body.remember });
}

// ----- Google sign-in ----------------------------------------------------------
// The state (CSRF protection), nonce, return path and "remember me" travel in a
// short-lived signed, httpOnly cookie between the start and the callback.

const OAUTH_COOKIE = 'gh_oauth';
const oauthCookie = { httpOnly: true, sameSite: 'lax', secure: env.COOKIE_SECURE, path: '/api/auth/google' };

export function googleStart(req, res) {
  if (!google.enabled) throw notFound('Google sign-in');
  const state = crypto.randomBytes(16).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');
  const next = req.query.next ?? '/dashboard';
  const payload = { state, nonce, next, remember: req.query.remember !== '0' };
  res.cookie(OAUTH_COOKIE, jwt.sign(payload, env.JWT_UPLOAD_SECRET, { expiresIn: '10m' }), {
    ...oauthCookie,
    maxAge: 10 * 60e3,
  });
  res.redirect(google.authorizationUrl({ state, nonce }));
}

export async function googleCallback(req, res) {
  let pending;
  try {
    pending = jwt.verify(req.cookies?.[OAUTH_COOKIE] ?? '', env.JWT_UPLOAD_SECRET);
  } catch {
    pending = null;
  }
  res.clearCookie(OAUTH_COOKIE, oauthCookie);
  const fail = (reason) => res.redirect(`${env.WEB_URL}/login?error=${reason}`);
  if (!google.enabled || !pending || !req.query.code || req.query.state !== pending.state)
    return fail('google');
  try {
    const profile = await google.profileFromCode(req.query.code, pending.nonce);
    const user = await authService.loginWithGoogle(profile);
    setAuthCookies(res, await issueTokens(user, requestContext(req), { persistent: pending.remember }));
    res.redirect(`${env.WEB_URL}${pending.next}`);
  } catch (err) {
    if (err.code === 'ACCOUNT_INACTIVE') return fail('inactive');
    logger.warn({ err: err.message }, 'Google sign-in failed');
    fail('google');
  }
}

// ----- Signed-in devices -------------------------------------------------------

const currentFamily = async (req) => req.sessionFamily ?? (await familyOf(readRefreshToken(req)));

export async function sessions(req, res) {
  const current = await currentFamily(req);
  res.json({ items: await listSessions(req.user._id, current) });
}

export async function revokeSessionById(req, res) {
  if (!(await revokeFamily(req.user._id, req.params.id))) throw notFound('Session');
  if (req.params.id === (await currentFamily(req))) clearAuthCookies(res);
  res.json({ ok: true });
}

export async function logoutEverywhere(req, res) {
  await revokeAllSessions(req.user._id);
  clearAuthCookies(res);
  res.json({ ok: true });
}

export async function verify(req, res) {
  await signIn(req, res, await authService.verify(req.body));
}

export async function resendOtp(req, res) {
  const { devOtp } = await authService.resendOtp(req.body);
  res.json({ ok: true, ...(devOtp ? { devOtp } : {}) });
}

export async function forgotPassword(req, res) {
  const { devOtp } = await authService.forgotPassword(req.body);
  res.json({ ok: true, ...(devOtp ? { devOtp } : {}) });
}

export async function resetPassword(req, res) {
  const user = await authService.resetPassword(req.body);
  if (!user) return res.json({ ok: true });
  const tokens = await issueTokens(user, requestContext(req));
  setAuthCookies(res, tokens);
  res.json({ ok: true, user: toUserDTO(user), ...tokens });
}

export async function refresh(req, res) {
  try {
    const { user, tokens } = await authService.refresh(readRefreshToken(req), requestContext(req));
    setAuthCookies(res, tokens);
    res.json({ user: toUserDTO(user), ...tokens });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
}

export async function logout(req, res) {
  await authService.logout(readRefreshToken(req));
  clearAuthCookies(res);
  res.json({ ok: true });
}

export function me(req, res) {
  res.json({ user: toUserDTO(req.user) });
}
