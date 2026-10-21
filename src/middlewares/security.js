import rateLimit from 'express-rate-limit';
import { env, isTest } from '../config/env.js';
import { forbidden } from '../utils/api-error.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth: state-changing requests that carry an Origin header must
 * come from one of our own front-ends. (Auth cookies are also SameSite=Lax.)
 */
export function originCheck(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const own = new URL(env.API_PUBLIC_URL).origin;
  if (origin === own || env.CORS_ORIGINS.includes(origin)) return next();
  next(forbidden('BAD_ORIGIN', 'Request origin is not allowed.'));
}

/** Strips keys that could be read as MongoDB operators from JSON bodies. */
export function sanitizeBody(req, _res, next) {
  const clean = (v, depth = 0) => {
    if (depth > 12 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (
        k.startsWith('$') ||
        k.includes('.') ||
        k === '__proto__' ||
        k === 'constructor' ||
        k === 'prototype'
      )
        continue;
      out[k] = clean(val, depth + 1);
    }
    return out;
  };
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) req.body = clean(req.body);
  next();
}

const limiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again a little later.' },
    },
  });

export const authLimiter = limiter(15 * 60e3, 30);
export const otpLimiter = limiter(60 * 60e3, 10);
export const writeLimiter = limiter(60e3, 60);
export const apiLimiter = limiter(60e3, 300);
