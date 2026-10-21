import { biodataCompletion } from '@ghotok/shared';
import { User } from '../models/index.js';
import * as biodataService from '../services/biodata.service.js';
import { unlockContact } from '../services/connection.service.js';
import * as listService from '../services/list.service.js';
import * as proposalService from '../services/proposal.service.js';
import * as reportService from '../services/report.service.js';
import * as searchService from '../services/search.service.js';
import { isValidVisitorId, newVisitorId, recordVisit } from '../services/visit.service.js';
import { toPublicDetail } from '../serializers/biodata.serializer.js';
import { requestContext } from '../utils/request.js';

const VISITOR_COOKIE = 'gh_vid';
const { ownerView } = biodataService;

// ----- The member's own biodata (/api/biodatas/me) ------------------------------------

export async function getOwn(req, res) {
  const b = await biodataService.findOwn(req.user._id);
  res.json(b ? ownerView(b) : { biodata: null, completion: biodataCompletion({}) });
}

export async function createOwn(req, res) {
  res.status(201).json(ownerView(await biodataService.createOwn(req.user._id)));
}

export async function saveSection(req, res) {
  const { biodata, statusChanged } = await biodataService.saveSection(
    req.user._id,
    req.params.section,
    req.body.data,
  );
  res.json({ ...ownerView(biodata), statusChanged });
}

export async function submit(req, res) {
  res.json(ownerView(await biodataService.submitForReview(req.user._id)));
}

export async function setVisibility(req, res) {
  res.json(ownerView(await biodataService.setHidden(req.user._id, req.body)));
}

export async function softDelete(req, res) {
  res.json(ownerView(await biodataService.softDeleteOwn(req.user._id, req.body, requestContext(req))));
}

export async function getRestoreRequest(req, res) {
  res.json({ request: await biodataService.latestRestoreRequest(req.user._id) });
}

export async function restoreOwn(req, res) {
  res.json(ownerView(await biodataService.restoreOwn(req.user._id)));
}

export async function lookupPartner(req, res) {
  res.json({ partner: await biodataService.lookupPartner(req.query.no, req.user._id) });
}

export async function requestRestore(req, res) {
  res.status(201).json({ request: await biodataService.requestRestore(req.user._id, req.body.reason) });
}

export async function stats(req, res) {
  res.json(await biodataService.ownStats(req.user._id));
}

export async function photoUploadUrl(req, res) {
  res.json(await biodataService.createPhotoUpload(req.user._id));
}

export async function attachPhoto(req, res) {
  res.json(ownerView(await biodataService.attachPhoto(req.user._id, req.body)));
}

export async function setPhotoVisibility(req, res) {
  res.json(ownerView(await biodataService.setPhotoVisibility(req.user._id, req.body.visibility)));
}

export async function removePhoto(req, res) {
  res.json(ownerView(await biodataService.removePhoto(req.user._id)));
}

export async function nidUploadUrl(req, res) {
  res.json(await biodataService.createNidUpload(req.user._id, req.body));
}

export async function submitNid(req, res) {
  res.json(ownerView(await biodataService.submitNid(req.user._id, req.body)));
}

// ----- Public biodatas -----------------------------------------------------------------

/**
 * Who is looking: `u:<userId>` for members, `v:<cookie id>` for anonymous visitors.
 * With `create`, an anonymous visitor without a cookie gets one.
 */
function viewerKeyFor(req, res, { create = false } = {}) {
  if (req.user) return `u:${req.user._id}`;
  let vid = req.cookies?.[VISITOR_COOKIE];
  if (!isValidVisitorId(vid)) {
    if (!create) return null;
    vid = newVisitorId();
    res.cookie(VISITOR_COOKIE, vid, { httpOnly: true, sameSite: 'lax', maxAge: 400 * 864e5, path: '/' });
  }
  return `v:${vid}`;
}

export async function search(req, res) {
  res.json(await searchService.searchBiodatas(req.query, req.user, viewerKeyFor(req, res)));
}

export async function locationCounts(req, res) {
  res.json(await searchService.locationCounts(req.query, req.user));
}

export async function featured(req, res) {
  res.json({ items: await searchService.featuredBiodatas(req.query.limit) });
}

export async function getPublic(req, res) {
  const biodata = await biodataService.findPublic(req.params.no);
  const owner = await User.findById(biodata.user).select('emailVerified phoneVerified').lean();
  res.json({ biodata: toPublicDetail(biodata, owner) });
}

/** Counts a profile view: members by account, anonymous visitors by a long-lived cookie. */
export async function visit(req, res) {
  const b = await biodataService.findPublic(req.params.no);
  if (req.user && b.user.equals(req.user._id)) return res.json({ counted: false });
  res.json({ counted: await recordVisit(b, viewerKeyFor(req, res, { create: true })) });
}

export async function viewerState(req, res) {
  res.json(await biodataService.viewerState(req.user, req.params.no));
}

export async function unlock(req, res) {
  res.json(await unlockContact(req.user, req.params.no));
}

export const addFavorite = listAction('add', 'favorite');
export const removeFavorite = listAction('remove', 'favorite');
export const addDislike = listAction('add', 'dislike');
export const removeDislike = listAction('remove', 'dislike');

function listAction(op, list) {
  return async (req, res) => {
    await (op === 'add' ? listService.addToList : listService.removeFromList)(list, req.user, req.params.no);
    res.json({ ok: true });
  };
}

export async function propose(req, res) {
  res
    .status(201)
    .json({ proposal: await proposalService.sendProposal(req.user, req.params.no, req.body.message) });
}

export async function report(req, res) {
  res.status(201).json({ report: await reportService.reportBiodata(req.user, req.params.no, req.body) });
}
