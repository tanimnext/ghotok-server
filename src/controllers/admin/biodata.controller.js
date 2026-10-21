import * as review from '../../services/biodata-review.service.js';
import { requestContext as ctx } from '../../utils/request.js';

export async function list(req, res) {
  res.json(await review.listBiodatas(req.query, req.query));
}

export async function get(req, res) {
  res.json(await review.getBiodataForReview(req.params.id));
}

export async function approve(req, res) {
  res.json({ biodata: await review.approveBiodata(req.params.id, ctx(req)) });
}

export async function reject(req, res) {
  res.json({ biodata: await review.rejectBiodata(req.params.id, req.body, ctx(req)) });
}

export async function suspendEdit(req, res) {
  res.json({ biodata: await review.setEditSuspension(req.params.id, req.body, ctx(req)) });
}

export async function editSection(req, res) {
  res.json(await review.editSection(req.params.id, req.params.section, req.body.data, ctx(req)));
}

export async function block(req, res) {
  res.json({ biodata: await review.setBlocked(req.params.id, req.body, ctx(req)) });
}

export async function softDelete(req, res) {
  res.json({ biodata: await review.softDelete(req.params.id, req.body.reason, ctx(req)) });
}

export async function restore(req, res) {
  res.json({ biodata: await review.restoreBiodata(req.params.id, req.body?.note, ctx(req)) });
}

export async function nidDocuments(req, res) {
  res.json(await review.nidDocuments(req.params.id, ctx(req)));
}

export async function verifyNid(req, res) {
  res.json({ biodata: await review.decideNid(req.params.id, 'verified', req.body?.note, ctx(req)) });
}

export async function rejectNid(req, res) {
  res.json({ biodata: await review.decideNid(req.params.id, 'rejected', req.body?.note, ctx(req)) });
}

export async function restoreRequests(req, res) {
  res.json(await review.listRestoreRequests(req.query, req.query));
}

export async function approveRestoreRequest(req, res) {
  await review.approveRestoreRequest(req.params.id, req.body?.note, ctx(req));
  res.json({ ok: true });
}

export async function declineRestoreRequest(req, res) {
  await review.declineRestoreRequest(req.params.id, req.body ?? {}, ctx(req));
  res.json({ ok: true });
}
