import { beforeAll, describe, expect, it } from 'vitest';
import { ConnectionTransaction, Package, User } from '../src/models/index.js';
import { approvedBiodata, userWithAgent } from './helpers.js';

let standard;
let starter;

beforeAll(async () => {
  starter = await Package.create({ name: { en: 'Starter' }, connections: 3, price: 300, sortOrder: 1 });
  standard = await Package.create({ name: { en: 'Standard' }, connections: 5, price: 500, sortOrder: 2 });
});

async function manualPayment(agent, { pkg = standard, method = 'bkash', trxId } = {}) {
  return agent.post('/api/payments').send({
    packageId: pkg._id.toString(),
    method,
    mode: 'manual',
    senderNumber: '01712345678',
    trxId: trxId ?? `TRX${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  });
}

describe('connections and payments', () => {
  it('lists active packages with payment methods', async () => {
    const { agent } = await userWithAgent();
    const res = await agent.get('/api/packages');
    expect(res.status).toBe(200);
    expect(res.body.packages.map((p) => [p.connections, p.price])).toEqual([
      [3, 300],
      [5, 500],
    ]);
    expect(res.body.methods.map((m) => m.value)).toEqual(['bkash', 'nagad', 'rocket', 'sslcommerz']);
    expect(res.body.methods.every((m) => m.gateway === false)).toBe(true);
    // Card / mobile banking needs SSLCommerz keys, so it is off here.
    expect(res.body.methods.find((m) => m.value === 'sslcommerz')).toMatchObject({
      enabled: false,
      gatewayOnly: true,
    });
  });

  it('refuses to unlock a contact without a balance', async () => {
    const { biodata } = await approvedBiodata({ index: 0 });
    const { agent } = await userWithAgent();
    const res = await agent.post(`/api/biodatas/${biodata.biodataNo}/unlock`);
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CONNECTIONS');
  });

  it('credits a manual payment once after admin verification', async () => {
    const { agent, user } = await userWithAgent();
    const pay = await manualPayment(agent, { trxId: 'ABC123XYZ' });
    expect(pay.status).toBe(201);
    expect(pay.body.payment).toMatchObject({
      status: 'pending',
      amount: 500,
      connections: 5,
      trxId: 'ABC123XYZ',
    });

    const dup = await manualPayment(agent, { trxId: 'abc123xyz' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_TRX');

    const { agent: admin } = await userWithAgent({ role: 'super_admin' });
    const [a, b] = await Promise.all([
      admin.post(`/api/admin/payments/${pay.body.payment.id}/verify`),
      admin.post(`/api/admin/payments/${pay.body.payment.id}/verify`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const fresh = await User.findById(user._id);
    expect(fresh.connectionBalance).toBe(5);
    expect(fresh.connectionsPurchased).toBe(5);
    expect(await ConnectionTransaction.countDocuments({ user: user._id, type: 'purchase' })).toBe(1);

    const history = await agent.get('/api/payments/mine');
    expect(history.body.items[0].status).toBe('verified');
  });

  it('validates manual payment details', async () => {
    const { agent } = await userWithAgent();
    const badNumber = await agent
      .post('/api/payments')
      .send({ packageId: starter._id.toString(), method: 'nagad', senderNumber: '123', trxId: 'GOODTRX1' });
    expect(badNumber.status).toBe(400);
    const badTrx = await agent
      .post('/api/payments')
      .send({ packageId: starter._id.toString(), method: 'nagad', senderNumber: '01812345678', trxId: 'x' });
    expect(badTrx.status).toBe(400);
    const gateway = await agent
      .post('/api/payments')
      .send({ packageId: starter._id.toString(), method: 'bkash', mode: 'gateway' });
    expect(gateway.status).toBe(400);
    expect(gateway.body.error.code).toBe('GATEWAY_UNAVAILABLE');
  });

  it('unlocks a contact once, charging exactly one connection even on concurrent clicks', async () => {
    const { biodata, sections } = await approvedBiodata({ index: 1 });
    const { agent, user } = await userWithAgent({ balance: 2 });

    const before = await agent.get(`/api/biodatas/${biodata.biodataNo}/viewer`);
    expect(before.body).toMatchObject({ unlocked: false, contact: null, balance: 2 });

    const results = await Promise.all(
      [1, 2, 3].map(() => agent.post(`/api/biodatas/${biodata.biodataNo}/unlock`)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.charged)).toHaveLength(1);
    expect(results[0].body.contact.guardianPhone).toBe(sections.contact.guardianPhone);

    const fresh = await User.findById(user._id);
    expect(fresh.connectionBalance).toBe(1);
    expect(fresh.connectionsUsed).toBe(1);

    const after = await agent.get(`/api/biodatas/${biodata.biodataNo}/viewer`);
    expect(after.body.unlocked).toBe(true);
    expect(after.body.contact.candidateName).toBe(sections.contact.candidateName);

    const unlocks = await agent.get('/api/me/unlocks');
    expect(unlocks.body.items[0].contact.guardianPhone).toBe(sections.contact.guardianPhone);

    const ledger = await agent.get('/api/me/connections');
    expect(ledger.body.balance).toBe(1);
    expect(ledger.body.ledger.items[0]).toMatchObject({
      type: 'unlock',
      delta: -1,
      balanceAfter: 1,
      biodataNo: biodata.biodataNo,
    });
  });

  it('cannot unlock your own biodata', async () => {
    const { user, biodata } = await approvedBiodata({ index: 2 });
    user.connectionBalance = 3;
    await user.save();
    const { login } = await import('./helpers.js');
    const owner = await login(user);
    const res = await owner.post(`/api/biodatas/${biodata.biodataNo}/unlock`);
    expect(res.status).toBe(400);
  });

  it('lets a super admin grant, revoke and refund connections with an audit trail', async () => {
    const { user } = await userWithAgent();
    const { agent: admin } = await userWithAgent({ role: 'super_admin' });
    const grant = await admin
      .post('/api/admin/connections/adjust')
      .send({ user: user.email, action: 'grant', quantity: 4, reason: 'Compensation for a wrong number' });
    expect(grant.status).toBe(200);
    expect(grant.body.balance).toBe(4);
    const revokeTooMany = await admin
      .post('/api/admin/connections/adjust')
      .send({ user: user._id.toString(), action: 'revoke', quantity: 9, reason: 'Test' });
    expect(revokeTooMany.status).toBe(402);
    const revoke = await admin
      .post('/api/admin/connections/adjust')
      .send({ user: user._id.toString(), action: 'revoke', quantity: 1, reason: 'Granted by mistake' });
    expect(revoke.body.balance).toBe(3);
    const ledger = await admin.get(`/api/admin/connections/ledger?user=${user.email}`);
    expect(ledger.body.items.map((t) => t.type)).toEqual(['admin_revoke', 'admin_grant']);
    const audit = await admin.get('/api/admin/audit-logs?action=connections');
    expect(audit.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('handles refunds as connection credit or money back', async () => {
    const { agent, user } = await userWithAgent();
    const { agent: admin } = await userWithAgent({ role: 'super_admin' });

    // A payment the team could not verify, later refunded as credit.
    const p1 = await manualPayment(agent, { pkg: starter });
    await admin
      .post(`/api/admin/payments/${p1.body.payment.id}/reject`)
      .send({ reason: 'Transaction ID not found' });
    const r1 = await agent
      .post('/api/refunds')
      .send({ paymentId: p1.body.payment.id, reason: 'I did pay, here is my statement.' });
    expect(r1.status).toBe(201);
    const list = await admin.get('/api/admin/refunds?status=pending');
    const item = list.body.items.find((r) => r.id === r1.body.refund.id);
    const ok = await admin
      .post(`/api/admin/refunds/${item.id}/approve`)
      .send({ resolution: 'connection_credit' });
    expect(ok.status).toBe(200);
    expect((await User.findById(user._id)).connectionBalance).toBe(3);

    // A verified payment refunded with money back takes its connections back.
    const p2 = await manualPayment(agent, { pkg: standard });
    await admin.post(`/api/admin/payments/${p2.body.payment.id}/verify`);
    expect((await User.findById(user._id)).connectionBalance).toBe(8);
    const r2 = await agent
      .post('/api/refunds')
      .send({ paymentId: p2.body.payment.id, reason: 'Bought the wrong package by mistake.' });
    const ok2 = await admin
      .post(`/api/admin/refunds/${r2.body.refund.id}/approve`)
      .send({ resolution: 'money_back', refundTrxId: 'RFND123' });
    expect(ok2.status).toBe(200);
    expect((await User.findById(user._id)).connectionBalance).toBe(3);
    const mine = await agent.get('/api/payments/mine');
    expect(mine.body.items.find((p) => p.id === p2.body.payment.id).status).toBe('refunded');
  });

  it('enforces roles: users and support staff cannot touch money', async () => {
    const { agent: user } = await userWithAgent();
    const { agent: support } = await userWithAgent({ role: 'support' });
    expect((await user.get('/api/admin/overview')).status).toBe(403);
    expect((await support.get('/api/admin/overview')).status).toBe(200);
    expect((await support.get('/api/admin/overview')).body.kpis.pendingPayments).toBeUndefined();
    expect((await support.get('/api/admin/payments')).status).toBe(403);
    expect(
      (
        await support
          .post('/api/admin/connections/adjust')
          .send({ user: 'x', action: 'grant', quantity: 1, reason: 'abc' })
      ).status,
    ).toBe(403);
    expect((await support.get('/api/admin/analytics')).status).toBe(403);
    expect((await support.get('/api/admin/biodatas')).status).toBe(200);
  });

  it('manages packages and settings as a super admin', async () => {
    const { agent: admin } = await userWithAgent({ role: 'super_admin' });
    const created = await admin
      .post('/api/admin/packages')
      .send({ name: { en: 'Premium', bn: 'প্রিমিয়াম' }, connections: 10, price: 900 });
    expect(created.status).toBe(201);
    expect(created.body.package.perConnection).toBe(90);
    const upd = await admin.patch(`/api/admin/packages/${created.body.package.id}`).send({ isActive: false });
    expect(upd.body.package.isActive).toBe(false);
    const pub = await admin.get('/api/packages');
    expect(pub.body.packages.find((p) => p.id === created.body.package.id)).toBeUndefined();

    const s = await admin
      .put('/api/admin/settings/payments')
      .send({ value: { bkash: { manualNumber: '01700000001' }, rocket: { enabled: false } } });
    expect(s.status).toBe(200);
    const methods = (await admin.get('/api/packages')).body.methods;
    expect(methods.find((m) => m.value === 'bkash').manualNumber).toBe('01700000001');
    expect(methods.find((m) => m.value === 'rocket').enabled).toBe(false);
    const { agent } = await userWithAgent();
    const rocket = await agent.post('/api/payments').send({
      packageId: starter._id.toString(),
      method: 'rocket',
      senderNumber: '01812345678',
      trxId: 'ROCKET123',
    });
    expect(rocket.status).toBe(400);
    expect(rocket.body.error.code).toBe('METHOD_DISABLED');
  });
});
