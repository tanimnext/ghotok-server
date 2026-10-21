import { env } from '../config/env.js';

// Browsers receive the tokens as httpOnly cookies (never readable by JavaScript).
// API clients without cookies (e.g. a future mobile app) use the tokens from the
// JSON response with an `Authorization: Bearer` header instead.

export const ACCESS_COOKIE = 'gh_at';
export const REFRESH_COOKIE = 'gh_rt';
// Not a secret: a readable flag that tells the front-ends a session exists, so
// anonymous visitors never make a pointless /auth/me request.
export const SESSION_HINT_COOKIE = 'gh_session';
const REFRESH_PATH = '/api/auth';

function baseOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

/** Sets the auth cookies. Without `persistent` ("Remember me" off) they end with the browser session. */
export function setAuthCookies(res, { accessToken, refreshToken, persistent = true }) {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseOptions(),
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL_MIN * 60e3,
  });
  if (refreshToken) {
    const lifetime = persistent ? { maxAge: env.REFRESH_TOKEN_TTL_DAYS * 864e5 } : {};
    res.cookie(REFRESH_COOKIE, refreshToken, { ...baseOptions(), path: REFRESH_PATH, ...lifetime });
    res.cookie(SESSION_HINT_COOKIE, '1', { ...baseOptions(), httpOnly: false, path: '/', ...lifetime });
  }
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions(), path: REFRESH_PATH });
  res.clearCookie(SESSION_HINT_COOKIE, { ...baseOptions(), httpOnly: false, path: '/' });
}

/** The access token from the Authorization header or the cookie. */
export function readAccessToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[ACCESS_COOKIE];
}

/** The refresh token from the cookie or, for API clients, the JSON body. */
export function readRefreshToken(req) {
  return req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
}
