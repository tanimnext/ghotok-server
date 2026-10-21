import * as reportService from '../../services/report.service.js';
import * as ticketService from '../../services/ticket.service.js';
import { requestContext as ctx } from '../../utils/request.js';

export async function reports(req, res) {
  res.json(await reportService.listReports(req.query, req.query));
}

export async function updateReport(req, res) {
  await reportService.updateReport(req.params.id, req.body, ctx(req));
  res.json({ ok: true });
}

export async function tickets(req, res) {
  res.json(await ticketService.listTickets(req.query, req.query));
}

export async function ticket(req, res) {
  res.json({ ticket: await ticketService.getTicket(req.params.id) });
}

export async function replyToTicket(req, res) {
  res.json({ ticket: await ticketService.staffReply(req.params.id, req.body, ctx(req)) });
}

export async function updateTicket(req, res) {
  res.json({ ticket: await ticketService.updateTicket(req.params.id, req.body, ctx(req)) });
}

export async function contactMessages(req, res) {
  res.json(await ticketService.listContactMessages(req.query, req.query));
}

export async function updateContactMessage(req, res) {
  await ticketService.setContactMessageStatus(req.params.id, req.body.status);
  res.json({ ok: true });
}
