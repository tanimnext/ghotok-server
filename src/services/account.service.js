import { Biodata, Proposal } from '../models/index.js';
import { ApiError } from '../utils/api-error.js';
import { checkPassword, hasPassword, revokeAllSessions } from './credentials.service.js';

// A member managing their own account. Passwords, sessions and sign-in methods are
// changed through Better Auth's endpoints (/api/auth/*) from the client.

export async function updateProfile(user, { name, language }) {
  if (name !== undefined) user.name = name;
  if (language !== undefined) user.language = language;
  await user.save();
  return user;
}

/**
 * Deactivates the account: removes the biodata, withdraws proposals and signs out
 * everywhere. Accounts with a password must confirm it; signing in again reactivates.
 */
export async function deactivate(user, { password, reason }) {
  if ((await hasPassword(user._id)) && !(password && (await checkPassword(user._id, password)))) {
    throw new ApiError(400, 'WRONG_PASSWORD', 'The password is incorrect.', {
      fields: { password: 'invalid' },
    });
  }
  user.status = 'deactivated';
  user.deactivatedAt = new Date();
  user.statusReason = reason;
  await user.save();
  await Biodata.updateOne(
    { user: user._id, deletedAt: null },
    { deletedAt: new Date(), deleteReason: 'other', deleteNote: 'Account deactivated' },
  );
  await Proposal.updateMany({ from: user._id, status: 'pending' }, { status: 'withdrawn' });
  await revokeAllSessions(user._id);
}
