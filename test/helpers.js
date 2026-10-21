import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/utils/crypto.js';
import { Biodata, User, nextSequence } from '../src/models/index.js';
import { PEOPLE, demoSections } from '../src/scripts/seed-data/demo-people.js';

export const app = createApp();

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n += 1)}`;

export async function createUser({
  role = 'user',
  verified = true,
  balance = 0,
  password = 'Password1!',
  name = 'Test User',
} = {}) {
  const id = uniq();
  const user = await User.create({
    name,
    email: `u${id}@example.com`,
    passwordHash: await hashPassword(password),
    role,
    emailVerified: verified,
    connectionBalance: balance,
  });
  return user;
}

/** A supertest agent that keeps the auth cookies of a logged-in user. */
export async function login(user, password = 'Password1!') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ identifier: user.email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
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
