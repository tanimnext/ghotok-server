import * as accountService from '../services/account.service.js';
import { myConnections } from '../services/connection.service.js';
import { memberDashboard } from '../services/dashboard.service.js';
import * as listService from '../services/list.service.js';
import * as notificationService from '../services/notification.service.js';
import * as proposalService from '../services/proposal.service.js';
import { toUserDTO } from '../serializers/user.serializer.js';

// The signed-in member's own account (/api/me).

/** The signed-in account (role decides where the client sends the user: /admin or /dashboard). */
export function me(req, res) {
  res.json({ user: toUserDTO(req.user) });
}

export async function dashboard(req, res) {
  res.json(await memberDashboard(req.user));
}

export async function updateProfile(req, res) {
  res.json({ user: toUserDTO(await accountService.updateProfile(req.user, req.body)) });
}

export async function deactivate(req, res) {
  await accountService.deactivate(req.user, req.body);
  res.json({ ok: true });
}

export async function favorites(req, res) {
  res.json(await listService.listEntries('favorite', req.user, req.query));
}

export async function dislikes(req, res) {
  res.json(await listService.listEntries('dislike', req.user, req.query));
}

export async function favoritedMe(req, res) {
  res.json(await listService.favoritedMe(req.user, req.query));
}

export async function unlocks(req, res) {
  res.json(await listService.unlockedContacts(req.user, req.query));
}

export async function proposals(req, res) {
  res.json(await proposalService.listProposals(req.user, req.query, req.query));
}

export async function respondToProposal(req, res) {
  res.json(await proposalService.respondToProposal(req.user, req.params.id, req.body));
}

export async function withdrawProposal(req, res) {
  res.json(await proposalService.withdrawProposal(req.user, req.params.id));
}

export async function notifications(req, res) {
  res.json(await notificationService.listNotifications(req.user._id, req.query));
}

export async function markAllNotificationsRead(req, res) {
  await notificationService.markAllRead(req.user._id);
  res.json({ ok: true });
}

export async function markNotificationRead(req, res) {
  await notificationService.markRead(req.user._id, req.params.id);
  res.json({ ok: true });
}

export async function connections(req, res) {
  res.json(await myConnections(req.user, req.query));
}

export async function deleteNotification(req, res) {
  await notificationService.removeNotification(req.user._id, req.params.id);
  res.json({ ok: true });
}
