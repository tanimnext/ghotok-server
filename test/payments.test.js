import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sslcommerz } from '../src/integrations/payments/sslcommerz.js';
import { Package, Payment, Setting, User } from '../src/models/index.js';
import { app, approvedBiodata, login, userWithAgent } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

const json = (body) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('SSLCommerz checkout (fetch mocked)', () => {
  it('starts a hosted checkout, validates the result and credits once (return and IPN)', async () => {
    vi.spyOn(sslcommerz, 'enabled', 'get').mockReturnValue(true);
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : null });
      if (String(url).includes('/gwprocess/v4/api.php')) {
        return json({
          status: 'SUCCESS',
          GatewayPageURL: 'https://sandbox.sslcommerz.com/gw/abc',
          sessionkey: 'S1',
        });
      }
      const invoice = calls[0].body.match(/tran_id=([^&]+)/)[1];
      return json({
        status: 'VALID',
        tran_id: decodeURIComponent(invoice),
        amount: '500.00',
        currency: 'BDT',
        val_id: 'V1',
        bank_tran_id: 'BT1',
      });
    });

    const pkg = await Package.create({ name: { en: 'Standard' }, connections: 5, price: 500 });
    const { agent, user } = await userWithAgent();
    const manual = await agent.post('/api/payments').send({
      packageId: pkg._id.toString(),
      method: 'sslcommerz',
      mode: 'manual',
      senderNumber: '01712345678',
      trxId: 'AB12CD34EF',
    });
    expect(manual.body.error.code).toBe('METHOD_DISABLED');

    const start = await agent
      .post('/api/payments')
      .send({ packageId: pkg._id.toString(), method: 'sslcommerz', mode: 'gateway' });
    expect(start.status).toBe(201);
    expect(start.body.redirectURL).toContain('sslcommerz.com');
    const { invoiceNo } = start.body.payment;
    expect(calls[0].body).toContain(`tran_id=${invoiceNo}`);
    expect(calls[0].body).toContain('total_amount=500.00');
    expect(calls[0].body).toContain('success_url=');

    // The customer's browser posts back from SSLCommerz's domain.
    const back = await request(app)
      .post('/api/gateway/sslcommerz/return')
      .set('Origin', 'https://sandbox.sslcommerz.com')
      .type('form')
      .send({ tran_id: invoiceNo, val_id: 'V1', status: 'VALID' });
    expect(back.status).toBe(303);
    expect(back.headers.location).toContain(`/dashboard/payment/${invoiceNo}?result=success`);
    const ipn = await request(app)
      .post('/api/gateway/sslcommerz/ipn')
      .type('form')
      .send({ tran_id: invoiceNo, val_id: 'V1', status: 'VALID' });
    expect(ipn.body).toEqual({ ok: true, status: 'success' });
    expect((await User.findById(user._id)).connectionBalance).toBe(5);

    const receipt = await agent.get(`/api/payments/status/${invoiceNo}`);
    expect(receipt.body.payment).toMatchObject({ status: 'verified', method: 'sslcommerz', amount: 500 });
    const { agent: stranger } = await userWithAgent();
    expect((await stranger.get(`/api/payments/status/${invoiceNo}`)).status).toBe(404);
  });

  it('does not credit an unvalidated or cancelled payment', async () => {
    vi.spyOn(sslcommerz, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('/gwprocess/')
        ? json({ status: 'SUCCESS', GatewayPageURL: 'https://sandbox.sslcommerz.com/gw/x' })
        : json({ status: 'INVALID_TRANSACTION' }),
    );
    const pkg = await Package.create({ name: { en: 'Starter' }, connections: 3, price: 300 });
    const { agent, user } = await userWithAgent();
    const start = await agent
      .post('/api/payments')
      .send({ packageId: pkg._id.toString(), method: 'sslcommerz', mode: 'gateway' });
    const { invoiceNo } = start.body.payment;

    const forged = await request(app)
      .post('/api/gateway/sslcommerz/return')
      .type('form')
      .send({ tran_id: invoiceNo, val_id: 'FAKE', status: 'VALID' });
    expect(forged.headers.location).toContain('result=failed');
    expect((await User.findById(user._id)).connectionBalance).toBe(0);
    expect((await Payment.findOne({ invoiceNo })).status).toBe('failed');

    const other = await agent
      .post('/api/payments')
      .send({ packageId: pkg._id.toString(), method: 'sslcommerz', mode: 'gateway' });
    const cancelled = await request(app)
      .post('/api/gateway/sslcommerz/return')
      .type('form')
      .send({ tran_id: other.body.payment.invoiceNo, status: 'CANCELLED' });
    expect(cancelled.headers.location).toContain('result=cancelled');
  });
});

describe('discount for approved members', () => {
  it('charges approved members the discounted price when the setting is on', async () => {
    const pkg = await Package.create({ name: { en: 'Five' }, connections: 5, price: 500 });
    await Setting.findOneAndUpdate(
      { key: 'payments' },
      { value: { approvedDiscountPercent: 50, bkash: { enabled: true, manualNumber: '01711111111' } } },
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

    const paid = await member.post('/api/payments').send({
      packageId: pkg._id.toString(),
      method: 'bkash',
      mode: 'manual',
      senderNumber: '01712345678',
      trxId: 'DISC50A1',
    });
    expect(paid.body.payment.amount).toBe(250);

    // Without an approved biodata there is no discount.
    const { agent: plain } = await userWithAgent();
    expect(
      (await plain.get('/api/packages')).body.packages.find((p) => p.id === pkg.id).finalPrice,
    ).toBeUndefined();
    await Setting.deleteOne({ key: 'payments' });
  });
});
