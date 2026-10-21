import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, client, codeFor, createUser, login, ORIGIN, PASSWORD, userWithAgent } from './helpers.js';
import { models } from '../index.js';

const { User } = models;

const cookieOf = (res, name) => (res.headers['set-cookie'] ?? []).find((c) => c.includes(`${name}=`));

describe('sign-up and roles', () => {
  it('makes every new account a member, whatever the request says', async () => {
    const agent = client();
    // Better Auth drops fields marked input:false, so these are ignored.
    const ok = await agent.post('/api/auth/sign-up/email').send({
      name: 'Rina Akter',
      email: 'Rina@Example.com',
      password: PASSWORD,
      role: 'admin',
      status: 'active',
      connectionBalance: 99,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ email: 'rina@example.com', role: 'user' });
    const stored = await User.findById(ok.body.user.id);
    expect(stored).toMatchObject({
      role: 'user',
      status: 'active',
      connectionBalance: 0,
      emailVerified: false,
    });

    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ role: 'user', email: 'rina@example.com', isVerified: false });

    // update-user cannot change the role either.
    const sneaky = await agent.post('/api/auth/update-user').send({ role: 'admin', connectionBalance: 5 });
    expect(sneaky.status).toBe(400);
    await agent.post('/api/auth/update-user').send({ language: 'bn' }).expect(200);
    expect((await agent.get('/api/me')).body.user).toMatchObject({
      role: 'user',
      connectionBalance: 0,
      language: 'bn',
    });

    // The same email cannot register twice.
    const dup = await client()
      .post('/api/auth/sign-up/email')
      .send({ name: 'Copy', email: 'rina@example.com', password: PASSWORD });
    expect(dup.status).toBe(422);
  });

  it('gives admin access only after the role is changed in the database', async () => {
    const { agent, user } = await userWithAgent();
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await agent.get('/api/admin/overview')).status).toBe(403);
    await User.updateOne({ _id: user._id }, { role: 'admin' });
    expect((await agent.get('/api/me')).body.user.role).toBe('admin');
    expect((await agent.get('/api/admin/overview')).status).toBe(200);
    const session = await agent.get('/api/auth/get-session');
    expect(session.body.user.role).toBe('admin');
  });

  it('requires a verified email or phone before creating a biodata', async () => {
    const { agent } = await userWithAgent({ verified: false });
    const res = await agent.post('/api/biodatas/me').send({ pledge: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_VERIFIED');
  });
});

describe('one-time codes', () => {
  it('verifies the email with the code sent at sign-up', async () => {
    const agent = client();
    await agent
      .post('/api/auth/sign-up/email')
      .send({ name: 'Mitu', email: 'mitu@example.com', password: PASSWORD })
      .expect(200);
    const code = codeFor('mitu@example.com');
    expect(code).toMatch(/^\d{6}$/);
    const wrong = await agent
      .post('/api/auth/email-otp/verify-email')
      .send({ email: 'mitu@example.com', otp: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const ok = await agent
      .post('/api/auth/email-otp/verify-email')
      .send({ email: 'mitu@example.com', otp: code });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/me')).body.user).toMatchObject({ emailVerified: true, isVerified: true });
  });

  it('signs in with an emailed code', async () => {
    const user = await createUser();
    const sent = await client()
      .post('/api/auth/email-otp/send-verification-otp')
      .send({ email: user.email, type: 'sign-in' });
    expect(sent.status).toBe(200);
    const agent = client();
    const res = await agent
      .post('/api/auth/sign-in/email-otp')
      .send({ email: user.email, otp: codeFor(user.email) });
    expect(res.status).toBe(200);
    expect((await agent.get('/api/me')).body.user.id).toBe(user._id.toString());
  });

  it('signs in (and signs up) with an SMS code, as a member', async () => {
    const phone = '01712345678';
    const bad = await client()
      .post('/api/auth/phone-number/send-otp')
      .send({ phoneNumber: '+8801712345678' });
    expect(bad.status).toBe(400);
    await client().post('/api/auth/phone-number/send-otp').send({ phoneNumber: phone }).expect(200);
    const agent = client();
    const res = await agent
      .post('/api/auth/phone-number/verify')
      .send({ phoneNumber: phone, code: codeFor(phone) });
    expect(res.status).toBe(200);
    const me = (await agent.get('/api/me')).body.user;
    expect(me).toMatchObject({ phoneNumber: phone, phoneNumberVerified: true, role: 'user', email: null });
    // SMS-only members have no password, so deactivating needs none.
    expect((await agent.delete('/api/me').send({})).status).toBe(200);
  });

  it('resets a forgotten password with an emailed code', async () => {
    const user = await createUser();
    const before = await login(user);
    await client().post('/api/auth/email-otp/request-password-reset').send({ email: user.email }).expect(200);
    const reset = await client()
      .post('/api/auth/email-otp/reset-password')
      .send({ email: user.email, otp: codeFor(user.email), password: 'BrandNew123' });
    expect(reset.status).toBe(200);
    expect((await before.get('/api/me')).status).toBe(401);
    const old = await client()
      .post('/api/auth/sign-in/email')
      .send({ email: user.email, password: PASSWORD });
    expect(old.status).toBe(401);
    await login(user, 'BrandNew123');
  });
});

describe('sessions', () => {
  it('ends the session with the browser when "remember me" is off', async () => {
    const user = await createUser();
    const res = await client()
      .post('/api/auth/sign-in/email')
      .send({ email: user.email, password: PASSWORD, rememberMe: false });
    expect(res.status).toBe(200);
    expect(cookieOf(res, 'ghotok.session_token')).not.toMatch(/Max-Age/i);
    const kept = await client()
      .post('/api/auth/sign-in/email')
      .send({ email: user.email, password: PASSWORD });
    expect(cookieOf(kept, 'ghotok.session_token')).toMatch(/Max-Age/i);
  });

  it('lists devices, signs out the others and changes the password', async () => {
    const user = await createUser();
    const laptop = await login(user);
    const phone = await login(user);
    const list = await laptop.get('/api/auth/list-sessions');
    expect(list.status).toBe(200);
    // Signing up also opened a session, so there are three.
    expect(list.body).toHaveLength(3);

    // Sign one device out by its token.
    const phoneToken = (await phone.get('/api/auth/get-session')).body.session.token;
    await laptop.post('/api/auth/revoke-session').send({ token: phoneToken }).expect(200);
    expect((await phone.get('/api/me')).status).toBe(401);
    const tv = await login(user);

    await laptop.post('/api/auth/revoke-other-sessions').send({}).expect(200);
    expect((await tv.get('/api/me')).status).toBe(401);
    expect((await phone.get('/api/me')).status).toBe(401);
    expect((await laptop.get('/api/me')).status).toBe(200);

    const tablet = await login(user);
    const changed = await laptop
      .post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'NewSecret123', revokeOtherSessions: true });
    expect(changed.status).toBe(200);
    expect((await tablet.get('/api/me')).status).toBe(401);
    expect((await laptop.get('/api/me')).status).toBe(200);

    await laptop.post('/api/auth/sign-out').send({}).expect(200);
    expect((await laptop.get('/api/me')).status).toBe(401);
  });

  it('reactivates a deactivated account on the next sign-in', async () => {
    const { agent, user } = await userWithAgent();
    expect((await agent.delete('/api/me').send({ password: 'wrong-password' })).status).toBe(400);
    expect((await agent.delete('/api/me').send({ password: PASSWORD })).status).toBe(200);
    expect((await User.findById(user._id)).status).toBe('deactivated');
    expect((await agent.get('/api/me')).status).toBe(401);
    const back = await login(user);
    expect((await back.get('/api/me')).body.user.status).toBe('active');
  });

  it('refuses auth requests from untrusted origins', async () => {
    const res = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', 'https://evil.example.com')
      .send({ name: 'Eve', email: 'eve@example.com', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(await User.exists({ email: 'eve@example.com' })).toBeNull();
    const ours = await request(app)
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send({ name: 'Eve', email: 'eve@example.com', password: PASSWORD });
    expect(ours.status).toBe(200);
  });
});
