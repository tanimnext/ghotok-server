import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, approvedBiodata, login, userWithAgent } from './helpers.js';

describe('favorites, dislikes, proposals, reports and support', () => {
  it('manages favorites and dislikes, and hides disliked biodatas from search', async () => {
    const a = await approvedBiodata({ index: 0 });
    const b = await approvedBiodata({ index: 2 });
    const { agent } = await userWithAgent();

    expect((await agent.post(`/api/biodatas/${a.biodata.biodataNo}/favorite`)).status).toBe(200);
    expect((await agent.post(`/api/biodatas/${a.biodata.biodataNo}/favorite`)).status).toBe(200); // idempotent
    const favs = await agent.get('/api/me/favorites');
    expect(favs.body.items.map((x) => x.biodataNo)).toEqual([a.biodata.biodataNo]);

    // The owner sees who favorited them (anonymously when the fan has no public biodata).
    const owner = await login(a.user);
    const fm = await owner.get('/api/me/favorited-me');
    expect(fm.body.total).toBe(1);
    expect(fm.body.items[0].anonymous).toBe(true);

    await agent.post(`/api/biodatas/${b.biodata.biodataNo}/dislike`);
    const search = await agent.get('/api/biodatas?limit=48');
    expect(search.body.items.map((x) => x.biodataNo)).not.toContain(b.biodata.biodataNo);
    const anon = await request(app).get('/api/biodatas?limit=48');
    expect(anon.body.items.map((x) => x.biodataNo)).toContain(b.biodata.biodataNo);

    // Disliking a favorite moves it from one list to the other.
    await agent.post(`/api/biodatas/${a.biodata.biodataNo}/dislike`);
    expect((await agent.get('/api/me/favorites')).body.total).toBe(0);
    expect((await agent.get('/api/me/dislikes')).body.total).toBe(2);
    await agent.delete(`/api/biodatas/${b.biodata.biodataNo}/dislike`);
    expect((await agent.get('/api/me/dislikes')).body.total).toBe(1);
  });

  it('sends, answers and withdraws proposals with notifications', async () => {
    const target = await approvedBiodata({ index: 1 });
    const sender = await approvedBiodata({ index: 0 });
    const s = await login(sender.user);
    const t = await login(target.user);

    const sent = await s
      .post(`/api/biodatas/${target.biodata.biodataNo}/proposals`)
      .send({ message: 'We would love to talk.' });
    expect(sent.status).toBe(201);
    expect((await s.post(`/api/biodatas/${target.biodata.biodataNo}/proposals`).send({})).status).toBe(409);

    const inbox = await t.get('/api/me/proposals?box=received');
    expect(inbox.body.items[0]).toMatchObject({ status: 'pending', message: 'We would love to talk.' });
    expect(inbox.body.items[0].biodata.biodataNo).toBe(sender.biodata.biodataNo);
    expect((await t.get('/api/me/notifications')).body.unread).toBeGreaterThan(0);

    const viewer = await t.get(`/api/biodatas/${sender.biodata.biodataNo}/viewer`);
    expect(viewer.body.proposal).toMatchObject({ direction: 'received', status: 'pending' });

    const accept = await t
      .post(`/api/me/proposals/${inbox.body.items[0].id}/respond`)
      .send({ action: 'accept' });
    expect(accept.body.status).toBe('accepted');
    const outbox = await s.get('/api/me/proposals?box=sent');
    expect(outbox.body.items[0].status).toBe('accepted');
    expect((await s.get('/api/me/notifications')).body.items.map((n) => n.type)).toContain(
      'proposal_accepted',
    );
    expect((await s.post(`/api/me/proposals/${inbox.body.items[0].id}/withdraw`)).status).toBe(409);

    const dash = await s.get('/api/me/dashboard');
    expect(dash.body.counts.sentProposals).toBe(1);
    expect(dash.body.recentProposals[0]).toMatchObject({
      direction: 'sent',
      status: 'accepted',
      biodataNo: target.biodata.biodataNo,
    });
    expect(dash.body.biodata.biodataNo).toBe(sender.biodata.biodataNo);
  });

  it('accepts reports once and lets staff resolve them', async () => {
    const target = await approvedBiodata({ index: 3 });
    const { agent } = await userWithAgent();
    const r = await agent
      .post(`/api/biodatas/${target.biodata.biodataNo}/report`)
      .send({ reason: 'fake_info', details: 'Photos are of someone else.' });
    expect(r.status).toBe(201);
    expect(
      (await agent.post(`/api/biodatas/${target.biodata.biodataNo}/report`).send({ reason: 'fake_info' }))
        .status,
    ).toBe(409);

    const { agent: support } = await userWithAgent({ role: 'support' });
    const list = await support.get('/api/admin/reports?status=active');
    const item = list.body.items.find((x) => x.biodata?.biodataNo === target.biodata.biodataNo);
    expect(item).toMatchObject({ reason: 'fake_info', status: 'open' });
    const block = await support
      .post(`/api/admin/biodatas/${item.biodata.id}/block`)
      .send({ blocked: true, reason: 'Under investigation' });
    expect(block.status).toBe(200);
    expect((await request(app).get(`/api/biodatas/${target.biodata.biodataNo}`)).status).toBe(404);
    const done = await support
      .patch(`/api/admin/reports/${item.id}`)
      .send({ status: 'resolved', actionTaken: 'Biodata hidden' });
    expect(done.status).toBe(200);
  });

  it('runs support tickets between users and staff', async () => {
    const { agent } = await userWithAgent();
    const created = await agent.post('/api/tickets').send({
      subject: 'Cannot upload photo',
      category: 'biodata',
      message: 'The upload button does nothing.',
    });
    expect(created.status).toBe(201);
    const id = created.body.ticket.id;

    const { agent: support } = await userWithAgent({ role: 'support' });
    const reply = await support
      .post(`/api/admin/tickets/${id}/messages`)
      .send({ message: 'Please try a JPG under 5 MB.' });
    expect(reply.status).toBe(200);
    expect(reply.body.ticket.status).toBe('answered');

    const listed = await agent.get('/api/tickets');
    expect(listed.body.items[0].hasNewReply).toBe(true);
    const thread = await agent.get(`/api/tickets/${id}`);
    expect(thread.body.ticket.messages).toHaveLength(2);
    expect((await agent.get('/api/tickets')).body.items[0].hasNewReply).toBe(false);
    expect(thread.body.ticket.messages[1]).toMatchObject({ staff: true, author: { name: 'Ghotok support' } });
    const follow = await agent.post(`/api/tickets/${id}/messages`).send({ message: 'That worked, thanks!' });
    expect(follow.body.ticket.status).toBe('waiting');
    await agent.post(`/api/tickets/${id}/close`);
    // Writing to a closed ticket reopens it for support.
    const reopened = await agent.post(`/api/tickets/${id}/messages`).send({ message: 'One more thing' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.ticket.status).toBe('waiting');
    expect((await agent.post(`/api/tickets/${id}/messages`).send({ message: '' })).status).toBe(400);

    const contact = await request(app)
      .post('/api/contact')
      .send({ name: 'Visitor', email: 'v@example.com', message: 'How do I create a biodata for my son?' });
    expect(contact.status).toBe(201);
    const msgs = await support.get('/api/admin/contact-messages');
    expect(msgs.body.items[0]).not.toHaveProperty('ip');
  });

  it('lets a super admin change roles and suspend users (blocking their biodata)', async () => {
    const target = await approvedBiodata({ index: 4 });
    const { agent: admin, user: me } = await userWithAgent({ role: 'super_admin' });
    const sus = await admin
      .patch(`/api/admin/users/${target.user._id}`)
      .send({ status: 'suspended', statusReason: 'Fraud report' });
    expect(sus.status).toBe(200);
    expect((await request(app).get(`/api/biodatas/${target.biodata.biodataNo}`)).status).toBe(404);
    expect((await admin.patch(`/api/admin/users/${me._id}`).send({ role: 'user' })).status).toBe(403);

    const staff = await admin.post('/api/admin/users').send({
      name: 'New Reviewer',
      email: 'reviewer@example.com',
      password: 'Reviewer123',
      role: 'support',
    });
    expect(staff.status).toBe(201);
    const { agent: support } = await userWithAgent({ role: 'support' });
    expect(
      (await support.patch(`/api/admin/users/${target.user._id}`).send({ status: 'active' })).status,
    ).toBe(403);
    const detail = await support.get(`/api/admin/users/${target.user._id}`);
    expect(detail.body.biodata.biodataNo).toBe(target.biodata.biodataNo);
  });

  it('serves CMS pages, FAQs and site settings', async () => {
    const { agent: admin } = await userWithAgent({ role: 'super_admin' });
    await admin
      .put('/api/admin/pages/privacy-policy')
      .send({ title: { en: 'Privacy', bn: 'গোপনীয়তা' }, body: { en: 'Body', bn: 'বিবরণ' } });
    const page = await request(app).get('/api/public/pages/privacy-policy');
    expect(page.body.page.title.bn).toBe('গোপনীয়তা');
    const faq = await admin
      .post('/api/admin/faqs')
      .send({ question: { en: 'Q?', bn: 'প্রশ্ন?' }, answer: { en: 'A', bn: 'উ' } });
    expect(faq.status).toBe(201);
    await admin.patch(`/api/admin/faqs/${faq.body.faq._id}`).send({ sortOrder: 5 });
    const faqs = await request(app).get('/api/public/faqs');
    expect(faqs.body.items[0].question.en).toBe('Q?');
    const settings = await request(app).get('/api/public/settings');
    expect(settings.body.site.name).toBe('Ghotok');
  });

  it('returns analytics series for super admins', async () => {
    await approvedBiodata({ index: 5 });
    const { agent: admin } = await userWithAgent({ role: 'super_admin' });
    const res = await admin.get('/api/admin/analytics?days=7');
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(7);
    expect(res.body.breakdowns.type.length).toBeGreaterThan(0);
  });
});
