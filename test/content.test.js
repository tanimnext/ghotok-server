import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MarriageReport } from '../src/models/index.js';
import { app, approvedBiodata, login, userWithAgent } from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

async function upload(admin, kind, contentType, body) {
  const target = await admin
    .post('/api/admin/banners/upload-url')
    .send({ kind, contentType, size: body.length });
  expect(target.status, JSON.stringify(target.body)).toBe(200);
  const put = await request(app).put(target.body.uploadURL).set('Content-Type', contentType).send(body);
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  return target.body.ticket;
}

describe('wedding banners', () => {
  it('lets staff publish a PDF banner that visitors download and count', async () => {
    const { agent: admin } = await userWithAgent({ role: 'super_admin' });

    const wrong = await admin
      .post('/api/admin/banners/upload-url')
      .send({ kind: 'file', contentType: 'image/png', size: 10 });
    expect(wrong.status).toBe(400);
    // A PDF upload target refuses an image.
    const pdfTarget = await admin
      .post('/api/admin/banners/upload-url')
      .send({ kind: 'file', contentType: 'application/pdf', size: 10 });
    expect(
      (await request(app).put(pdfTarget.body.uploadURL).set('Content-Type', 'image/png').send(PNG)).status,
    ).toBe(400);

    const previewTicket = await upload(admin, 'preview', 'image/png', PNG);
    const fileTicket = await upload(admin, 'file', 'application/pdf', PDF);
    const created = await admin.post('/api/admin/banners').send({
      title: { en: 'Simple wedding', bn: 'সাদামাটা বিয়ে' },
      fileName: 'simple-wedding.pdf',
      previewTicket,
      fileTicket,
    });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/public/banners');
    expect(list.body.items).toHaveLength(1);
    expect((await request(app).get(list.body.items[0].previewUrl)).headers['content-type']).toBe('image/png');

    const dl = await request(app).post(`/api/public/banners/${created.body.banner.id}/download`);
    expect(dl.status).toBe(200);
    const file = await request(app).get(dl.body.url);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toContain('simple-wedding.pdf');
    expect((await request(app).get('/api/public/banners')).body.items[0].downloads).toBe(1);

    await admin.patch(`/api/admin/banners/${created.body.banner.id}`).send({ isActive: false });
    expect((await request(app).get('/api/public/banners')).body.items).toHaveLength(0);
    expect((await request(app).post(`/api/public/banners/${created.body.banner.id}/download`)).status).toBe(
      404,
    );

    const { agent: member } = await userWithAgent();
    expect((await member.get('/api/admin/banners')).status).toBe(403);
  });
});

describe('success stories', () => {
  it('publishes a story only with the member’s consent', async () => {
    const { user, biodata } = await approvedBiodata({ index: 11 });
    const owner = await login(user);
    await owner.delete('/api/biodatas/me').send({
      reason: 'married_via_ghotok',
      marriage: {
        marriedOn: '2026-08-01',
        story: 'We met on Ghotok and our families agreed within a month.',
        shareStory: true,
      },
    });
    const other = await approvedBiodata({ index: 12 });
    const otherOwner = await login(other.user);
    await otherOwner.delete('/api/biodatas/me').send({
      reason: 'married_elsewhere',
      marriage: { story: 'Private story', shareStory: false },
    });

    const { agent: admin } = await userWithAgent({ role: 'super_admin' });
    const pending = await admin.get('/api/admin/marriage-reports?status=pending');
    expect(pending.body.items).toHaveLength(2);
    const shared = pending.body.items.find((r) => r.biodataNo === biodata.biodataNo);
    const privateOne = pending.body.items.find((r) => r.biodataNo === other.biodata.biodataNo);

    expect(
      (await admin.patch(`/api/admin/marriage-reports/${privateOne.id}`).send({ storyStatus: 'published' }))
        .body.error.code,
    ).toBe('NO_CONSENT');
    const published = await admin.patch(`/api/admin/marriage-reports/${shared.id}`).send({
      storyStatus: 'published',
      publishedStory: 'We met on Ghotok; our families agreed within a month.',
    });
    expect(published.status).toBe(200);

    const stories = await request(app).get('/api/public/success-stories');
    expect(stories.body.items).toEqual([
      {
        id: shared.id,
        story: 'We met on Ghotok; our families agreed within a month.',
        marriedOn: '2026-08',
        viaGhotok: true,
        districts: [biodata.district],
      },
    ]);
    expect(await MarriageReport.countDocuments({ storyStatus: 'published' })).toBe(1);
  });
});
