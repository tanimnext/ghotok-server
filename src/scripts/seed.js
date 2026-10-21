// Seeds the database.
//   npm run seed        → super admin, packages, pages and FAQs (safe to run repeatedly)
//   npm run seed:demo   → the above plus demo users, biodatas, payments and support data
//
// Demo data is for local development only. Never run --demo against production.

import { validateBiodata } from '@ghotok/shared';
import { env, isProd } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { hashPassword } from '../utils/crypto.js';
import {
  Biodata,
  ContactMessage,
  Faq,
  MarriageReport,
  Package,
  Page,
  Payment,
  Proposal,
  Report,
  RestoreRequest,
  SupportTicket,
  User,
  nextSequence,
} from '../models/index.js';
import { changeBalance } from '../services/connection.service.js';
import { FAQS, PACKAGES, PAGES } from './seed-data/content.js';
import { PEOPLE, demoSections } from './seed-data/demo-people.js';

const log = (...a) => console.log('•', ...a);

export async function seedBase() {
  let admin = await User.findOne({ email: env.SEED_ADMIN_EMAIL.toLowerCase() });
  if (!admin) {
    admin = await User.create({
      name: env.SEED_ADMIN_NAME,
      email: env.SEED_ADMIN_EMAIL.toLowerCase(),
      passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
      role: 'super_admin',
      emailVerified: true,
    });
    log(`Super admin created: ${admin.email} (change the password after first login)`);
  } else {
    log(`Super admin exists: ${admin.email}`);
  }

  if (!(await Package.exists({}))) {
    await Package.insertMany(PACKAGES);
    log(`Packages created: ${PACKAGES.map((p) => `${p.connections} for ৳${p.price}`).join(', ')}`);
  }
  for (const page of PAGES) {
    const exists = await Page.exists({ slug: page.slug });
    if (!exists) await Page.create(page);
  }
  log(`Pages ready: ${PAGES.map((p) => p.slug).join(', ')}`);
  if (!(await Faq.exists({}))) {
    await Faq.insertMany(FAQS);
    log(`FAQs created: ${FAQS.length}`);
  }
  return admin;
}

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

async function seedDemo(admin) {
  if (await User.exists({ email: 'demo1@example.com' })) {
    log('Demo data already present, skipping.');
    return;
  }
  const passwordHash = await hashPassword('Demo@12345');
  const users = [];
  for (const [i, person] of PEOPLE.entries()) {
    const user = await User.create({
      name: person[9],
      email: `demo${i + 1}@example.com`,
      phone: `018${String(20000000 + i * 104729).slice(0, 8)}`,
      passwordHash,
      emailVerified: true,
    });
    users.push(user);
    const sections = demoSections(person, i);
    const errors = validateBiodata(sections);
    if (Object.keys(errors).length)
      throw new Error(`Demo biodata ${i} is invalid: ${JSON.stringify(errors)}`);
    const status = i === 4 || i === 15 ? 'pending' : 'approved';
    const daysAgo = PEOPLE.length - i;
    await Biodata.create({
      user: user._id,
      biodataNo: `GH-${await nextSequence('biodata', 1000)}`,
      ...sections,
      status,
      submittedAt: new Date(Date.now() - (daysAgo + 1) * 864e5),
      ...(status === 'approved'
        ? {
            approvedAt: new Date(Date.now() - daysAgo * 864e5),
            firstApprovedAt: new Date(Date.now() - daysAgo * 864e5),
            reviewedBy: admin._id,
          }
        : {}),
      nid:
        i % 3 === 0
          ? { status: 'verified', submittedAt: new Date(), reviewedAt: new Date(), reviewedBy: admin._id }
          : { status: 'not_submitted' },
      stats: { views: 40 + ((i * 37) % 300) },
    });
  }
  log(`Demo biodatas created: ${PEOPLE.length} (password for every demo account: Demo@12345)`);

  // A ready-to-use member account with a few connections and some history.
  const member = await User.create({
    name: 'Demo Member',
    email: 'member@example.com',
    phone: '01911000000',
    passwordHash,
    emailVerified: true,
  });
  const pkg = await Package.findOne({ connections: 5 });
  const verified = await Payment.create({
    invoiceNo: `INV-DEMO-${await nextSequence('invoice', 10000)}`,
    user: member._id,
    package: pkg._id,
    packageName: pkg.name,
    connections: pkg.connections,
    amount: pkg.price,
    method: 'bkash',
    mode: 'manual',
    senderNumber: '01911000000',
    trxId: 'DEMO8K2L1M',
    status: 'verified',
    reviewedBy: admin._id,
    reviewedAt: new Date(),
    creditedAt: new Date(),
  });
  await changeBalance(member._id, pkg.connections, {
    type: 'purchase',
    payment: verified._id,
    actor: admin._id,
    reason: verified.invoiceNo,
  });

  const support = await User.create({
    name: 'Support Reviewer',
    email: 'support@example.com',
    passwordHash,
    role: 'support',
    emailVerified: true,
  });

  // Payments waiting for verification.
  for (const [i, u] of users.slice(0, 3).entries()) {
    const p = i % 2 ? await Package.findOne({ connections: 3 }) : pkg;
    await Payment.create({
      invoiceNo: `INV-DEMO-${await nextSequence('invoice', 10000)}`,
      user: u._id,
      package: p._id,
      packageName: p.name,
      connections: p.connections,
      amount: p.price,
      method: ['bkash', 'nagad', 'rocket'][i],
      mode: 'manual',
      senderNumber: u.phone,
      trxId: `DEMO${i}TRX${i + 7}A`,
      status: 'pending',
    });
  }

  const biodatas = await Biodata.find().sort({ biodataNo: 1 });
  await Proposal.create({
    from: users[1]._id,
    fromBiodata: biodatas[1]._id,
    to: users[0]._id,
    toBiodata: biodatas[0]._id,
    message: 'Our family would like to know more about your family.',
  });
  await Proposal.create({
    from: users[0]._id,
    fromBiodata: biodatas[0]._id,
    to: users[5]._id,
    toBiodata: biodatas[5]._id,
    status: 'accepted',
    respondedAt: new Date(),
  });
  await Report.create({
    reporter: member._id,
    biodata: biodatas[7]._id,
    targetUser: users[7]._id,
    reason: 'wrong_contact',
    details: 'The guardian number was switched off for three days.',
  });
  await SupportTicket.create({
    ticketNo: `T-${await nextSequence('ticket', 1000)}`,
    user: member._id,
    subject: 'Payment not reflected yet',
    category: 'payment',
    messages: [
      {
        author: member._id,
        staff: false,
        body: 'I paid with bKash an hour ago but my connections are not added yet.',
      },
    ],
  });
  // A deleted biodata waiting in the recovery queue.
  const deleted = biodatas[9];
  deleted.deletedAt = new Date(Date.now() - 3 * 864e5);
  deleted.deleteReason = 'not_interested';
  await deleted.save();
  await RestoreRequest.create({
    biodata: deleted._id,
    user: users[9]._id,
    reason: 'I want to start looking again.',
  });
  // Two couples who married through Ghotok: one story published, one waiting for staff.
  const [bride, groom] = [biodatas[16], biodatas[17]];
  for (const b of [bride, groom]) {
    b.deletedAt = new Date(Date.now() - 20 * 864e5);
    b.deleteReason = 'married_via_ghotok';
    await b.save();
  }
  await MarriageReport.create({
    user: bride.user,
    biodata: bride._id,
    viaGhotok: true,
    marriedOn: new Date(Date.now() - 40 * 864e5),
    partnerBiodata: groom._id,
    story: 'Our families talked for two months before the wedding. Thank you, Ghotok.',
    shareStory: true,
    storyStatus: 'published',
    publishedStory:
      'Our families met through Ghotok and talked for two months. Both families felt at ease from the first visit. Thank you for making it simple and respectful.',
    publishedAt: new Date(Date.now() - 10 * 864e5),
  });
  await MarriageReport.create({
    user: groom.user,
    biodata: groom._id,
    viaGhotok: true,
    marriedOn: new Date(Date.now() - 40 * 864e5),
    partnerBiodata: bride._id,
    story: 'We found each other here. Our parents handled everything with great care.',
    shareStory: true,
  });
  await ContactMessage.create({
    name: 'Rahima Begum',
    phone: '01700000000',
    subject: 'Help creating a biodata',
    message: 'Can someone help my daughter fill in the biodata form?',
  });

  log('Demo member: member@example.com / Demo@12345 (5 connections)');
  log(`Demo support reviewer: ${support.email} / Demo@12345`);
}

async function main() {
  const demo = process.argv.includes('--demo');
  if (demo && isProd) throw new Error('Refusing to load demo data in production.');
  await connectDb();
  const admin = await seedBase();
  if (demo) await seedDemo(admin);
  await disconnectDb();
  log('Done.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(err);
    await disconnectDb().catch(() => undefined);
    process.exit(1);
  });
}
