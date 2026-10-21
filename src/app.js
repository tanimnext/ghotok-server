import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './config/logger.js';
import { loadUser } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import { apiLimiter, originCheck, sanitizeBody } from './middlewares/security.js';
import gatewayRoutes from './routes/gateway.routes.js';
import api from './routes/index.js';
import uploadRoutes from './routes/upload.routes.js';

/**
 * Builds the Express application (without listening), so tests can use it directly.
 *
 * Request pipeline: security headers → CORS → logging → cookies → JSON body →
 * body sanitising → origin check → rate limit → load user → routes → errors.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // Uploads take raw bodies, so they are mounted before the JSON parser.
  app.use('/api/uploads', uploadRoutes);
  // Payment gateways post form data from their own domain (see gateway.routes.js).
  app.use('/api/gateway', apiLimiter, gatewayRoutes);

  app.use(express.json({ limit: '200kb' }));
  app.use(sanitizeBody);
  app.use('/api', originCheck, apiLimiter, loadUser, api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
