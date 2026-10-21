import { ContactMessage, SupportTicket, User, nextSequence } from '../models/index.js';
import { toStaffTicketDTO, toTicketDTO } from '../serializers/ticket.serializer.js';
import { conflict, notFound } from '../utils/api-error.js';
import { pageParams, paginate } from '../utils/pagination.js';
import { escapeRegex } from '../utils/strings.js';
import { resolveAttachments, withAttachmentUrls } from './attachment.service.js';
import { notify } from './notification.service.js';

const MAX_OPEN_TICKETS = 5;

export { createAttachmentUpload } from './attachment.service.js';

// ----- Members -----------------------------------------------------------------

export function listMyTickets(user, query) {
  const filter = { user: user._id };
  return paginate(
    SupportTicket.find(filter).sort({ lastMessageAt: -1 }).populate('biodata', 'biodataNo'),
    SupportTicket.countDocuments(filter),
    pageParams(query, { defaultLimit: 20 }),
    (t) => toTicketDTO(t),
  );
}

/**
 * Opens a ticket. Reports about a biodata open one too (see report.service.js),
 * passing `extra` ({ report, biodata }) and skipping the open-ticket limit.
 */
export async function openTicket(user, { subject, category, message, attachments }, extra) {
  const open = extra ? 0 : await SupportTicket.countDocuments({ user: user._id, status: { $ne: 'closed' } });
  if (open >= MAX_OPEN_TICKETS) {
    throw conflict(
      'TOO_MANY_OPEN',
      `You have ${MAX_OPEN_TICKETS} open tickets. Please wait for a reply or close one first.`,
    );
  }
  const ticket = await SupportTicket.create({
    ticketNo: `T-${await nextSequence('ticket', 1000)}`,
    user: user._id,
    subject,
    category,
    messages: [
      {
        author: user._id,
        staff: false,
        body: message,
        attachments: await resolveAttachments(user._id, attachments),
      },
    ],
    ...extra,
  });
  return toTicketDTO(ticket);
}

async function findMyTicket(user, id) {
  const t = await SupportTicket.findOne({ _id: id, user: user._id })
    .populate('messages.author', 'name')
    .populate('biodata', 'biodataNo');
  if (!t) throw notFound('Ticket');
  return t;
}

/** The member's ticket with its messages; opening it marks staff replies as read. */
export async function getMyTicket(user, id) {
  const t = await findMyTicket(user, id);
  t.userReadAt = new Date();
  await t.save();
  return withAttachmentUrls(toTicketDTO(t, { withMessages: true }));
}

/** The member replies. Replying to a closed ticket reopens it and sends it back to support. */
export async function replyToMyTicket(user, id, { message = '', attachments }) {
  const t = await findMyTicket(user, id);
  t.messages.push({
    author: user._id,
    staff: false,
    body: message,
    attachments: await resolveAttachments(user._id, attachments),
  });
  t.status = 'waiting';
  t.closedAt = undefined;
  t.lastMessageAt = new Date();
  t.userReadAt = t.lastMessageAt;
  await t.save();
  await t.populate('messages.author', 'name');
  return withAttachmentUrls(toTicketDTO(t, { withMessages: true }));
}

export async function closeMyTicket(user, id) {
  const t = await SupportTicket.findOneAndUpdate(
    { _id: id, user: user._id },
    { status: 'closed', closedAt: new Date() },
    { new: true },
  );
  if (!t) throw notFound('Ticket');
  return toTicketDTO(t);
}

export async function submitContactMessage(data, { user, ip }) {
  await ContactMessage.create({ ...data, user: user?._id, ip });
}

// ----- Staff -------------------------------------------------------------------

export async function listTickets({ status, category, q }, query) {
  const filter = {};
  if (status === 'active') filter.status = { $ne: 'closed' };
  else if (status) filter.status = status;
  if (category) filter.category = category;
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    const users = await User.find({ $or: [{ name: re }, { email: re }, { phone: re }] })
      .select('_id')
      .limit(50);
    filter.$or = [{ ticketNo: re }, { subject: re }, { user: { $in: users.map((u) => u._id) } }];
  }
  return paginate(
    SupportTicket.find(filter)
      .sort({ lastMessageAt: -1 })
      .populate('user', 'name email phone role status')
      .populate('assignedTo', 'name'),
    SupportTicket.countDocuments(filter),
    pageParams(query, { defaultLimit: 20 }),
    (t) => toStaffTicketDTO(t),
  );
}

async function findTicket(id) {
  const t = await SupportTicket.findById(id)
    .populate('biodata', 'biodataNo')
    .populate('user', 'name email phone role status')
    .populate('messages.author', 'name')
    .populate('assignedTo', 'name');
  if (!t) throw notFound('Ticket');
  return t;
}

export async function getTicket(id) {
  return withAttachmentUrls(toStaffTicketDTO(await findTicket(id), { withMessages: true }));
}

/** Staff reply; optionally closes the ticket. The member is notified. */
export async function staffReply(id, { message = '', close, attachments }, ctx) {
  const t = await findTicket(id);
  if (t.status === 'closed') throw conflict('TICKET_CLOSED', 'This ticket is closed.');
  t.messages.push({
    author: ctx.actor._id,
    staff: true,
    body: message,
    attachments: await resolveAttachments(ctx.actor._id, attachments),
  });
  t.status = close ? 'closed' : 'answered';
  if (close) t.closedAt = new Date();
  t.lastMessageAt = new Date();
  t.lastStaffMessageAt = t.lastMessageAt;
  t.assignedTo ??= ctx.actor._id;
  await t.save();
  await t.populate([
    { path: 'messages.author', select: 'name' },
    { path: 'assignedTo', select: 'name' },
  ]);
  await notify(t.user._id, 'ticket_replied', { ticketNo: t.ticketNo }, `/dashboard/support/${t._id}`);
  return withAttachmentUrls(toStaffTicketDTO(t, { withMessages: true }));
}

export async function updateTicket(id, { status, priority, assignToMe }, ctx) {
  const t = await findTicket(id);
  if (status) {
    t.status = status;
    t.closedAt = status === 'closed' ? new Date() : undefined;
  }
  if (priority) t.priority = priority;
  if (assignToMe) t.assignedTo = ctx.actor._id;
  await t.save();
  await t.populate('assignedTo', 'name');
  return withAttachmentUrls(toStaffTicketDTO(t, { withMessages: true }));
}

export function listContactMessages({ status }, query) {
  const filter = status ? { status } : {};
  return paginate(
    ContactMessage.find(filter).sort({ createdAt: -1 }).lean(),
    ContactMessage.countDocuments(filter),
    pageParams(query, { defaultLimit: 20 }),
    // The sender's IP address is kept for abuse handling but not shown in the panel.
    ({ ip: _ip, ...m }) => ({ ...m, id: m._id }),
  );
}

export async function setContactMessageStatus(id, status) {
  const m = await ContactMessage.findByIdAndUpdate(id, { status }, { new: true });
  if (!m) throw notFound('Message');
}
