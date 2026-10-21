import * as connectionService from '../../services/connection.service.js';
import * as packageService from '../../services/package.service.js';
import * as paymentService from '../../services/payment.service.js';
import * as refundService from '../../services/refund.service.js';
import { requestContext as ctx } from '../../utils/request.js';

export async function payments(req, res) {
  res.json(await paymentService.listPayments(req.query, req.query));
}

export async function verifyPayment(req, res) {
  res.json({ payment: await paymentService.verifyPayment(req.params.id, ctx(req)) });
}

export async function rejectPayment(req, res) {
  res.json({ payment: await paymentService.rejectPayment(req.params.id, req.body.reason, ctx(req)) });
}

export async function refunds(req, res) {
  res.json(await refundService.listRefunds(req.query, req.query));
}

export async function approveRefund(req, res) {
  await refundService.approveRefund(req.params.id, req.body, ctx(req));
  res.json({ ok: true });
}

export async function rejectRefund(req, res) {
  await refundService.rejectRefund(req.params.id, req.body.note, ctx(req));
  res.json({ ok: true });
}

export async function adjustConnections(req, res) {
  res.json(await connectionService.adjustConnections(req.body, ctx(req)));
}

export async function ledger(req, res) {
  res.json(await connectionService.listLedger(req.query, req.query));
}

export async function packages(_req, res) {
  res.json({ items: await packageService.listPackages() });
}

export async function createPackage(req, res) {
  res.status(201).json({ package: await packageService.createPackage(req.body, ctx(req)) });
}

export async function updatePackage(req, res) {
  res.json({ package: await packageService.updatePackage(req.params.id, req.body, ctx(req)) });
}

export async function removePackage(req, res) {
  await packageService.removePackage(req.params.id, ctx(req));
  res.json({ ok: true });
}
