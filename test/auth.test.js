import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, createUser, login } from './helpers.js';

const cookieOf = (res, name) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));

describe('auth', () => {
  it('registers, requires verification, verifies with the code and signs in', async () => {
    const agent = request.agent(app);
    const reg = await agent
      .post('/api/auth/register')
      .send({ name: 'Rina', email: 'Rina@Example.com', password: 'Secret123!' });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({ needsVerification: true, identifier: 'rina@example.com' });
    expect(reg.body.devOtp).toMatch(/^\d{6}$/);

    const early = await agent
      .post('/api/auth/login')
      .send({ identifier: 'rina@example.com', password: 'Secret123!' });
    expect(early.status).toBe(403);
    expect(early.body.error.code).toBe('NOT_VERIFIED');

    const bad = await agent
      .post('/api/auth/verify')
      .send({ identifier: 'rina@example.com', code: '000000' === reg.body.devOtp ? '111111' : '000000' });
    expect(bad.status).toBe(400);

    const ok = await agent
      .post('/api/auth/verify')
      .send({ identifier: 'rina@example.com', code: reg.body.devOtp });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ name: 'Rina', emailVerified: true, role: 'user' });
    expect(cookieOf(ok, 'gh_at')).toMatch(/HttpOnly/);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('rina@example.com');
    expect(me.body.user).not.toHaveProperty('passwordHash');
  });

  it('registers with a phone number in any common format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Karim', phone: '+880 1712-345678', password: 'Secret123!' });
    expect(res.status).toBe(201);
    expect(res.body.identifier).toBe('01712345678');
    const dup = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Karim 2', phone: '01712345678', password: 'Secret123!' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ACCOUNT_EXISTS');
  });

  it('rejects wrong passwords without revealing whether the account exists', async () => {
    const user = await createUser();
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'nope-nope' });
    const missing = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'nobody@example.com', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.error.message).toBe(missing.body.error.message);
  });

  it('rotates refresh tokens and revokes the family when an old token is reused', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'Password1!' });
    const first = res.body.refreshToken;
    const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken: first });
    expect(r1.status).toBe(200);
    const second = r1.body.refreshToken;
    expect(second).not.toBe(first);

    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: first });
    expect(reuse.status).toBe(401);
    // The reuse revoked the newer token too.
    const after = await request(app).post('/api/auth/refresh').send({ refreshToken: second });
    expect(after.status).toBe(401);
  });

  it('answers TOKEN_EXPIRED for an expired access token and accepts bearer tokens', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'Password1!' });
    const ok = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(ok.status).toBe(200);
    const jwt = await import('jsonwebtoken');
    const expired = jwt.default.sign(
      { sub: user._id.toString(), role: 'user' },
      'dev-access-secret-change-me',
      { expiresIn: -10, issuer: 'ghotok' },
    );
    const exp = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(exp.status).toBe(401);
    expect(exp.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('resets a forgotten password with a code and signs out other sessions', async () => {
    const user = await createUser();
    const oldSession = await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'Password1!' });
    const forgot = await request(app).post('/api/auth/forgot-password').send({ identifier: user.email });
    expect(forgot.status).toBe(200);
    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ identifier: user.email, code: forgot.body.devOtp, password: 'BrandNew123' });
    expect(reset.status).toBe(200);
    const stale = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldSession.body.refreshToken });
    expect(stale.status).toBe(401);
    await login(user, 'BrandNew123');
  });

  it('logs out and blocks suspended users', async () => {
    const user = await createUser();
    const agent = await login(user);
    expect((await agent.post('/api/auth/logout')).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);

    user.status = 'suspended';
    await user.save();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'Password1!' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('rejects state-changing requests from foreign origins', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ identifier: 'a@b.cd', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });
});
