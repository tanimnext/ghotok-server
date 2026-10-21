import * as accountService from '../services/account.service.js';
import { myConnections } from '../services/connection.service.js';
import { memberDashboard } from '../services/dashboard.service.js';
import * as listService from '../services/list.service.js';
import * as notificationService from '../services/notification.service.js';
import * as proposalService from '../services/proposal.service.js';
import { issueTokens } from '../services/token.service.js';
import { toUserDTO } from '../serializers/user.serializer.js';
import { clearAuthCookies, setAuthCookies } from '../utils/auth-cookies.js';
import { requestContext } from '../utils/request.js';

// The signed-in member's own account (/api/me).

export async function dashboard(req, res) {
  res.json(await memberDashboard(req.user));
}

export async function updateProfile(req, res) {
  res.json({ user: toUserDTO(await accountService.updateProfile(req.user, req.body)) });
}

export async function changePassword(req, res) {
  const keep = req.sessionFamily;
  const { user, signedOut } = await accountService.changePassword(req.user._id, req.body, keep);
  // An access token from before session ids existed names no device; give this one a fresh session.
  if (!keep) setAuthCookies(res, await issueTokens(user, requestContext(req)));
  res.json({ ok: true, signedOut });
}

export async function deactivate(req, res) {
  await accountService.deactivate(req.user._id, req.body);
  clearAuthCookies(res);
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
