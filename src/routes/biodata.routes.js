import { Router } from 'express';
import * as biodata from '../controllers/biodata.controller.js';
import { requireAuth, requireVerified } from '../middlewares/auth.js';
import { writeLimiter } from '../middlewares/security.js';
import { validate } from '../middlewares/validate.js';
import * as schema from '../validations/biodata.validation.js';

const router = Router();
const member = [requireAuth, requireVerified];
const byNumber = validate({ params: schema.biodataNoParams });

// ----- The member's own biodata (registered before /:no so "me" is never read as a number) -----
router.get('/me', requireAuth, biodata.getOwn);
router.post('/me', ...member, validate({ body: schema.createBiodata }), biodata.createOwn);
router.put(
  '/me/sections/:section',
  ...member,
  writeLimiter,
  validate({ params: schema.sectionParams, body: schema.saveSection }),
  biodata.saveSection,
);
router.post('/me/submit', ...member, biodata.submit);
router.patch('/me/visibility', requireAuth, validate({ body: schema.visibility }), biodata.setVisibility);
router.delete('/me', requireAuth, validate({ body: schema.deleteBiodata }), biodata.softDelete);
router.post('/me/restore', requireAuth, biodata.restoreOwn);
router.get('/me/restore-request', requireAuth, biodata.getRestoreRequest);
router.get('/partner-lookup', requireAuth, validate({ query: schema.partnerLookup }), biodata.lookupPartner);
router.post(
  '/me/restore-request',
  requireAuth,
  validate({ body: schema.restoreRequest }),
  biodata.requestRestore,
);
router.get('/me/stats', requireAuth, biodata.stats);
router.post('/me/photo/upload-url', ...member, writeLimiter, biodata.photoUploadUrl);
router.post('/me/photo', ...member, validate({ body: schema.attachPhoto }), biodata.attachPhoto);
router.patch(
  '/me/photo',
  requireAuth,
  validate({ body: schema.photoVisibility }),
  biodata.setPhotoVisibility,
);
router.delete('/me/photo', requireAuth, biodata.removePhoto);
router.post(
  '/me/nid/upload-url',
  ...member,
  writeLimiter,
  validate({ body: schema.nidUploadUrl }),
  biodata.nidUploadUrl,
);
router.post('/me/nid', ...member, validate({ body: schema.submitNid }), biodata.submitNid);

// ----- Public -----
router.get('/', validate({ query: schema.searchQuery }), biodata.search);
router.get('/featured', validate({ query: schema.featuredQuery }), biodata.featured);
router.get('/location-counts', validate({ query: schema.searchQuery }), biodata.locationCounts);
router.get('/:no', byNumber, biodata.getPublic);
router.post('/:no/visit', byNumber, biodata.visit);

// ----- A member acting on someone else's biodata -----
router.get('/:no/viewer', requireAuth, byNumber, biodata.viewerState);
router.post('/:no/unlock', ...member, writeLimiter, byNumber, biodata.unlock);
router.post('/:no/favorite', requireAuth, writeLimiter, byNumber, biodata.addFavorite);
router.delete('/:no/favorite', requireAuth, byNumber, biodata.removeFavorite);
router.post('/:no/dislike', requireAuth, writeLimiter, byNumber, biodata.addDislike);
router.delete('/:no/dislike', requireAuth, byNumber, biodata.removeDislike);
router.post(
  '/:no/proposals',
  ...member,
  writeLimiter,
  byNumber,
  validate({ body: schema.proposal }),
  biodata.propose,
);
router.post(
  '/:no/report',
  requireAuth,
  writeLimiter,
  byNumber,
  validate({ body: schema.report }),
  biodata.report,
);

export default router;
