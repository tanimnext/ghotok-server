import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { Session } from '../models/index.js';
import { randomToken, sha256 } from '../utils/crypto.js';

// Authentication uses two tokens:
// - a short-lived JWT access token (stateless, checked on every request), and
// - an opaque refresh token stored hashed in `sessions`. Refresh tokens rotate on
//   every use; presenting an already-rotated token revokes its whole family,
//   which signs out a thief who copied an old token.

const ISSUER = 'ghotok';

/** `sid` is the session family, so requests can tell which signed-in device they come from. */
export function signAccessToken(user, family) {
  return jwt.sign({ sub: user._id.toString(), role: user.role, sid: family }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m`,
    issuer: ISSUER,
  });
}

/** @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError} */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER });
}

/**
 * Creates a refresh-token session and returns the raw token (only its hash is stored).
 * @param {import('mongoose').Types.ObjectId} userId
 * @param {{ userAgent?: string, ip?: string }} client
 */
export async function createSession(userId, client = {}, family = crypto.randomUUID(), persistent = true) {
  const token = randomToken();
  // A browser-session login ("Remember me" off) also expires on the server after a day.
  const days = persistent ? env.REFRESH_TOKEN_TTL_DAYS : 1;
  await Session.create({
    user: userId,
    tokenHash: sha256(token),
    family,
    persistent,
    expiresAt: new Date(Date.now() + days * 864e5),
    userAgent: client.userAgent,
    ip: client.ip,
  });
  return token;
}

/**
 * Exchanges a refresh token for a new one.
 * @returns {Promise<{ userId: import('mongoose').Types.ObjectId, token: string } | null>}
 */
export async function rotateSession(rawToken, client = {}) {
  if (!rawToken) return null;
  const session = await Session.findOne({ tokenHash: sha256(rawToken) });
  if (!session) return null;
  if (session.revokedAt || session.replacedAt) {
    await Session.updateMany({ family: session.family, revokedAt: null }, { revokedAt: new Date() });
    return null;
  }
  if (session.expiresAt < new Date()) return null;
  // Claim the session atomically so two parallel refreshes cannot both succeed.
  const claimed = await Session.findOneAndUpdate(
    { _id: session._id, replacedAt: null, revokedAt: null },
    { replacedAt: new Date() },
  );
  if (!claimed) return null;
  const token = await createSession(session.user, client, session.family, session.persistent !== false);
  return {
    userId: session.user,
    token,
    family: session.family,
    persistent: session.persistent !== false,
  };
}

export async function revokeSession(rawToken) {
  if (!rawToken) return;
  await Session.updateOne({ tokenHash: sha256(rawToken) }, { revokedAt: new Date() });
}

/** Signs a user out of every device. */
export async function revokeAllSessions(userId) {
  await Session.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
}

/** Issues a new access token and session for a user. */
export async function issueTokens(user, client, { persistent = true } = {}) {
  const family = crypto.randomUUID();
  return {
    accessToken: signAccessToken(user, family),
    refreshToken: await createSession(user._id, client, family, persistent),
    expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60,
    persistent,
  };
}

/** The session family a refresh token belongs to (identifies "this device"). */
export async function familyOf(rawToken) {
  if (!rawToken) return null;
  return (
    (
      await Session.findOne({ tokenHash: sha256(rawToken) })
        .select('family')
        .lean()
    )?.family ?? null
  );
}

/**
 * The devices signed in to an account: the newest live session of each family.
 * @returns {Promise<Array<{ id: string, userAgent?: string, ip?: string, lastActiveAt: Date, current: boolean }>>}
 */
export async function listSessions(userId, currentFamily) {
  const live = await Session.find({
    user: userId,
    revokedAt: null,
    replacedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();
  return live.map((s) => ({
    id: s.family,
    userAgent: s.userAgent ?? null,
    ip: s.ip ?? null,
    lastActiveAt: s.createdAt,
    current: s.family === currentFamily,
  }));
}

/** Signs one device out (all sessions of the family). */
export async function revokeFamily(userId, family) {
  const { modifiedCount } = await Session.updateMany(
    { user: userId, family, revokedAt: null },
    { revokedAt: new Date() },
  );
  return modifiedCount > 0;
}

/**
 * Signs a user out of every device except the one using `keepFamily`.
 * @returns {Promise<number>} how many other devices were signed out
 */
export async function revokeOtherSessions(userId, keepFamily) {
  const others = await Session.distinct('family', {
    user: userId,
    revokedAt: null,
    replacedAt: null,
    expiresAt: { $gt: new Date() },
    family: { $ne: keepFamily },
  });
  await Session.updateMany(
    { user: userId, revokedAt: null, family: { $ne: keepFamily } },
    { revokedAt: new Date() },
  );
  return others.length;
}
