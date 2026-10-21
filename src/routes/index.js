import { Router } from 'express';
import accountRoutes from './account.routes.js';
import adminRoutes from './admin/index.js';
import authRoutes from './auth.routes.js';
import biodataRoutes from './biodata.routes.js';
import contentRoutes from './content.routes.js';
import paymentRoutes from './payment.routes.js';
import supportRoutes from './support.routes.js';

/** Every JSON endpoint, mounted under /api by app.js. See docs/API.md for the full reference. */
const api = Router();

api.use('/auth', authRoutes);
api.use('/me', accountRoutes);
api.use('/biodatas', biodataRoutes);
api.use('/public', contentRoutes);
api.use('/admin', adminRoutes);
api.use(paymentRoutes); // /packages, /payments, /refunds
api.use(supportRoutes); // /tickets, /contact

export default api;
