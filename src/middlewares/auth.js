import { fromNodeHeaders } from 'better-auth/node';
import { getAuth } from '../config/auth.js';
import { env } from '../config/env.js';
import { can, isStaff } from '../shared/index.js';
import { User } from '../models/index.js';
import { ApiError, forbidden, unauthorized } from '../utils/api-error.js';

/**
 * Loads `req.user` (the Mongoose User) and `req.session` (Better Auth's session) when
 * the request carries a valid session cookie. It never rejects a request itself.
 */
export async function loadUser(req, _res, next) {
  try {
    const result = await getAuth().api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (result) {
      req.session = result.session;
      req.user = (await User.findById(result.user.id)) ?? undefined;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires an active, signed-in account. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.status !== 'active') {
    return next(
      new ApiError(403, 'ACCOUNT_INACTIVE', `Your account is ${req.user.status}. Please contact support.`),
    );
  }
  next();
}

/** Requires a verified email or phone number (when REQUIRE_VERIFICATION is on). Admins are always allowed. */
export function requireVerified(req, _res, next) {
  const verified = req.user?.emailVerified || req.user?.phoneNumberVerified;
  if (env.REQUIRE_VERIFICATION && !verified && !isStaff(req.user?.role)) {
    return next(new ApiError(403, 'NOT_VERIFIED', 'Please verify your email or phone number first.'));
  }
  next();
}

/** Requires an admin account. */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!isStaff(req.user.role)) return next(forbidden());
    next();
  });
}

/** Requires a signed-in user whose role has `permission` (see shared/permissions.js). */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (!can(req.user.role, permission)) return next(forbidden());
    next();
  };
}
