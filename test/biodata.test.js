import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, approvedBiodata, demoSections, PEOPLE, userWithAgent } from './helpers.js';

describe('biodata lifecycle', () => {
  it('saves sections as drafts, validates fields and submits only when complete', async () => {
    const { agent } = await userWithAgent();
    const sections = demoSections(PEOPLE[0], 0);

    const empty = await agent.get('/api/biodatas/me');
    expect(empty.body.biodata).toBeNull();

    // The pledge comes first.
    const noPledge = await agent.put('/api/biodatas/me/sections/general').send({ data: {} });
    expect(noPledge.body.error.code).toBe('PLEDGE_REQUIRED');
    expect((await agent.post('/api/biodatas/me').send({})).status).toBe(400);
    const started = await agent.post('/api/biodatas/me').send({ pledge: true });
    expect(started.status).toBe(201);
    expect(started.body.biodata.pledgeAcceptedAt).toBeTruthy();

    const bad = await agent
      .put('/api/biodatas/me/sections/contact')
      .send({ data: { guardianPhone: '12345' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields.guardianPhone).toBe('phone');

    const partial = await agent
      .put('/api/biodatas/me/sections/general')
      .send({ data: { biodataType: 'bride', religion: 'hindu' } });
    expect(partial.status).toBe(200);
    expect(partial.body.biodata.biodataNo).toMatch(/^GH-\d+$/);
    expect(partial.body.biodata.status).toBe('draft');

    const early = await agent.post('/api/biodatas/me/submit');
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('INCOMPLETE');

    for (const [key, data] of Object.entries(sections)) {
      const r = await agent.put(`/api/biodatas/me/sections/${key}`).send({ data });
      expect(r.status, `${key}: ${JSON.stringify(r.body)}`).toBe(200);
    }
    const ready = await agent.get('/api/biodatas/me');
    expect(ready.body.completion.complete).toBe(true);
    expect(ready.body.biodata.completion).toBe(100);

    const submitted = await agent.post('/api/biodatas/me/submit');
    expect(submitted.status).toBe(200);
    expect(submitted.body.biodata.status).toBe('pending');

    // Pending biodatas are not public.
    const pub = await request(app).get(`/api/biodatas/${submitted.body.biodata.biodataNo}`);
    expect(pub.status).toBe(404);
  });

  it('requires a verified account to create a biodata', async () => {
    const { createUser } = await import('./helpers.js');
    const { signAccessToken } = await import('../src/services/token.service.js');
    const user = await createUser({ verified: false });
    const res = await request(app)
      .post('/api/biodatas/me')
      .set('Authorization', `Bearer ${signAccessToken(user)}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_VERIFIED');
  });

  it('never exposes private fields publicly and lets reviewers approve', async () => {
    const { agent: owner } = await userWithAgent();
    await owner.post('/api/biodatas/me').send({ pledge: true });
    for (const [key, data] of Object.entries(demoSections(PEOPLE[1], 1)))
      await owner.put(`/api/biodatas/me/sections/${key}`).send({ data });
    const { body } = await owner.post('/api/biodatas/me/submit');
    const no = body.biodata.biodataNo;

    const { agent: support } = await userWithAgent({ role: 'support' });
    const list = await support.get('/api/admin/biodatas?status=pending');
    expect(list.status).toBe(200);
    const row = list.body.items.find((b) => b.biodataNo === no);
    expect(row).toBeTruthy();
    const approve = await support.post(`/api/admin/biodatas/${row.id}/approve`);
    expect(approve.status).toBe(200);

    const pub = await request(app).get(`/api/biodatas/${no}`);
    expect(pub.status).toBe(200);
    const text = JSON.stringify(pub.body);
    expect(pub.body.biodata.sections.contact).toBeUndefined();
    expect(pub.body.biodata.sections.family.fatherName).toBeUndefined();
    expect(text).not.toContain(PEOPLE[1][9]);
    expect(text).not.toMatch(/017\d{8}/);
    expect(pub.body.biodata.sections.general.religion).toBe('muslim');

    const notes = await owner.get('/api/me/notifications');
    expect(notes.body.items.map((n) => n.type)).toContain('biodata_approved');
  });

  it('sends an edited live biodata back to review', async () => {
    const { agent } = await userWithAgent();
    await agent.post('/api/biodatas/me').send({ pledge: true });
    for (const [key, data] of Object.entries(demoSections(PEOPLE[2], 2)))
      await agent.put(`/api/biodatas/me/sections/${key}`).send({ data });
    await agent.post('/api/biodatas/me/submit');
    const { user: reviewer } = await userWithAgent({ role: 'super_admin' });
    const { Biodata } = await import('../src/models/index.js');
    const b = await Biodata.findOne({ status: 'pending' }).sort({ createdAt: -1 });
    b.status = 'approved';
    b.reviewedBy = reviewer._id;
    await b.save();

    const edit = await agent
      .put('/api/biodatas/me/sections/personal')
      .send({ data: { ...demoSections(PEOPLE[2], 2).personal, hobbies: 'Painting' } });
    expect(edit.status).toBe(200);
    expect(edit.body.statusChanged).toBe(true);
    expect(edit.body.biodata.status).toBe('pending');
  });

  it('rejects with a reason the owner can read', async () => {
    const { biodata, user } = await approvedBiodata({ index: 3, status: 'pending' });
    const { agent: admin } = await userWithAgent({ role: 'super_admin' });
    const res = await admin
      .post(`/api/admin/biodatas/${biodata._id}/reject`)
      .send({ reason: 'Please add your SSC details.' });
    expect(res.status).toBe(200);
    const { login } = await import('./helpers.js');
    const owner = await login(user);
    const me = await owner.get('/api/biodatas/me');
    expect(me.body.biodata.status).toBe('rejected');
    expect(me.body.biodata.rejectionReason).toBe('Please add your SSC details.');
  });

  it('searches with filters, sorting and pagination', async () => {
    await approvedBiodata({ index: 0 }); // bride, hindu, 26, dhaka
    await approvedBiodata({ index: 1 }); // groom, muslim, 31, chattogram
    await approvedBiodata({ index: 2 }); // bride, christian, 29, sylhet
    await approvedBiodata({ index: 4, status: 'pending' }); // not public

    const brides = await request(app).get('/api/biodatas?type=bride');
    expect(brides.status).toBe(200);
    expect(brides.body.items.every((b) => b.type === 'bride')).toBe(true);

    const hindu = await request(app).get('/api/biodatas?religion=hindu&type=bride');
    expect(hindu.body.items.every((b) => b.religion === 'hindu')).toBe(true);
    expect(hindu.body.items.length).toBeGreaterThan(0);

    const ages = await request(app).get('/api/biodatas?ageMin=28&ageMax=32');
    expect(ages.body.items.length).toBeGreaterThan(0);
    expect(ages.body.items.every((b) => b.age >= 28 && b.age <= 32)).toBe(true);

    const district = await request(app).get('/api/biodatas?district=sylhet');
    expect(district.body.items.every((b) => b.district === 'sylhet')).toBe(true);

    const sorted = await request(app).get('/api/biodatas?sort=age_asc&limit=50');
    const list = sorted.body.items.map((b) => b.age);
    expect(list).toEqual([...list].sort((a, b) => a - b));

    const paged = await request(app).get('/api/biodatas?limit=1&page=2');
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.page).toBe(2);

    const injection = await request(app).get('/api/biodatas?religion[$ne]=x&q=.*');
    expect(injection.status).toBe(200);
  });

  it('hides, soft-deletes and restores through the recovery queue', async () => {
    const { user, biodata } = await approvedBiodata({ index: 5 });
    const { login } = await import('./helpers.js');
    const owner = await login(user);
    const no = biodata.biodataNo;

    expect((await owner.patch('/api/biodatas/me/visibility').send({ hidden: true })).status).toBe(400);
    const hidden = await owner
      .patch('/api/biodatas/me/visibility')
      .send({ hidden: true, reason: 'in_talks' });
    expect(hidden.body.biodata.hideReason).toBe('in_talks');
    expect((await request(app).get(`/api/biodatas/${no}`)).status).toBe(404);
    await owner.patch('/api/biodatas/me/visibility').send({ hidden: false });
    expect((await request(app).get(`/api/biodatas/${no}`)).status).toBe(200);

    const del = await owner.delete('/api/biodatas/me').send({ reason: 'married_via_ghotok' });
    expect(del.status).toBe(200);
    expect(del.body.biodata.deletedAt).toBeTruthy();
    expect((await request(app).get(`/api/biodatas/${no}`)).status).toBe(404);
    expect((await owner.put('/api/biodatas/me/sections/personal').send({ data: {} })).status).toBe(409);

    const req1 = await owner.post('/api/biodatas/me/restore-request').send({ reason: 'Looking again' });
    expect(req1.status).toBe(201);
    expect((await owner.post('/api/biodatas/me/restore-request').send({})).status).toBe(409);

    const { agent: support } = await userWithAgent({ role: 'support' });
    const queue = await support.get('/api/admin/restore-requests?status=pending');
    const item = queue.body.items.find((r) => r.biodata.biodataNo === no);
    expect(item).toBeTruthy();
    expect((await support.post(`/api/admin/restore-requests/${item.id}/approve`)).status).toBe(200);
    expect((await request(app).get(`/api/biodatas/${no}`)).status).toBe(200);

    const stats = await request(app).get('/api/public/stats');
    expect(stats.body.biodatas).toBeGreaterThan(0);
  });

  it('counts one visit per viewer per day and never the owner', async () => {
    const { user, biodata } = await approvedBiodata({ index: 6 });
    const visitor = request.agent(app);
    const first = await visitor.post(`/api/biodatas/${biodata.biodataNo}/visit`);
    expect(first.body.counted).toBe(true);
    const again = await visitor.post(`/api/biodatas/${biodata.biodataNo}/visit`);
    expect(again.body.counted).toBe(false);
    const { login } = await import('./helpers.js');
    const owner = await login(user);
    expect((await owner.post(`/api/biodatas/${biodata.biodataNo}/visit`)).body.counted).toBe(false);
    const stats = await owner.get('/api/biodatas/me/stats');
    expect(stats.body.visits).toEqual({ today: 1, week: 1, month: 1 });
  });
});
