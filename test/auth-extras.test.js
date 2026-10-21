import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { google } from '../src/integrations/oauth/google.js';
import { User } from '../src/models/index.js';
import { app, createUser, login } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const cookie = (res, name) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));

describe('one-time code sign-in', () => {
  it('signs in with a code sent to the email', async () => {
    const user = await createUser();
    const sent = await request(app).post('/api/auth/login/code').send({ identifier: user.email });
    expect(sent.status).toBe(200);
    expect(sent.body.devOtp).toMatch(/^\d{6}$/);

    const wrong = sent.body.devOtp === '000000' ? '111111' : '000000';
    const bad = await request(app)
      .post('/api/auth/login/code/verify')
      .send({ identifier: user.email, code: wrong });
    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post('/api/auth/login/code/verify')
      .send({ identifier: user.email, code: sent.body.devOtp });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(user._id.toString());
    // The code works once.
    const replay = await request(app)
      .post('/api/auth/login/code/verify')
      .send({ identifier: user.email, code: sent.body.devOtp });
    expect(replay.status).toBe(400);
  });

  it('answers the same way for unknown accounts', async () => {
    const res = await request(app).post('/api/auth/login/code').send({ identifier: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('remember me and signed-in devices', () => {
  it('uses browser-session cookies when "remember me" is off', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'Password1!', remember: false });
    expect(res.status).toBe(200);
    expect(cookie(res, 'gh_rt')).not.toMatch(/Max-Age|Expires/i);
    const kept = await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'Password1!' });
    expect(cookie(kept, 'gh_rt')).toMatch(/Max-Age/i);
  });

  it('lists devices and signs one or all of them out', async () => {
    const user = await createUser();
    const laptop = await login(user);
    const phone = await login(user);

    const list = await laptop.get('/api/auth/sessions');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.filter((s) => s.current)).toHaveLength(1);
    const other = list.body.items.find((s) => !s.current);

    expect((await laptop.delete(`/api/auth/sessions/${other.id}`)).status).toBe(200);
    expect((await phone.post('/api/auth/refresh')).status).toBe(401);
    expect((await laptop.get('/api/auth/sessions')).body.items).toHaveLength(1);
    expect((await laptop.delete(`/api/auth/sessions/${other.id}`)).status).toBe(404);

    await login(user);
    expect((await laptop.post('/api/auth/logout-all')).status).toBe(200);
    expect((await laptop.post('/api/auth/refresh')).status).toBe(401);
  });

  it('signs other devices out after a password change', async () => {
    const user = await createUser();
    const here = await login(user);
    const there = await login(user);
    const res = await here
      .post('/api/me/change-password')
      .send({ currentPassword: 'Password1!', newPassword: 'NewSecret123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, signedOut: 1 });
    expect((await here.post('/api/auth/refresh')).status).toBe(200);
    expect((await there.post('/api/auth/refresh')).status).toBe(401);
  });
});

describe('Google sign-in', () => {
  const start = async (agent, query = '') => {
    const res = await agent.get(`/api/auth/google/start${query}`);
    expect(res.status).toBe(302);
    return new URL(res.headers.location).searchParams.get('state');
  };

  it('is off without credentials', async () => {
    expect((await request(app).get('/api/auth/google/start')).status).toBe(404);
  });

  it('creates an account, then links the same Google account on the next sign-in', async () => {
    vi.spyOn(google, 'enabled', 'get').mockReturnValue(true);
    const profile = vi
      .spyOn(google, 'profileFromCode')
      .mockResolvedValue({ googleId: 'g-123', email: 'mina@example.com', name: 'Mina' });

    const agent = request.agent(app);
    const state = await start(agent, '?next=/dashboard/biodata');
    const cb = await agent.get(`/api/auth/google/callback?code=abc&state=${state}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe(`${env.WEB_URL}/dashboard/biodata`);
    expect(profile).toHaveBeenCalledWith('abc', expect.any(String));
    const me = await agent.get('/api/auth/me');
    expect(me.body.user.email).toBe('mina@example.com');
    expect(await User.countDocuments({ googleId: 'g-123' })).toBe(1);

    // A second sign-in reuses the account.
    const again = request.agent(app);
    const state2 = await start(again);
    await again.get(`/api/auth/google/callback?code=abc&state=${state2}`).expect(302);
    expect(await User.countDocuments({ email: 'mina@example.com' })).toBe(1);
  });

  it('links an existing account with the same email', async () => {
    vi.spyOn(google, 'enabled', 'get').mockReturnValue(true);
    const user = await createUser({ verified: false });
    vi.spyOn(google, 'profileFromCode').mockResolvedValue({
      googleId: 'g-456',
      email: user.email,
      name: 'Someone',
    });
    const agent = request.agent(app);
    const state = await start(agent);
    await agent.get(`/api/auth/google/callback?code=x&state=${state}`).expect(302);
    const saved = await User.findById(user._id);
    expect(saved).toMatchObject({ googleId: 'g-456', emailVerified: true });
  });

  it('rejects a callback whose state does not match', async () => {
    vi.spyOn(google, 'enabled', 'get').mockReturnValue(true);
    const profile = vi.spyOn(google, 'profileFromCode');
    const agent = request.agent(app);
    await start(agent);
    const cb = await agent.get('/api/auth/google/callback?code=abc&state=forged');
    expect(cb.headers.location).toBe(`${env.WEB_URL}/login?error=google`);
    expect(profile).not.toHaveBeenCalled();
    // Without the start cookie at all.
    const bare = await request(app).get('/api/auth/google/callback?code=abc&state=forged');
    expect(bare.headers.location).toContain('error=google');
  });

  it('verifies the ID token claims', async () => {
    const saved = { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
    env.GOOGLE_CLIENT_ID = 'client-1';
    env.GOOGLE_CLIENT_SECRET = 'secret-1';
    const claims = {
      aud: 'client-1',
      iss: 'https://accounts.google.com',
      exp: String(Math.floor(Date.now() / 1000) + 600),
      nonce: 'n1',
      email_verified: 'true',
      sub: 'g-789',
      email: 'Rafi@Example.com',
      name: 'Rafi',
    };
    const reply = (body) => new Response(JSON.stringify(body), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      fetchMock.mockResolvedValueOnce(reply({ id_token: 't' })).mockResolvedValueOnce(reply(claims));
      await expect(google.profileFromCode('c', 'n1')).resolves.toEqual({
        googleId: 'g-789',
        email: 'rafi@example.com',
        name: 'Rafi',
      });
      for (const bad of [{ nonce: 'other' }, { aud: 'someone-else' }, { email_verified: 'false' }]) {
        fetchMock
          .mockResolvedValueOnce(reply({ id_token: 't' }))
          .mockResolvedValueOnce(reply({ ...claims, ...bad }));
        await expect(google.profileFromCode('c', 'n1')).rejects.toThrow(/verification/);
      }
    } finally {
      env.GOOGLE_CLIENT_ID = saved.id;
      env.GOOGLE_CLIENT_SECRET = saved.secret;
    }
  });
});
