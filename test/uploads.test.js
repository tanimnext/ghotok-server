import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bkash } from '../src/integrations/payments/bkash.js';
import { Package, Payment, User } from '../src/models/index.js';
import { app, approvedBiodata, login, userWithAgent } from './helpers.js';

// Smallest valid PNG (1×1).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

afterEach(() => vi.restoreAllMocks());

describe('uploads (local driver)', () => {
  it('uploads a photo, keeps it private until unlock, and verifies an NID', async () => {
    const { user, biodata } = await approvedBiodata({ index: 0 });
    const owner = await login(user);

    const url = await owner.post('/api/biodatas/me/photo/upload-url');
    expect(url.status).toBe(200);
    expect(url.body.method).toBe('PUT');
    const notImage = await request(app)
      .put(url.body.uploadURL)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('hello world'));
    expect(notImage.status).toBe(400);
    const put = await request(app).put(url.body.uploadURL).set('Content-Type', 'image/png').send(PNG);
    expect(put.status).toBe(200);
    const attach = await owner.post('/api/biodatas/me/photo').send({ ticket: url.body.ticket });
    expect(attach.status).toBe(200);
    expect(attach.body.biodata.photo.visibility).toBe('after_unlock');

    // Public card hides the photo; the owner's view can load it.
    const pub = await request(app).get(`/api/biodatas/${biodata.biodataNo}`);
    expect(pub.body.biodata.photoUrl).toBeNull();
    expect(pub.body.biodata.hasPhoto).toBe(true);
    const img = await request(app).get(attach.body.biodata.photo.url);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');

    // Someone else's ticket cannot be attached.
    const other = await approvedBiodata({ index: 1 });
    const otherAgent = await login(other.user);
    expect((await otherAgent.post('/api/biodatas/me/photo').send({ ticket: url.body.ticket })).status).toBe(
      400,
    );

    // NID front and back.
    const tickets = {};
    for (const side of ['front', 'back']) {
      const u = await owner.post('/api/biodatas/me/nid/upload-url').send({ side, contentType: 'image/png' });
      expect(u.status).toBe(200);
      await request(app).put(u.body.uploadURL).set('Content-Type', 'image/png').send(PNG).expect(200);
      tickets[side] = u.body.ticket;
    }
    const nid = await owner
      .post('/api/biodatas/me/nid')
      .send({ frontTicket: tickets.front, backTicket: tickets.back });
    expect(nid.status).toBe(200);
    expect(nid.body.biodata.nid.status).toBe('pending');

    const { agent: support } = await userWithAgent({ role: 'support' });
    const docs = await support.get(`/api/admin/biodatas/${biodata._id}/nid`);
    expect(docs.status).toBe(200);
    expect((await request(app).get(docs.body.front)).status).toBe(200);
    expect((await support.post(`/api/admin/biodatas/${biodata._id}/nid/verify`)).status).toBe(200);
    const card = await request(app).get(`/api/biodatas/${biodata.biodataNo}`);
    expect(card.body.biodata.nidVerified).toBe(true);
  });

  it('rejects tampered upload links', async () => {
    const res = await request(app)
      .put('/api/uploads/local/not-a-token')
      .set('Content-Type', 'image/png')
      .send(PNG);
    expect(res.status).toBe(403);
    expect((await request(app).get('/api/uploads/file/not-a-token')).status).toBe(403);
  });
});

describe('gateway checkout (bKash, mocked)', () => {
  it('starts checkout, credits on a successful callback and ignores replays', async () => {
    vi.spyOn(bkash, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(bkash, 'startCheckout').mockResolvedValue({
      paymentId: 'TR0011abc',
      redirectURL: 'https://sandbox.bka.sh/pay/TR0011abc',
      raw: {},
    });
    vi.spyOn(bkash, 'completeCheckout').mockResolvedValue({
      paymentId: 'TR0011abc',
      success: true,
      trxId: 'BK7X9Y',
      amount: 300,
      raw: {},
    });

    const pkg = await Package.create({ name: { en: 'Starter' }, connections: 3, price: 300 });
    const { agent, user } = await userWithAgent();
    const start = await agent
      .post('/api/payments')
      .send({ packageId: pkg._id.toString(), method: 'bkash', mode: 'gateway' });
    expect(start.status).toBe(201);
    expect(start.body.redirectURL).toContain('bka.sh');

    const cb = await request(app).get('/api/payments/bkash/callback?paymentID=TR0011abc&status=success');
    expect(cb.status).toBe(303);
    expect(cb.headers.location).toContain(
      `/dashboard/payment/${start.body.payment.invoiceNo}?result=success`,
    );
    const again = await request(app).get('/api/payments/bkash/callback?paymentID=TR0011abc&status=success');
    expect(again.headers.location).toContain('result=success');

    expect((await User.findById(user._id)).connectionBalance).toBe(3);
    const p = await Payment.findOne({ 'gateway.paymentId': 'TR0011abc' });
    expect(p).toMatchObject({ status: 'verified', trxId: 'BK7X9Y' });
  });

  it('does not credit when the paid amount does not match', async () => {
    vi.spyOn(bkash, 'enabled', 'get').mockReturnValue(true);
    vi.spyOn(bkash, 'startCheckout').mockResolvedValue({
      paymentId: 'TR0022xyz',
      redirectURL: 'https://sandbox.bka.sh/pay/x',
      raw: {},
    });
    vi.spyOn(bkash, 'completeCheckout').mockResolvedValue({
      paymentId: 'TR0022xyz',
      success: true,
      trxId: 'BK1',
      amount: 1,
      raw: {},
    });
    const pkg = await Package.create({ name: { en: 'Standard' }, connections: 5, price: 500 });
    const { agent, user } = await userWithAgent();
    await agent
      .post('/api/payments')
      .send({ packageId: pkg._id.toString(), method: 'bkash', mode: 'gateway' });
    const cb = await request(app).get('/api/payments/bkash/callback?paymentID=TR0022xyz&status=success');
    expect(cb.headers.location).toContain('result=failed');
    expect((await User.findById(user._id)).connectionBalance).toBe(0);
  });
});
