import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, approvedBiodata, login, userWithAgent } from './helpers.js';
import { models } from '../index.js';

const { MarriageReport } = models;

const PREVIEW = 'https://i.ibb.co/abc123/simple-wedding-preview.png';
const DESIGN = 'https://i.ibb.co/def456/simple-wedding.png';

describe('wedding banners', () => {
  it('lets admins publish an ImgBB banner that visitors download and count', async () => {
    const { agent: admin } = await userWithAgent({ role: 'admin' });

    const offsite = await admin.post('/api/admin/banners').send({
      title: { en: 'Elsewhere' },
      imageUrl: 'https://example.com/banner.png',
    });
    expect(offsite.status).toBe(400);
    expect(offsite.body.error.details.fields.imageUrl).toBeTruthy();
    const plainHttp = await admin.post('/api/admin/banners').send({
      title: { en: 'Insecure' },
      imageUrl: 'http://i.ibb.co/abc/banner.png',
    });
    expect(plainHttp.status).toBe(400);

    const created = await admin.post('/api/admin/banners').send({
      title: { en: 'Simple wedding', bn: 'সাদামাটা বিয়ে' },
      imageUrl: PREVIEW,
      downloadUrl: DESIGN,
    });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/public/banners');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ imageUrl: PREVIEW, downloads: 0 });
    expect(list.body.items[0]).not.toHaveProperty('downloadUrl');

    const dl = await request(app).post(`/api/public/banners/${created.body.banner.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.body.url).toBe(DESIGN);
    expect((await request(app).get('/api/public/banners')).body.items[0].downloads).toBe(1);

    // Only a preview: the download is the same image.
    const single = await admin
      .post('/api/admin/banners')
      .send({ title: { en: 'One image' }, imageUrl: PREVIEW, sortOrder: 2 });
    expect(single.body.banner.downloadUrl).toBe(PREVIEW);

    await admin.patch(`/api/admin/banners/${created.body.banner.id}`).send({ isActive: false });
    expect((await request(app).get('/api/public/banners')).body.items).toHaveLength(1);
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

    const { agent: admin } = await userWithAgent({ role: 'admin' });
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
