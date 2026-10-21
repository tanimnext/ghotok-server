import { describe, expect, it } from 'vitest';
import { Biodata, ConnectionTransaction, MarriageReport, User } from '../src/models/index.js';
import { approvedBiodata, demoSections, login, PEOPLE, userWithAgent } from './helpers.js';

async function submittedBiodata(index) {
  const { user, agent } = await userWithAgent();
  await agent.post('/api/biodatas/me').send({ pledge: true });
  for (const [key, data] of Object.entries(demoSections(PEOPLE[index], index)))
    await agent.put(`/api/biodatas/me/sections/${key}`).send({ data });
  const { body } = await agent.post('/api/biodatas/me/submit');
  return { user, agent, biodata: body.biodata };
}

describe('review corrections and the approval gift', () => {
  it('flags answers to correct, blocks resubmission until they change, then gifts a connection once', async () => {
    const { user, agent, biodata } = await submittedBiodata(6);
    const { agent: reviewer } = await userWithAgent({ role: 'support' });

    const bad = await reviewer
      .post(`/api/admin/biodatas/${biodata.id}/reject`)
      .send({ reason: 'Please fix two answers.', corrections: [{ section: 'general', field: 'nope' }] });
    expect(bad.status).toBe(400);

    const rejected = await reviewer.post(`/api/admin/biodatas/${biodata.id}/reject`).send({
      reason: 'Please fix two answers.',
      corrections: [
        { section: 'personal', field: 'aboutMe', note: 'Write a little more about yourself.' },
        { section: 'education', field: 'institution' },
      ],
    });
    expect(rejected.status).toBe(200);

    const mine = await agent.get('/api/biodatas/me');
    expect(mine.body.biodata.status).toBe('rejected');
    const original = demoSections(PEOPLE[6], 6);
    expect(mine.body.biodata.corrections).toEqual([
      {
        section: 'personal',
        field: 'aboutMe',
        note: 'Write a little more about yourself.',
        previous: original.personal.aboutMe,
        changed: false,
      },
      {
        section: 'education',
        field: 'institution',
        note: null,
        previous: original.education.institution,
        changed: false,
      },
    ]);

    const blocked = await agent.post('/api/biodatas/me/submit');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CORRECTIONS_PENDING');
    expect(blocked.body.error.details.fields).toHaveLength(2);

    const sections = demoSections(PEOPLE[6], 6);
    await agent.put('/api/biodatas/me/sections/personal').send({
      data: {
        ...sections.personal,
        aboutMe: `${sections.personal.aboutMe} I also enjoy gardening with my family.`,
      },
    });
    await agent
      .put('/api/biodatas/me/sections/education')
      .send({ data: { ...sections.education, institution: 'University of Dhaka' } });
    const after = await agent.get('/api/biodatas/me');
    expect(after.body.biodata.corrections.every((c) => c.changed)).toBe(true);
    expect((await agent.post('/api/biodatas/me/submit')).status).toBe(200);

    const approved = await reviewer.post(`/api/admin/biodatas/${biodata.id}/approve`);
    expect(approved.status).toBe(200);
    expect((await Biodata.findById(biodata.id)).corrections).toHaveLength(0);
    expect((await User.findById(user._id)).connectionBalance).toBe(1);

    // Approving again (after an edit) gives no second gift.
    await Biodata.updateOne({ _id: biodata.id }, { status: 'pending' });
    await reviewer.post(`/api/admin/biodatas/${biodata.id}/approve`);
    expect(await ConnectionTransaction.countDocuments({ user: user._id, type: 'gift' })).toBe(1);
  });
});

describe('edit suspension', () => {
  it('pauses editing until the chosen date', async () => {
    const { user, biodata } = await approvedBiodata({ index: 7 });
    const owner = await login(user);
    const { agent: reviewer } = await userWithAgent({ role: 'support' });
    const until = new Date(Date.now() + 7 * 864e5).toISOString();

    expect(
      (await reviewer.post(`/api/admin/biodatas/${biodata._id}/suspend-edit`).send({ until: '2000-01-01' }))
        .status,
    ).toBe(400);
    expect(
      (
        await reviewer
          .post(`/api/admin/biodatas/${biodata._id}/suspend-edit`)
          .send({ until, reason: 'Repeated fake answers' })
      ).status,
    ).toBe(200);

    const save = await owner.put('/api/biodatas/me/sections/personal').send({ data: {} });
    expect(save.status).toBe(403);
    expect(save.body.error.code).toBe('EDIT_SUSPENDED');
    expect(save.body.error.details.until).toBeTruthy();
    expect((await owner.get('/api/biodatas/me')).body.biodata.editSuspendedUntil).toBeTruthy();

    await reviewer.post(`/api/admin/biodatas/${biodata._id}/suspend-edit`).send({ until: null });
    const sections = demoSections(PEOPLE[7], 7);
    expect(
      (await owner.put('/api/biodatas/me/sections/personal').send({ data: sections.personal })).status,
    ).toBe(200);
  });
});

describe('restoring a deleted biodata', () => {
  it('restores a never-published biodata at once', async () => {
    const { agent } = await userWithAgent();
    await agent.post('/api/biodatas/me').send({ pledge: true });
    await agent.delete('/api/biodatas/me').send({ reason: 'not_interested' });
    const restored = await agent.post('/api/biodatas/me/restore');
    expect(restored.status).toBe(200);
    expect(restored.body.biodata.deletedAt).toBeNull();
  });

  it('needs staff approval for a published one, and a permanent decline is final', async () => {
    const { user, biodata } = await approvedBiodata({ index: 8 });
    await Biodata.updateOne({ _id: biodata._id }, { firstApprovedAt: new Date() });
    const owner = await login(user);
    await owner.delete('/api/biodatas/me').send({ reason: 'privacy' });
    const direct = await owner.post('/api/biodatas/me/restore');
    expect(direct.body.error.code).toBe('RESTORE_NEEDS_APPROVAL');

    await owner.post('/api/biodatas/me/restore-request').send({ reason: 'Please' });
    const { agent: support } = await userWithAgent({ role: 'support' });
    const queue = await support.get('/api/admin/restore-requests?status=pending');
    const request = queue.body.items.find((r) => r.biodata.biodataNo === biodata.biodataNo);
    await support
      .post(`/api/admin/restore-requests/${request.id}/decline`)
      .send({ note: 'Fake profile', permanent: true });

    const again = await owner.post('/api/biodatas/me/restore-request').send({ reason: 'Please again' });
    expect(again.body.error.code).toBe('RESTORE_BLOCKED');
  });
});

describe('we got married', () => {
  it('records the marriage with the partner found by biodata number', async () => {
    const partner = await approvedBiodata({ index: 9 });
    const { user, biodata } = await approvedBiodata({ index: 10 });
    const owner = await login(user);

    const lookup = await owner.get(`/api/biodatas/partner-lookup?no=${partner.biodata.biodataNo}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.partner).toMatchObject({
      biodataNo: partner.biodata.biodataNo,
      district: partner.biodata.district,
    });
    expect(Object.keys(lookup.body.partner).sort()).toEqual([
      'biodataNo',
      'district',
      'education',
      'profession',
      'type',
    ]);
    expect((await owner.get(`/api/biodatas/partner-lookup?no=${biodata.biodataNo}`)).status).toBe(404);

    const del = await owner.delete('/api/biodatas/me').send({
      reason: 'married_via_ghotok',
      marriage: {
        marriedOn: '2026-09-12',
        place: 'Dhaka',
        partnerBiodataNo: partner.biodata.biodataNo,
        story: 'Our families met through Ghotok and everything fell into place.',
        shareStory: true,
      },
    });
    expect(del.status).toBe(200);
    const report = await MarriageReport.findOne({ biodata: biodata._id });
    expect(report.viaGhotok).toBe(true);
    expect(String(report.partnerBiodata)).toBe(String(partner.biodata._id));
    expect(report.shareStory).toBe(true);
    expect(report.storyStatus).toBe('pending');
  });
});
