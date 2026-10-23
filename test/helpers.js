import crypto from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp, credentialsService, models, seedPeople, sessionAuth } from '../index.js';

const { Biodata, User, nextSequence } = models;
const { PEOPLE, demoSections } = seedPeople;

export const app = createApp();

/** The website origin the API trusts (see vitest.config.js). Browsers always send it. */
export const ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'Password1!';

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n += 1)}`;

/** A client that behaves like the website (it always sends its origin). */
export function client() {
  return request.agent(app).set('Origin', ORIGIN);
}

/**
 * Creates an email + password account the way the seed does (Better Auth's collections),
 * then applies the test setup in the database (the only way to make an admin).
 */
export async function createUser({
  role = 'user',
  verified = true,
  balance = 0,
  password = PASSWORD,
  name = 'Test User',
  email = `u${uniq()}@example.com`,
} = {}) {
  const user = await credentialsService.createPasswordAccount({ name, email, password, verified });
  await User.updateOne({ _id: user._id }, { role, connectionBalance: balance });
  return User.findById(user._id);
}

/**
 * Starts a session for `user` exactly as Better Auth on the website would (a row in
 * `session` and the signed `ghotok.session_token` cookie) and returns its token and cookie.
 */
export async function startSession(user, { expiresAt = new Date(Date.now() + 864e5) } = {}) {
  const token = crypto.randomBytes(24).toString('base64url');
  const now = new Date();
  await mongoose.connection.collection('session').insertOne({
    token,
    userId: user._id,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: '',
    userAgent: 'vitest',
  });
  return { token, cookie: `ghotok.session_token=${sessionAuth.signedCookieValue(token)}` };
}

/** A client signed in as `user`. */
export async function login(user) {
  const { cookie } = await startSession(user);
  return client().set('Cookie', cookie);
}

export async function userWithAgent(opts) {
  const user = await createUser(opts);
  return { user, agent: await login(user) };
}

/** Creates a complete, approved biodata for a new user. */
export async function approvedBiodata({ index = 0, overrides = {}, status = 'approved' } = {}) {
  const user = await createUser({ name: PEOPLE[index][9] });
  const sections = demoSections(PEOPLE[index], index);
  for (const [k, v] of Object.entries(overrides)) sections[k] = { ...sections[k], ...v };
  const biodata = await Biodata.create({
    user: user._id,
    biodataNo: `GH-${await nextSequence('biodata', 1000)}`,
    ...sections,
    status,
    submittedAt: new Date(),
    ...(status === 'approved' ? { approvedAt: new Date() } : {}),
  });
  return { user, biodata, sections };
}

export { PEOPLE, demoSections };
