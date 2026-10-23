import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app, approvedBiodata, login, userWithAgent } from './helpers.js';
import { models, sslcommerzIntegration } from '../index.js';

const { sslcommerz } = sslcommerzIntegration;
const { ConnectionTransaction, Package, Payment, Setting, User } = models;

afterEach(() => vi.restoreAllMocks());

const json = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/**
 * Turns SSLCommerz on and fakes its two APIs: session creation always succeeds, and the
 * validation API answers with `validation(invoiceNo)` for the invoice it was asked about.
 */
function mockSslcommerz(validation) {
  vi.spyOn(sslcommerz, 'enabled', 'get').mockReturnValue(true);
  const calls = [];
  const invoiceOf = new Map(); // val_id → invoice, as SSLCommerz would know it
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const href = String(url);
    calls.push({ url: href, body: init?.body ? String(init.body) : null });
    if (href.includes('/gwprocess/v4/api.php')) {
      const invoice = decodeURIComponent(String(init.body).match(/tran_id=([^&]+)/)[1]);
      invoiceOf.set(`V-${invoice}`, invoice);
      return json({ status: 'SUCCESS', GatewayPageURL: `https://sandbox.sslcommerz.com/gw/${invoice}` });
    }
    const valId = new URL(href).searchParams.get('val_id');
    return json(validation(invoiceOf.get(valId), valId));
  });
  return calls;
}

const valid = (amount) => (invoice, valId) => ({
  status: 'VALID',
  tran_id: invoice,
  amount: amount.toFixed(2),
  currency: 'BDT',
  val_id: valId,
  bank_tran_id: `BT-${invoice}`,
});

const postback = (path, body) => request(app).post(`/api/gateway/sslcommerz/${path}`).type('form').send(body);

async function startCheckout(agent, pkg) {
  const res = await agent.post('/api/payments').send({ packageId: pkg._id.toString() });
  expect(res.status).toBe(201);
  return res.body.payment.invoiceNo;
}

describe('SSLCommerz checkout', () => {
  it('lists packages and says checkout is off without SSLCommerz settings (503 on buy)', async () => {
    const pkg = await Package.create({ name: { en: 'Off' }, connections: 2, price: 200 });
    const { agent } = await userWithAgent();
    const list = await agent.get('/api/packages');
    expect(list.status).toBe(200);
    expect(list.body.checkout).toEqual({ enabled: false });
    expect(list.body.methods).toBeUndefined();
    const buy = await agent.post('/api/payments').send({ packageId: pkg._id.toString() });
    expect(buy.status).toBe(503);
    expect(buy.body.error.code).toBe('PAYMENTS_UNAVAILABLE');
    expect(await Payment.countDocuments({ package: pkg._id })).toBe(0);
  });

  it('starts a hosted checkout, validates the result and credits once (return and IPN)', async () => {
    const calls = mockSslcommerz(valid(500));
    const pkg = await Package.create({ name: { en: 'Standard' }, connections: 5, price: 500 });
    const { agent, user } = await userWithAgent();
    expect((await agent.get('/api/packages')).body.checkout).toEqual({ enabled: true });

    const start = await agent.post('/api/payments').send({ packageId: pkg._id.toString() });
    expect(start.status).toBe(201);
    expect(start.body.redirectURL).toContain('sslcommerz.com');
    expect(start.body.payment).toMatchObject({ method: 'sslcommerz', amount: 500, connections: 5 });
    const { invoiceNo } = start.body.payment;
    expect(calls[0].body).toContain(`tran_id=${invoiceNo}`);
    expect(calls[0].body).toContain('total_amount=500.00');
    expect(calls[0].body).toContain('ipn_url=');

    // The customer's browser posts back from SSLCommerz's domain, and the IPN arrives too.
    const back = await request(app)
      .post('/api/gateway/sslcommerz/return')
      .set('Origin', 'https://sandbox.sslcommerz.com')
      .type('form')
      .send({ tran_id: invoiceNo, val_id: `V-${invoiceNo}`, status: 'VALID' });
    expect(back.status).toBe(303);
    expect(back.headers.location).toContain(`/dashboard/payment/${invoiceNo}?result=success`);
    const ipn = await postback('ipn', { tran_id: invoiceNo, val_id: `V-${invoiceNo}`, status: 'VALID' });
    expect(ipn.body).toEqual({ ok: true, status: 'success' });

    const fresh = await User.findById(user._id);
    expect(fresh.connectionBalance).toBe(5);
    expect(await ConnectionTransaction.countDocuments({ user: user._id, type: 'purchase' })).toBe(1);

    const receipt = await agent.get(`/api/payments/status/${invoiceNo}`);
    expect(receipt.body.payment).toMatchObject({
      status: 'verified',
      method: 'sslcommerz',
      amount: 500,
      trxId: `BT-${invoiceNo}`,
    });
    expect(receipt.body.payment.senderNumber).toBeUndefined();
    const { agent: stranger } = await userWithAgent();
    expect((await stranger.get(`/api/payments/status/${invoiceNo}`)).status).toBe(404);
  });

  it('credits exactly once when the return and the IPN arrive together or are replayed', async () => {
    mockSslcommerz(valid(300));
    const pkg = await Package.create({ name: { en: 'Starter' }, connections: 3, price: 300 });
    const { agent, user } = await userWithAgent();
    const invoiceNo = await startCheckout(agent, pkg);
    const body = { tran_id: invoiceNo, val_id: `V-${invoiceNo}`, status: 'VALID' };
    const results = await Promise.all([
      postback('return', body),
      postback('ipn', body),
      postback('ipn', body),
      postback('return', body),
    ]);
    expect(results.filter((r) => r.status === 303).every((r) => r.headers.location.includes('success'))).toBe(
      true,
    );
    expect((await User.findById(user._id)).connectionBalance).toBe(3);
    expect(await ConnectionTransaction.countDocuments({ user: user._id, type: 'purchase' })).toBe(1);
    // A replay days later changes nothing either.
    await postback('ipn', body);
    expect((await User.findById(user._id)).connectionBalance).toBe(3);
  });

  it('does not credit when the validated amount differs from the invoice', async () => {
    mockSslcommerz(valid(10));
    const pkg = await Package.create({ name: { en: 'Five' }, connections: 5, price: 500 });
    const { agent, user } = await userWithAgent();
    const invoiceNo = await startCheckout(agent, pkg);
    const back = await postback('return', { tran_id: invoiceNo, val_id: `V-${invoiceNo}`, status: 'VALID' });
    expect(back.headers.location).toContain('result=failed');
    expect((await User.findById(user._id)).connectionBalance).toBe(0);
    expect((await Payment.findOne({ invoiceNo })).status).toBe('failed');
  });

  it('marks forged, failed and cancelled results without crediting', async () => {
    mockSslcommerz(() => ({ status: 'INVALID_TRANSACTION' }));
    const pkg = await Package.create({ name: { en: 'Three' }, connections: 3, price: 300 });
    const { agent, user } = await userWithAgent();

    const forgedInvoice = await startCheckout(agent, pkg);
    const forged = await postback('return', { tran_id: forgedInvoice, val_id: 'FAKE', status: 'VALID' });
    expect(forged.headers.location).toContain('result=failed');
    expect((await Payment.findOne({ invoiceNo: forgedInvoice })).status).toBe('failed');

    const failedInvoice = await startCheckout(agent, pkg);
    const failed = await postback('return', { tran_id: failedInvoice, status: 'FAILED' });
    expect(failed.headers.location).toContain('result=failed');
    expect((await Payment.findOne({ invoiceNo: failedInvoice })).status).toBe('failed');

    const cancelledInvoice = await startCheckout(agent, pkg);
    const cancelled = await postback('return', { tran_id: cancelledInvoice, status: 'CANCELLED' });
    expect(cancelled.headers.location).toContain('result=cancelled');
    expect((await Payment.findOne({ invoiceNo: cancelledInvoice })).status).toBe('cancelled');

    expect((await User.findById(user._id)).connectionBalance).toBe(0);
    // An unknown invoice is simply a failure.
    const unknown = await postback('ipn', { tran_id: 'INV-NOPE-1', val_id: 'X', status: 'VALID' });
    expect(unknown.body).toEqual({ ok: true, status: 'failed' });
  });

  it('marks the payment failed when SSLCommerz does not start a session', async () => {
    vi.spyOn(sslcommerz, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ status: 'FAILED', failedreason: 'Store inactive' }),
    );
    const pkg = await Package.create({ name: { en: 'Down' }, connections: 1, price: 100 });
    const { agent } = await userWithAgent();
    const res = await agent.post('/api/payments').send({ packageId: pkg._id.toString() });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('GATEWAY_ERROR');
    expect(await Payment.findOne({ package: pkg._id })).toMatchObject({ status: 'failed' });
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
    expect(mine.status).toBe(200);
    expect(mine.body.items[0]).toMatchObject({
      invoiceNo: 'INV-LEGACY-1',
      method: 'bkash',
      status: 'rejected',
    });
    const { agent: admin } = await userWithAgent({ role: 'admin' });
    expect((await admin.get('/api/admin/payments?q=OLDTRX')).body.items).toHaveLength(1);
  });
});

describe('discount for approved members', () => {
  it('charges approved members the discounted price when the setting is on', async () => {
    mockSslcommerz(valid(250));
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

    const paid = await member.post('/api/payments').send({ packageId: pkg._id.toString() });
    expect(paid.body.payment.amount).toBe(250);

    // Without an approved biodata there is no discount.
    const { agent: plain } = await userWithAgent();
    expect(
      (await plain.get('/api/packages')).body.packages.find((p) => p.id === pkg.id).finalPrice,
    ).toBeUndefined();
    await Setting.deleteOne({ key: 'payments' });
  });
});
