import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';
import { pinoHttp } from 'pino-http';
import { getAuth } from './config/auth.js';
import { env, isTest } from './config/env.js';
import { logger } from './config/logger.js';
import { loadUser } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import { apiLimiter, originCheck, sanitizeBody } from './middlewares/security.js';
import gatewayRoutes from './routes/gateway.routes.js';
import api from './routes/index.js';

/**
 * Builds the Express application (without listening), so tests can use it directly.
 *
 * Request pipeline: security headers → CORS → logging → Better Auth (/api/auth) →
 * JSON body → body sanitising → origin check → rate limit → load user → routes → errors.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Better Auth reads the raw request itself, so it is mounted before the JSON parser.
  // It is created on first use, after the database connection is open.
  app.all('/api/auth/*splat', originCheck, apiLimiter, (req, res) => toNodeHandler(getAuth())(req, res));
  // Payment gateways post form data from their own domain (see gateway.routes.js).
  app.use('/api/gateway', apiLimiter, gatewayRoutes);

  app.use(cookieParser());
  app.use(express.json({ limit: '200kb' }));
  app.use(sanitizeBody);
  app.use('/api', originCheck, apiLimiter, loadUser, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
