import * as ticketService from '../services/ticket.service.js';

export async function list(req, res) {
  res.json(await ticketService.listMyTickets(req.user, req.query));
}

export async function create(req, res) {
  res.status(201).json({ ticket: await ticketService.openTicket(req.user, req.body) });
}

export async function get(req, res) {
  res.json({ ticket: await ticketService.getMyTicket(req.user, req.params.id) });
}

export async function reply(req, res) {
  res.json({ ticket: await ticketService.replyToMyTicket(req.user, req.params.id, req.body) });
}

export async function attachmentUploadUrl(req, res) {
  res.json(await ticketService.createAttachmentUpload(req.user._id, req.body));
}

export async function close(req, res) {
  res.json({ ticket: await ticketService.closeMyTicket(req.user, req.params.id) });
}

export async function contact(req, res) {
  await ticketService.submitContactMessage(req.body, { user: req.user, ip: req.ip });
  res.status(201).json({ ok: true });
}
