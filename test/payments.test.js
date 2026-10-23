import { describe, expect, it } from 'vitest';
import { approvedBiodata, login, userWithAgent } from './helpers.js';
import { models } from '../index.js';

const { Package, Payment, Setting } = models;

// Checkout and crediting run on the website (ghotok-client); these cover what the API keeps:
// the catalogue, payment history, receipts and the admin list.

async function payment(user, fields = {}) {
  return Payment.create({
    invoiceNo: `INV-T-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    user: user._id,
    packageName: { en: 'Standard' },
    connections: 5,
    amount: 500,
    method: 'sslcommerz',
    status: 'verified',
    creditedAt: new Date(),
    ...fields,
  });
}

describe('payments', () => {
  it('shows a member their payments and receipts, never other members’', async () => {
    const { agent, user } = await userWithAgent();
    const paid = await payment(user, { trxId: 'BT-1' });
    await payment(user, { status: 'initiated', creditedAt: null }); // checkout not finished
    const mine = await agent.get('/api/payments/mine');
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((p) => p.invoiceNo)).toEqual([paid.invoiceNo]);

    const receipt = await agent.get(`/api/payments/status/${paid.invoiceNo}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.payment).toMatchObject({ invoiceNo: paid.invoiceNo, status: 'verified' });

    const { agent: other } = await userWithAgent();
    expect((await other.get(`/api/payments/status/${paid.invoiceNo}`)).status).toBe(404);
  });

  it('keeps older bKash/manual payments readable', async () => {
    const { agent, user } = await userWithAgent();
    await Payment.collection.insertOne({
      invoiceNo: 'INV-LEGACY-1',
      user: user._id,
      packageName: { en: 'Old' },
      connections: 3,
      amount: 300,
      method: 'bkash',
      mode: 'manual',
      senderNumber: '01712345678',
      trxId: 'OLDTRX123',
      status: 'rejected',
      rejectReason: 'Not found',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const mine = await agent.get('/api/payments/mine');
    expect(mine.body.items[0]).toMatchObject({
      invoiceNo: 'INV-LEGACY-1',
      method: 'bkash',
      status: 'rejected',
    });
    const { agent: admin } = await userWithAgent({ role: 'admin' });
    expect((await admin.get('/api/admin/payments?q=OLDTRX')).body.items).toHaveLength(1);
  });

  it('lists payments read-only for admins', async () => {
    const { user } = await userWithAgent();
    await payment(user, { trxId: 'BT-ADMIN-LIST' });
    const { agent: admin } = await userWithAgent({ role: 'admin' });
    const list = await admin.get('/api/admin/payments?q=BT-ADMIN-LIST');
    expect(list.status).toBe(200);
    expect(list.body.items[0].user).toMatchObject({ id: user._id.toString() });
  });
});

describe('discount for approved members', () => {
  it('shows approved members the discounted price when the setting is on', async () => {
    const pkg = await Package.create({ name: { en: 'Half' }, connections: 5, price: 500 });
    await Setting.findOneAndUpdate(
      { key: 'payments' },
      { value: { approvedDiscountPercent: 50 } },
      { upsert: true },
    );
    const { user } = await approvedBiodata({ index: 15 });
    const member = await login(user);
    const list = await member.get('/api/packages');
    expect(list.body.packages.find((p) => p.id === pkg.id)).toMatchObject({
      price: 500,
      discountPercent: 50,
      finalPrice: 250,
    });
    expect(list.body).not.toHaveProperty('checkout');

    const { agent: plain } = await userWithAgent();
    expect(
      (await plain.get('/api/packages')).body.packages.find((p) => p.id === pkg.id).finalPrice,
    ).toBeUndefined();
    await Setting.deleteOne({ key: 'payments' });
  });
});
