import { logger } from '../config/logger.js';
import { Notification } from '../models/index.js';
import { paged, pageParams } from '../utils/pagination.js';

/**
 * Notification types sent by the API. The clients render each type's text in the
 * reader's language from `data` (see web/src/lib/i18n, key notifications.types).
 */
export const NOTIFICATION_TYPES = Object.freeze([
  'proposal_received',
  'proposal_accepted',
  'proposal_declined',
  'biodata_approved',
  'biodata_rejected',
  'payment_verified',
  'payment_rejected',
  'refund_approved',
  'refund_rejected',
  'ticket_replied',
  'nid_verified',
  'nid_rejected',
  'restore_approved',
  'restore_declined',
  'connections_adjusted',
  'favorited',
  'contact_unlocked',
  'report_closed',
  'password_reset_by_staff',
  'connections_gift',
  'edit_suspended',
]);

/** Creates an in-app notification. Never throws. */
export async function notify(userId, type, data = {}, link) {
  if (!userId) return;
  try {
    await Notification.create({ user: userId, type, data, link });
  } catch (err) {
    logger.error({ err, type }, 'Notification write failed');
  }
}

export async function listNotifications(userId, query) {
  const params = pageParams(query, { defaultLimit: 20 });
  const filter = { user: userId };
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...filter, readAt: null }),
  ]);
  return { ...paged(items, total, params), unread };
}

export function countUnread(userId) {
  return Notification.countDocuments({ user: userId, readAt: null });
}

export async function markAllRead(userId) {
  await Notification.updateMany({ user: userId, readAt: null }, { readAt: new Date() });
}

export async function markRead(userId, id) {
  await Notification.updateOne({ _id: id, user: userId }, { readAt: new Date() });
}

export async function removeNotification(userId, id) {
  await Notification.deleteOne({ _id: id, user: userId });
}
