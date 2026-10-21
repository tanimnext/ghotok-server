import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { User } from '../src/models/index.js';
import { app, approvedBiodata, userWithAgent } from './helpers.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

describe('support attachments', () => {
  it('attaches a PDF to a ticket that only the ticket’s people can open', async () => {
    const { agent } = await userWithAgent();
    const tooBig = await agent
      .post('/api/tickets/attachments/upload-url')
      .send({ contentType: 'image/png', size: 6 * 1024 * 1024 });
    expect(tooBig.status).toBe(400);

    const target = await agent
      .post('/api/tickets/attachments/upload-url')
      .send({ contentType: 'application/pdf', size: PDF.length, name: 'receipt.pdf' });
    expect(target.status).toBe(200);
    expect(
      (await request(app).put(target.body.uploadURL).set('Content-Type', 'application/pdf').send(PDF)).status,
    ).toBe(200);

    const created = await agent.post('/api/tickets').send({
      subject: 'Payment receipt',
      category: 'payment',
      message: 'Here is the receipt for my bKash payment.',
      attachments: [target.body.ticket],
    });
    expect(created.status).toBe(201);
    const thread = await agent.get(`/api/tickets/${created.body.ticket.id}`);
    const [file] = thread.body.ticket.messages[0].attachments;
    expect(file).toMatchObject({ name: 'receipt.pdf', type: 'application/pdf' });
    expect((await request(app).get(file.url)).headers['content-type']).toBe('application/pdf');

    // Another member cannot reuse the upload ticket.
    const { agent: other } = await userWithAgent();
    const stolen = await other.post('/api/tickets').send({
      subject: 'Not mine',
      message: 'Trying to attach someone else’s file.',
      attachments: [target.body.ticket],
    });
    expect(stolen.body.error.code).toBe('BAD_TICKET');

    // Staff can reply with only an attachment.
    const { agent: staff } = await userWithAgent({ role: 'support' });
    const staffTarget = await staff
      .post('/api/tickets/attachments/upload-url')
      .send({ contentType: 'application/pdf', size: PDF.length, name: 'guide.pdf' });
    await request(app).put(staffTarget.body.uploadURL).set('Content-Type', 'application/pdf').send(PDF);
    const reply = await staff
      .post(`/api/admin/tickets/${created.body.ticket.id}/messages`)
      .send({ attachments: [staffTarget.body.ticket] });
    expect(reply.status).toBe(200);
    expect(reply.body.ticket.messages[1].attachments).toHaveLength(1);
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

    const { agent: staff } = await userWithAgent({ role: 'support' });
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
    const { agent: staff } = await userWithAgent({ role: 'support' });
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
