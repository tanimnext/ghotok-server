import { getAuth } from '../config/auth.js';
import { User } from '../models/index.js';

// Server-side account work that has no Better Auth HTTP endpoint: accounts created by
// the seed or by an admin, password checks for sensitive actions, staff password
// resets and signing a user out everywhere. Everything goes through Better Auth's
// own adapter and password hashing, so these accounts sign in like any other.

const context = () => getAuth().$context;
const id = (userId) => String(userId);

/**
 * Creates an email + password account. Better Auth gives every new account the role
 * "user"; `role` is applied afterwards so only server code can create admins.
 * @returns {Promise<import('mongoose').Document>} the Mongoose User
 */
export async function createPasswordAccount({ name, email, phoneNumber, password, role = 'user', verified }) {
  const ctx = await context();
  const created = await ctx.internalAdapter.createUser(
    {
      name,
      email: email.toLowerCase(),
      emailVerified: !!verified,
      ...(phoneNumber ? { phoneNumber, phoneNumberVerified: !!verified } : {}),
    },
    { method: 'admin' },
  );
  await ctx.internalAdapter.createAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: await ctx.password.hash(password),
  });
  if (role !== 'user') await User.updateOne({ _id: created.id }, { role });
  return User.findById(created.id);
}

/** True when the account has a password and `password` matches it. */
export async function checkPassword(userId, password) {
  const ctx = await context();
  const account = await ctx.internalAdapter.findCredentialAccount(id(userId));
  if (!account?.password) return false;
  return ctx.password.verify({ hash: account.password, password });
}

/** True when the account can sign in with a password (members who only use codes or Google cannot). */
export async function hasPassword(userId) {
  const ctx = await context();
  return !!(await ctx.internalAdapter.findCredentialAccount(id(userId)))?.password;
}

/** Sets a new password (adding one to code-only accounts) and signs the user out everywhere. */
export async function setPassword(userId, password) {
  const ctx = await context();
  const hash = await ctx.password.hash(password);
  const account = await ctx.internalAdapter.findCredentialAccount(id(userId));
  if (account) await ctx.internalAdapter.updatePassword(id(userId), hash);
  else
    await ctx.internalAdapter.createAccount({
      userId: id(userId),
      providerId: 'credential',
      accountId: id(userId),
      password: hash,
    });
  await revokeAllSessions(userId);
}

export async function revokeAllSessions(userId) {
  const ctx = await context();
  await ctx.internalAdapter.deleteUserSessions(id(userId));
}
