import { toUserSummary } from './user.serializer.js';

const SUPPORT_NAME = 'Ghotok support';

/** A ticket as its owner sees it. Staff names are hidden behind "Ghotok support". */
export function toTicketDTO(t, { withMessages = false } = {}) {
  return {
    id: t._id.toString(),
    ticketNo: t.ticketNo,
    subject: t.subject,
    category: t.category,
    status: t.status,
    priority: t.priority,
    createdAt: t.createdAt,
    lastMessageAt: t.lastMessageAt,
    closedAt: t.closedAt ?? null,
    messageCount: t.messages?.length ?? 0,
    // A staff reply the member has not opened yet.
    hasNewReply: !!t.lastStaffMessageAt && (!t.userReadAt || t.lastStaffMessageAt > t.userReadAt),
    biodataNo: t.biodata?.biodataNo ?? null,
    reportId: t.report?._id?.toString() ?? t.report?.toString() ?? null,
    ...(withMessages
      ? {
          messages: (t.messages ?? []).map((m) => ({
            id: m._id.toString(),
            staff: m.staff,
            author: { name: m.staff ? SUPPORT_NAME : (m.author?.name ?? '') },
            body: m.body,
            attachments: m.attachments ?? [],
            createdAt: m.createdAt,
          })),
        }
      : {}),
  };
}

/** A ticket as staff see it, including which team member replied. */
export function toStaffTicketDTO(t, { withMessages = false } = {}) {
  const dto = toTicketDTO(t, { withMessages });
  if (withMessages) {
    dto.messages = t.messages.map((m) => ({
      id: m._id.toString(),
      staff: m.staff,
      author: { name: m.author?.name ?? 'Unknown' },
      body: m.body,
      attachments: m.attachments ?? [],
      createdAt: m.createdAt,
    }));
  }
  return { ...dto, user: toUserSummary(t.user), assignedTo: t.assignedTo?.name ?? null };
}
