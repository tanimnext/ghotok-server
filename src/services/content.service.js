import { Biodata, Faq, PUBLIC_FILTER, Page } from '../models/index.js';
import { google } from '../integrations/oauth/google.js';
import { gateways } from '../integrations/payments/index.js';
import { notFound } from '../utils/api-error.js';
import { recordAudit } from './audit.service.js';
import { getAllSettings, getSetting, setSetting } from './settings.service.js';

// Public site content (stats, settings, CMS pages, FAQs) and its administration.

const STATS_TTL_MS = 60_000;
let statsCache = { at: 0, data: null };

/** Home page counters, cached for a minute. */
export async function publicStats() {
  if (statsCache.data && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.data;
  const [byType, marriages, settings] = await Promise.all([
    Biodata.aggregate([{ $match: PUBLIC_FILTER }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Biodata.countDocuments({ deleteReason: 'married_via_ghotok' }),
    getSetting('stats'),
  ]);
  const count = (type) => byType.find((x) => x._id === type)?.n ?? 0;
  const data = {
    show: settings.show !== false,
    biodatas: count('bride') + count('groom'),
    brides: count('bride'),
    grooms: count('groom'),
    marriages: marriages + Number(settings.marriagesOffset ?? 0),
  };
  statsCache = { at: Date.now(), data };
  return data;
}

export function clearStatsCache() {
  statsCache = { at: 0, data: null };
}

/** Settings that are safe to show to anyone. */
export async function publicSettings() {
  const [site, payments] = await Promise.all([getSetting('site'), getSetting('payments')]);
  return {
    site,
    payments: {
      verificationHours: payments.verificationHours,
      approvalGift: payments.approvalGift,
      approvedDiscountPercent: payments.approvedDiscountPercent,
      gateways: Object.keys(gateways).filter((m) => gateways[m].enabled),
    },
    auth: { google: google.enabled },
  };
}

export async function publishedPage(slug) {
  const page = await Page.findOne({ slug: slug.toLowerCase(), isPublished: true }).lean();
  if (!page) throw notFound('Page');
  return { slug: page.slug, title: page.title, body: page.body, updatedAt: page.updatedAt };
}

export async function activeFaqs() {
  const faqs = await Faq.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
  return faqs.map((f) => ({ id: f._id, question: f.question, answer: f.answer, category: f.category }));
}

// ----- Staff -------------------------------------------------------------------

export const allSettings = () => getAllSettings();

export async function updateSettings(key, value, ctx) {
  const saved = await setSetting(key, value, ctx.actor._id);
  if (key === 'stats') clearStatsCache();
  await recordAudit(ctx, 'settings.update', {
    targetType: 'setting',
    targetId: key,
    summary: `Updated ${key} settings`,
  });
  return saved;
}

export const listPages = () => Page.find().sort({ slug: 1 }).lean();

export async function getPage(slug) {
  const page = await Page.findOne({ slug }).lean();
  if (!page) throw notFound('Page');
  return page;
}

export async function upsertPage(slug, data, ctx) {
  const page = await Page.findOneAndUpdate(
    { slug },
    { ...data, slug, updatedBy: ctx.actor._id },
    { upsert: true, new: true },
  );
  await recordAudit(ctx, 'page.update', {
    targetType: 'page',
    targetId: slug,
    summary: `Updated page ${slug}`,
  });
  return page;
}

export async function deletePage(slug, ctx) {
  const page = await Page.findOneAndDelete({ slug });
  if (!page) throw notFound('Page');
  await recordAudit(ctx, 'page.delete', {
    targetType: 'page',
    targetId: slug,
    summary: `Deleted page ${slug}`,
  });
}

export const listFaqs = () => Faq.find().sort({ sortOrder: 1, createdAt: 1 }).lean();

export async function createFaq(data, ctx) {
  const faq = await Faq.create({ category: 'general', sortOrder: 0, isActive: true, ...data });
  await recordAudit(ctx, 'faq.create', { targetType: 'faq', targetId: faq._id, summary: 'Created FAQ' });
  return faq;
}

export async function updateFaq(id, data) {
  const faq = await Faq.findByIdAndUpdate(id, data, { new: true });
  if (!faq) throw notFound('FAQ');
  return faq;
}

export async function deleteFaq(id, ctx) {
  const faq = await Faq.findByIdAndDelete(id);
  if (!faq) throw notFound('FAQ');
  await recordAudit(ctx, 'faq.delete', { targetType: 'faq', targetId: faq._id, summary: 'Deleted FAQ' });
}
