import { describe, expect, it } from 'vitest';
import { User } from '../src/models/index.js';
import { approvedBiodata, userWithAgent } from './helpers.js';

const RECEIPT = 'https://i.ibb.co/Xy12Ab/bkash-receipt.png';

describe('support attachments', () => {
  it('attaches ImgBB images to tickets and rejects other hosts', async () => {
    const { agent } = await userWithAgent();
    const offsite = await agent.post('/api/tickets').send({
      subject: 'Payment receipt',
      message: 'Here is the receipt for my bKash payment.',
      attachments: ['https://evil.example.com/receipt.png'],
    });
    expect(offsite.status).toBe(400);
    expect(offsite.body.error.code).toBe('VALIDATION_ERROR');
    const tooMany = await agent.post('/api/tickets').send({
      subject: 'Payment receipt',
      message: 'Here is the receipt for my bKash payment.',
      attachments: Array.from({ length: 6 }, (_, i) => `https://i.ibb.co/a${i}/x.png`),
    });
    expect(tooMany.status).toBe(400);

    const created = await agent.post('/api/tickets').send({
      subject: 'Payment receipt',
      category: 'payment',
      message: 'Here is the receipt for my bKash payment.',
      attachments: [RECEIPT],
    });
    expect(created.status).toBe(201);
    const thread = await agent.get(`/api/tickets/${created.body.ticket.id}`);
    expect(thread.body.ticket.messages[0].attachments).toEqual([{ url: RECEIPT, type: 'image' }]);

    // Admins can reply with only an image.
    const { agent: admin } = await userWithAgent({ role: 'admin' });
    const reply = await admin
      .post(`/api/admin/tickets/${created.body.ticket.id}/messages`)
      .send({ attachments: ['https://ibb.co/Qq9z/guide'] });
    expect(reply.status).toBe(200);
    expect(reply.body.ticket.messages[1].attachments).toHaveLength(1);
    // An empty reply is refused.
    const empty = await admin.post(`/api/admin/tickets/${created.body.ticket.id}/messages`).send({});
    expect(empty.status).toBe(400);
  });

  it('accepts ImgBB images on reports', async () => {
    const { biodata } = await approvedBiodata({ index: 12 });
    const { agent } = await userWithAgent();
    const bad = await agent
      .post(`/api/biodatas/${biodata.biodataNo}/report`)
      .send({ reason: 'fake_info', attachments: ['ftp://i.ibb.co/x.png'] });
    expect(bad.status).toBe(400);
    const ok = await agent
      .post(`/api/biodatas/${biodata.biodataNo}/report`)
      .send({ reason: 'fake_info', attachments: [RECEIPT] });
    expect(ok.status).toBe(201);
    const ticket = await agent.get(`/api/tickets/${ok.body.report.ticketId}`);
    expect(ticket.body.ticket.messages[0].attachments[0].url).toBe(RECEIPT);
  });
});

describe('reports as conversations', () => {
  it('opens a conversation, closes it with the outcome and refunds an unlocked contact once', async () => {
    const { biodata } = await approvedBiodata({ index: 13 });
    const { user, agent } = await userWithAgent({ balance: 2 });
    await agent.post(`/api/biodatas/${biodata.biodataNo}/unlock`).expect(200);

    const reported = await agent
      .post(`/api/biodatas/${biodata.biodataNo}/report`)
      .send({ reason: 'wrong_contact', details: 'The number belongs to someone else.' });
    expect(reported.status).toBe(201);
    const { ticketId } = reported.body.report;
    expect(ticketId).toBeTruthy();

    const again = await agent.post(`/api/biodatas/${biodata.biodataNo}/report`).send({ reason: 'fraud' });
    expect(again.body.error.code).toBe('ALREADY_REPORTED');
    expect(again.body.error.details.ticketId).toBe(ticketId);

    const ticket = await agent.get(`/api/tickets/${ticketId}`);
    expect(ticket.body.ticket).toMatchObject({ category: 'report', biodataNo: biodata.biodataNo });

    const { agent: staff } = await userWithAgent({ role: 'admin' });
    const reports = await staff.get('/api/admin/reports?status=active');
    const row = reports.body.items.find((r) => r.id === reported.body.report.id);
    expect(row).toMatchObject({ ticketId, reporterUnlocked: true, connectionRefunded: false });

    const resolved = await staff
      .patch(`/api/admin/reports/${row.id}`)
      .send({ status: 'resolved', actionTaken: 'The number was corrected.', refundConnection: true });
    expect(resolved.status).toBe(200);
    expect((await User.findById(user._id)).connectionBalance).toBe(2);

    const closed = await agent.get(`/api/tickets/${ticketId}`);
    expect(closed.body.ticket.status).toBe('closed');
    expect(closed.body.ticket.messages.at(-1).body).toContain('returned to your balance');

    const viewer = await agent.get(`/api/biodatas/${biodata.biodataNo}/viewer`);
    expect(viewer.body).toMatchObject({ refunded: true, report: { status: 'resolved', ticketId } });

    // A second refund for the same report is not possible.
    const twice = await staff
      .patch(`/api/admin/reports/${row.id}`)
      .send({ status: 'resolved', refundConnection: true });
    expect(twice.status).toBe(200);
    expect((await User.findById(user._id)).connectionBalance).toBe(2);
  });

  it('refuses a refund when the reporter never unlocked the contact', async () => {
    const { biodata } = await approvedBiodata({ index: 14 });
    const { agent } = await userWithAgent();
    const reported = await agent
      .post(`/api/biodatas/${biodata.biodataNo}/report`)
      .send({ reason: 'fake_info' });
    const { agent: staff } = await userWithAgent({ role: 'admin' });
    const res = await staff
      .patch(`/api/admin/reports/${reported.body.report.id}`)
      .send({ status: 'resolved', refundConnection: true });
    expect(res.body.error.code).toBe('NOTHING_TO_REFUND');
  });
});

describe('notifications', () => {
  it('lets members delete a notification', async () => {
    const { user, agent } = await userWithAgent();
    const { notify } = await import('../src/services/notification.service.js');
    await notify(user._id, 'favorited', { biodataNo: 'GH-1' });
    const list = await agent.get('/api/me/notifications');
    expect(list.body.items).toHaveLength(1);
    await agent.delete(`/api/me/notifications/${list.body.items[0]._id}`).expect(200);
    expect((await agent.get('/api/me/notifications')).body.items).toHaveLength(0);
  });
});
