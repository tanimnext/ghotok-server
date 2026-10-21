import { env } from '../config/env.js';
import * as paymentService from '../services/payment.service.js';
import * as refundService from '../services/refund.service.js';
import { requestContext } from '../utils/request.js';

export async function catalogue(req, res) {
  res.json(await paymentService.catalogue(req.user));
}

export async function create(req, res) {
  res.status(201).json(await paymentService.createPayment(req.user, req.body, requestContext(req)));
}

/** Sends the member to their receipt page for the payment (or the connections page without one). */
function redirectToReceipt(res, { status, invoiceNo }) {
  const target = invoiceNo
    ? `/dashboard/payment/${encodeURIComponent(invoiceNo)}?result=${status}`
    : `/dashboard/connections?payment=${status}`;
  res.redirect(303, `${env.WEB_URL}${target}`);
}

/** bKash / Nagad send the customer back here (GET); we finish the payment and redirect. */
export async function gatewayCallback(req, res) {
  redirectToReceipt(res, await paymentService.completeGatewayCheckout(req.params.method, req.query));
}

/** SSLCommerz posts the result from the customer's browser; same handling as above. */
export async function gatewayReturn(req, res) {
  redirectToReceipt(res, await paymentService.completeGatewayCheckout(req.params.method, req.body ?? {}));
}

/** SSLCommerz's server-to-server notification; idempotent with the return above. */
export async function gatewayIpn(req, res) {
  const { status } = await paymentService.completeGatewayCheckout(req.params.method, req.body ?? {});
  res.json({ ok: true, status });
}

export async function status(req, res) {
  res.json({ payment: await paymentService.paymentStatus(req.user, req.params.invoiceNo) });
}

export async function mine(req, res) {
  res.json(await paymentService.myPayments(req.user, req.query));
}

export async function requestRefund(req, res) {
  res.status(201).json({ refund: await refundService.requestRefund(req.user, req.body) });
}

export async function myRefunds(req, res) {
  res.json({ items: await refundService.myRefunds(req.user) });
}
