import { can, isStaff } from '@ghotok/shared';
import { User } from '../models/index.js';
import { verifyAccessToken } from '../services/token.service.js';
import { ApiError, forbidden, unauthorized } from '../utils/api-error.js';
import { readAccessToken } from '../utils/auth-cookies.js';

/**
 * Loads `req.user` when a valid access token is present. It never rejects a
 * request itself; an expired token is remembered so `requireAuth` can answer
 * TOKEN_EXPIRED (the clients then call /api/auth/refresh and retry).
 */
export async function loadUser(req, _res, next) {
  const token = readAccessToken(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = (await User.findById(payload.sub)) ?? undefined;
    // The session family ("this device"); the refresh cookie itself only reaches /api/auth.
    req.sessionFamily = payload.sid;
  } catch (err) {
    req.authError = err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
  }
  next();
}

/** Requires an active, signed-in account. */
export function requireAuth(req, _res, next) {
  if (!req.user) {
    if (req.authError === 'TOKEN_EXPIRED')
      return next(new ApiError(401, 'TOKEN_EXPIRED', 'Your session has expired.'));
    return next(unauthorized());
  }
  if (req.user.status !== 'active') {
    return next(
      new ApiError(403, 'ACCOUNT_INACTIVE', `Your account is ${req.user.status}. Please contact support.`),
    );
  }
  next();
}

/** Requires a verified email or phone number. Staff accounts are always allowed. */
export function requireVerified(req, _res, next) {
  const verified = req.user?.emailVerified || req.user?.phoneVerified;
  if (!verified && !isStaff(req.user?.role)) {
    return next(new ApiError(403, 'NOT_VERIFIED', 'Please verify your email or phone number first.'));
  }
  next();
}

/** Requires a signed-in user whose role has `permission` (see shared/src/permissions.js). */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (!can(req.user.role, permission)) return next(forbidden());
    next();
  };
}
