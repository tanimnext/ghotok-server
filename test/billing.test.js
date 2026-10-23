import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, approvedBiodata, userWithAgent } from './helpers.js';
import { connectionService, models } from '../index.js';

const { Package, Payment, User } = models;

let standard;
let starter;

beforeAll(async () => {
  starter = await Package.create({ name: { en: 'Starter' }, connections: 3, price: 300, sortOrder: 1 });
  standard = await Package.create({ name: { en: 'Standard' }, connections: 5, price: 500, sortOrder: 2 });
});

/** A package bought through SSLCommerz, as ghotok-client's checkout records and credits it. */
async function paidPayment(user, pkg = standard) {
  const invoiceNo = `INV-TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const payment = await Payment.create({
    invoiceNo,
    user: user._id,
    package: pkg._id,
    packageName: pkg.name,
    connections: pkg.connections,
    amount: pkg.price,
    method: 'sslcommerz',
    status: 'verified',
    trxId: `BT${invoiceNo}`,
    creditedAt: new Date(),
  });
  await connectionService.changeBalance(user._id, pkg.connections, {
    type: 'purchase',
    payment: payment._id,
    reason: invoiceNo,
  });
  return payment;
}

describe('connections and payments', () => {
  it('lists active packages in order', async () => {
    const { agent } = await userWithAgent();
    const res = await agent.get('/api/packages');
    expect(res.status).toBe(200);
    expect(res.body.packages.map((p) => [p.connections, p.price])).toEqual([
      [3, 300],
      [5, 500],
    ]);
    expect(res.body).not.toHaveProperty('checkout');
  });

  it('refuses to unlock a contact without a balance', async () => {
    const { biodata } = await approvedBiodata({ index: 0 });
    const { agent } = await userWithAgent();
    const res = await agent.post(`/api/biodatas/${biodata.biodataNo}/unlock`);
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CONNECTIONS');
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
    const { agent: admin } = await userWithAgent({ role: 'admin' });
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
    const { agent: admin } = await userWithAgent({ role: 'admin' });

    // Paid twice by mistake: the second payment is refunded as connection credit.
    const p1 = await paidPayment(user, starter);
    expect((await User.findById(user._id)).connectionBalance).toBe(3);
    const r1 = await agent
      .post('/api/refunds')
      .send({ paymentId: p1._id.toString(), reason: 'I was charged twice for the same package.' });
    expect(r1.status).toBe(201);
    const list = await admin.get('/api/admin/refunds?status=pending');
    const item = list.body.items.find((r) => r.id === r1.body.refund.id);
    const ok = await admin
      .post(`/api/admin/refunds/${item.id}/approve`)
      .send({ resolution: 'connection_credit', connections: 2 });
    expect(ok.status).toBe(200);
    expect((await User.findById(user._id)).connectionBalance).toBe(5);

    // Money back (refunded in the SSLCommerz panel) takes the purchased connections back.
    const p2 = await paidPayment(user, standard);
    expect((await User.findById(user._id)).connectionBalance).toBe(10);
    const r2 = await agent
      .post('/api/refunds')
      .send({ paymentId: p2._id.toString(), reason: 'Bought the wrong package by mistake.' });
    const ok2 = await admin
      .post(`/api/admin/refunds/${r2.body.refund.id}/approve`)
      .send({ resolution: 'money_back', refundTrxId: 'SSLRFND123' });
    expect(ok2.status).toBe(200);
    expect((await User.findById(user._id)).connectionBalance).toBe(5);
    const mine = await agent.get('/api/payments/mine');
    expect(mine.body.items.find((p) => p.id === p2._id.toString()).status).toBe('refunded');

    // Admins only see payments; SSLCommerz decides whether one succeeded.
    const payments = await admin.get(`/api/admin/payments?q=${p2.invoiceNo}`);
    expect(payments.body.items[0]).toMatchObject({ invoiceNo: p2.invoiceNo, method: 'sslcommerz' });
    expect((await admin.post(`/api/admin/payments/${p2._id}/verify`)).status).toBe(404);
  });

  it('keeps every admin route for admins: members get 403, visitors 401', async () => {
    const { agent: member } = await userWithAgent();
    const { agent: admin } = await userWithAgent({ role: 'admin' });
    expect((await request(app).get('/api/admin/overview')).status).toBe(401);
    for (const path of ['/api/admin/overview', '/api/admin/payments', '/api/admin/analytics']) {
      expect((await member.get(path)).status).toBe(403);
      expect((await admin.get(path)).status).toBe(200);
    }
    expect(
      (
        await member
          .post('/api/admin/connections/adjust')
          .send({ user: 'x', action: 'grant', quantity: 1, reason: 'abc' })
      ).status,
    ).toBe(403);
    const overview = (await admin.get('/api/admin/overview')).body;
    expect(overview.kpis.pendingRefunds).toBeTypeOf('number');
    expect(overview.kpis.pendingPayments).toBeUndefined();
  });

  it('manages packages and settings as an admin', async () => {
    const { agent: admin } = await userWithAgent({ role: 'admin' });
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
      .send({ value: { approvalGift: 2, approvedDiscountPercent: 10 } });
    expect(s.status).toBe(200);
    const settings = await request(app).get('/api/public/settings');
    expect(settings.body.payments).toEqual({
      approvalGift: 2,
      approvedDiscountPercent: 10,
    });
  });
});
