import { Router } from 'express';
import * as biodata from '../../controllers/admin/biodata.controller.js';
import * as billing from '../../controllers/admin/billing.controller.js';
import * as content from '../../controllers/admin/content.controller.js';
import * as insights from '../../controllers/admin/insights.controller.js';
import * as moderation from '../../controllers/admin/moderation.controller.js';
import * as users from '../../controllers/admin/user.controller.js';
import { requireAuth, requirePermission as can } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import * as admin from '../../validations/admin.validation.js';
import { idParams } from '../../validations/common.validation.js';
import { sectionParams, saveSection } from '../../validations/biodata.validation.js';
import * as pay from '../../validations/payment.validation.js';
import * as support from '../../validations/support.validation.js';

// The admin panel API: /api/admin. Every route needs a staff account, and each one
// names the permission it requires (see shared/src/permissions.js).
const router = Router();
router.use(requireAuth, can('admin.access'));

const id = validate({ params: idParams });

// Overview, analytics, audit log
router.get('/overview', can('overview.view'), insights.overview);
router.get(
  '/analytics',
  can('analytics.view'),
  validate({ query: admin.analyticsQuery }),
  insights.analytics,
);
router.get('/audit-logs', can('audit.view'), validate({ query: admin.auditQuery }), insights.auditLogs);

// Biodatas: review queue, edits, visibility, NID, recovery queue
router.get('/biodatas', can('biodata.review'), validate({ query: admin.biodatasQuery }), biodata.list);
router.get('/biodatas/:id', can('biodata.review'), id, biodata.get);
router.post('/biodatas/:id/approve', can('biodata.review'), id, biodata.approve);
router.post(
  '/biodatas/:id/reject',
  can('biodata.review'),
  id,
  validate({ body: admin.rejectBiodata }),
  biodata.reject,
);
router.put(
  '/biodatas/:id/sections/:section',
  can('biodata.edit'),
  validate({ params: idParams.extend(sectionParams.shape), body: saveSection }),
  biodata.editSection,
);
router.post(
  '/biodatas/:id/suspend-edit',
  can('biodata.review'),
  id,
  validate({ body: admin.suspendEdit }),
  biodata.suspendEdit,
);
router.post(
  '/biodatas/:id/block',
  can('biodata.review'),
  id,
  validate({ body: admin.blockBiodata }),
  biodata.block,
);
router.post(
  '/biodatas/:id/delete',
  can('biodata.review'),
  id,
  validate({ body: admin.deleteBiodata }),
  biodata.softDelete,
);
router.post(
  '/biodatas/:id/restore',
  can('recovery.manage'),
  id,
  validate({ body: admin.note }),
  biodata.restore,
);
router.get('/biodatas/:id/nid', can('nid.verify'), id, biodata.nidDocuments);
router.post(
  '/biodatas/:id/nid/verify',
  can('nid.verify'),
  id,
  validate({ body: admin.note }),
  biodata.verifyNid,
);
router.post(
  '/biodatas/:id/nid/reject',
  can('nid.verify'),
  id,
  validate({ body: admin.note }),
  biodata.rejectNid,
);
router.get(
  '/restore-requests',
  can('recovery.manage'),
  validate({ query: admin.restoreRequestsQuery }),
  biodata.restoreRequests,
);
router.post(
  '/restore-requests/:id/approve',
  can('recovery.manage'),
  id,
  validate({ body: admin.note }),
  biodata.approveRestoreRequest,
);
router.post(
  '/restore-requests/:id/decline',
  can('recovery.manage'),
  id,
  validate({ body: admin.declineRestore }),
  biodata.declineRestoreRequest,
);

// Users and roles
router.get('/users', can('users.view'), validate({ query: admin.usersQuery }), users.list);
router.get('/users/:id', can('users.view'), id, users.get);
router.patch('/users/:id', can('users.manage'), id, validate({ body: admin.updateUser }), users.update);
router.post('/users', can('users.manage'), validate({ body: admin.createUser }), users.create);
router.post(
  '/users/:id/reset-password',
  can('users.manage'),
  id,
  validate({ body: admin.resetUserPassword }),
  users.resetPassword,
);

// Payments, refunds, connection adjustments, packages
router.get('/payments', can('payments.manage'), validate({ query: pay.paymentsQuery }), billing.payments);
router.post('/payments/:id/verify', can('payments.manage'), id, billing.verifyPayment);
router.post(
  '/payments/:id/reject',
  can('payments.manage'),
  id,
  validate({ body: pay.rejectPayment }),
  billing.rejectPayment,
);
router.get('/refunds', can('refunds.manage'), validate({ query: pay.refundsQuery }), billing.refunds);
router.post(
  '/refunds/:id/approve',
  can('refunds.manage'),
  id,
  validate({ body: pay.approveRefund }),
  billing.approveRefund,
);
router.post(
  '/refunds/:id/reject',
  can('refunds.manage'),
  id,
  validate({ body: pay.rejectRefund }),
  billing.rejectRefund,
);
router.post(
  '/connections/adjust',
  can('connections.adjust'),
  validate({ body: pay.adjustConnections }),
  billing.adjustConnections,
);
router.get(
  '/connections/ledger',
  can('connections.adjust'),
  validate({ query: pay.ledgerQuery }),
  billing.ledger,
);
router.get('/packages', can('packages.manage'), billing.packages);
router.post(
  '/packages',
  can('packages.manage'),
  validate({ body: pay.createPackage }),
  billing.createPackage,
);
router.patch(
  '/packages/:id',
  can('packages.manage'),
  id,
  validate({ body: pay.updatePackage }),
  billing.updatePackage,
);
router.delete('/packages/:id', can('packages.manage'), id, billing.removePackage);

// Reports, support tickets, contact form messages
router.get('/reports', can('reports.manage'), validate({ query: support.reportsQuery }), moderation.reports);
router.patch(
  '/reports/:id',
  can('reports.manage'),
  id,
  validate({ body: support.updateReport }),
  moderation.updateReport,
);
router.get('/tickets', can('tickets.manage'), validate({ query: support.ticketsQuery }), moderation.tickets);
router.get('/tickets/:id', can('tickets.manage'), id, moderation.ticket);
router.post(
  '/tickets/:id/messages',
  can('tickets.manage'),
  id,
  validate({ body: support.staffReply }),
  moderation.replyToTicket,
);
router.patch(
  '/tickets/:id',
  can('tickets.manage'),
  id,
  validate({ body: support.updateTicket }),
  moderation.updateTicket,
);
router.get(
  '/contact-messages',
  can('tickets.manage'),
  validate({ query: support.contactMessagesQuery }),
  moderation.contactMessages,
);
router.patch(
  '/contact-messages/:id',
  can('tickets.manage'),
  id,
  validate({ body: support.updateContactMessage }),
  moderation.updateContactMessage,
);

// Site settings, content pages, FAQs
router.get('/settings', can('settings.manage'), content.settings);
router.put(
  '/settings/:key',
  can('settings.manage'),
  validate({ params: admin.settingsParams, body: admin.updateSettings }),
  content.updateSettings,
);
router.get(
  '/marriage-reports',
  can('content.manage'),
  validate({ query: admin.storiesQuery }),
  content.marriageReports,
);
router.patch(
  '/marriage-reports/:id',
  can('content.manage'),
  id,
  validate({ body: admin.updateStory }),
  content.updateStory,
);
router.get('/banners', can('content.manage'), content.banners);
router.post(
  '/banners/upload-url',
  can('content.manage'),
  validate({ body: admin.bannerUpload }),
  content.bannerUploadUrl,
);
router.post('/banners', can('content.manage'), validate({ body: admin.createBanner }), content.createBanner);
router.patch(
  '/banners/:id',
  can('content.manage'),
  id,
  validate({ body: admin.updateBanner }),
  content.updateBanner,
);
router.delete('/banners/:id', can('content.manage'), id, content.deleteBanner);
router.get('/pages', can('content.manage'), content.pages);
router.get('/pages/:slug', can('content.manage'), validate({ params: admin.pageParams }), content.page);
router.put(
  '/pages/:slug',
  can('content.manage'),
  validate({ params: admin.pageParams, body: admin.upsertPage }),
  content.upsertPage,
);
router.delete(
  '/pages/:slug',
  can('content.manage'),
  validate({ params: admin.pageParams }),
  content.deletePage,
);
router.get('/faqs', can('content.manage'), content.faqs);
router.post('/faqs', can('content.manage'), validate({ body: admin.createFaq }), content.createFaq);
router.patch('/faqs/:id', can('content.manage'), id, validate({ body: admin.updateFaq }), content.updateFaq);
router.delete('/faqs/:id', can('content.manage'), id, content.deleteFaq);

export default router;
