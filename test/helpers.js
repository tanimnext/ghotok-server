import request from 'supertest';
import { createApp, devOutboxIntegration, models, seedPeople } from '../index.js';

const { lastDevCode } = devOutboxIntegration;
const { Biodata, User, nextSequence } = models;
const { PEOPLE, demoSections } = seedPeople;

export const app = createApp();

/** The website origin the API trusts (see vitest.config.js). Browsers always send it. */
export const ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'Password1!';

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n += 1)}`;

/** A cookie-keeping client that behaves like the website. */
export function client() {
  return request.agent(app).set('Origin', ORIGIN);
}

/**
 * Creates an account through Better Auth's sign-up endpoint, then applies the test
 * setup straight in the database (that is the only way to make an admin).
 */
export async function createUser({
  role = 'user',
  verified = true,
  balance = 0,
  password = PASSWORD,
  name = 'Test User',
  email = `u${uniq()}@example.com`,
} = {}) {
  const res = await client().post('/api/auth/sign-up/email').send({ name, email, password });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  await User.updateOne(
    { _id: res.body.user.id },
    { role, emailVerified: verified, connectionBalance: balance },
  );
  return User.findById(res.body.user.id);
}

/** A client signed in as `user` (email + password). */
export async function login(user, password = PASSWORD) {
  const agent = client();
  const res = await agent.post('/api/auth/sign-in/email').send({ email: user.email, password });
  if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

export async function userWithAgent(opts) {
  const user = await createUser(opts);
  return { user, agent: await login(user) };
}

/** The last one-time code "sent" to an email or phone number (OTP_DEV_ECHO is on in tests). */
export const codeFor = (to) => lastDevCode(to);

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
