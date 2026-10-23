import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, client, createUser, login, PASSWORD, startSession, userWithAgent } from './helpers.js';
import { credentialsService, models, sessionAuth } from '../index.js';

const { User } = models;
const sessions = () => mongoose.connection.collection('session');

// Sign-up and sign-in happen on the website (Better Auth in ghotok-client). This API only
// reads the session cookie the website sets and the `session` row behind it.

describe('sessions from the website', () => {
  it('accepts the signed Better Auth cookie and rejects tampered, unknown or expired ones', async () => {
    const user = await createUser();
    const { token, cookie } = await startSession(user);
    const ok = await client().set('Cookie', cookie).get('/api/me');
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ id: user._id.toString(), role: 'user' });

    // The secure-prefixed name (HTTPS sites) works too.
    const secure = cookie.replace('ghotok.session_token', '__Secure-ghotok.session_token');
    expect((await client().set('Cookie', secure).get('/api/me')).status).toBe(200);

    const forged = `ghotok.session_token=${encodeURIComponent(`${token}.${'A'.repeat(43)}=`)}`;
    expect((await client().set('Cookie', forged).get('/api/me')).status).toBe(401);
    expect((await client().set('Cookie', `ghotok.session_token=${token}`).get('/api/me')).status).toBe(401);
    const unknown = `ghotok.session_token=${sessionAuth.signedCookieValue('not-a-session')}`;
    expect((await client().set('Cookie', unknown).get('/api/me')).status).toBe(401);

    const old = await startSession(user, { expiresAt: new Date(Date.now() - 1000) });
    expect((await client().set('Cookie', old.cookie).get('/api/me')).status).toBe(401);
  });

  it('checks cookies exactly like Better Auth signs them', () => {
    // A cookie Better Auth 1.7.7 set with the development secret (from a real sign-in).
    const cookie = 'T3Xcr5ccTaY21dmmfAKu8SLEZS9RbnW1.ZItPYA2W11WaH8HRbmT5bGKDy4ydUbCQnkfW3BhU6Tc%3D';
    expect(sessionAuth.tokenFromCookie(cookie)).toBe('T3Xcr5ccTaY21dmmfAKu8SLEZS9RbnW1');
    expect(sessionAuth.signedCookieValue('T3Xcr5ccTaY21dmmfAKu8SLEZS9RbnW1')).toBe(cookie);
  });

  it('hashes passwords in Better Auth’s format, so seeded accounts sign in on the website', async () => {
    // A hash Better Auth 1.7.7 created for "ChangeMe!2026".
    const hash =
      '0843412041326154fd4c3899dc50015e:b3c28475984383b465f8e9528e97c9b0bc13b6caa80e94b8f5ee5270cbed24b25d671b8560f14722d8c5543e78bafdf8f5741f1dfb02bbf5f20a736f391b1730';
    expect(await sessionAuth.verifyPassword(hash, 'ChangeMe!2026')).toBe(true);
    expect(await sessionAuth.verifyPassword(hash, 'changeme!2026')).toBe(false);
    const ours = await sessionAuth.hashPassword('Another pass 1');
    expect(ours).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(await sessionAuth.verifyPassword(ours, 'Another pass 1')).toBe(true);

    const user = await createUser();
    const account = await mongoose.connection.collection('account').findOne({ userId: user._id });
    expect(account).toMatchObject({ providerId: 'credential', accountId: user._id.toString() });
    expect(await credentialsService.checkPassword(user._id, PASSWORD)).toBe(true);
  });
});

describe('roles', () => {
  it('treats new accounts as members and gives admin access only after a role change in the database', async () => {
    const { agent, user } = await userWithAgent();
    expect((await agent.get('/api/me')).body.user.role).toBe('user');
    expect((await agent.get('/api/admin/overview')).status).toBe(403);
    expect((await request(app).get('/api/admin/overview')).status).toBe(401);

    await User.updateOne({ _id: user._id }, { role: 'admin' });
    expect((await agent.get('/api/admin/overview')).status).toBe(200);
  });

  it('refuses suspended and banned accounts even with a live session', async () => {
    for (const status of ['suspended', 'banned']) {
      const { agent, user } = await userWithAgent();
      await User.updateOne({ _id: user._id }, { status });
      const res = await agent.get('/api/me');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
    }
  });
});

describe('deactivation', () => {
  it('needs the password and signs the member out of every device', async () => {
    const { agent, user } = await userWithAgent();
    await login(user); // a second device
    expect((await agent.delete('/api/me').send({ password: 'wrong-password' })).status).toBe(400);
    expect((await agent.delete('/api/me').send({ password: PASSWORD })).status).toBe(200);
    expect((await User.findById(user._id)).status).toBe('deactivated');
    expect(await sessions().countDocuments({ userId: user._id })).toBe(0);
    expect((await agent.get('/api/me')).status).toBe(401);
  });
});

describe('moved to the website', () => {
  it('no longer serves Better Auth, checkout or gateway routes', async () => {
    const { agent } = await userWithAgent();
    expect((await client().post('/api/auth/sign-in/email').send({})).status).toBe(404);
    expect((await agent.post('/api/payments').send({})).status).toBe(404);
    expect((await request(app).post('/api/gateway/sslcommerz/ipn').type('form').send({})).status).toBe(404);
  });
});
