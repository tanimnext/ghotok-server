import { Setting } from '../models/index.js';

export const DEFAULT_SETTINGS = {
  site: {
    name: 'Ghotok',
    tagline: {
      en: 'A modern, secure matchmaking platform for every faith in Bangladesh.',
      bn: 'বাংলাদেশের সব ধর্মের মানুষের জন্য আধুনিক ও নিরাপদ ঘটক প্ল্যাটফর্ম।',
    },
    supportEmail: 'support@ghotok.com.bd',
    supportPhone: '',
    address: '',
    facebook: '',
    youtube: '',
    instagram: '',
    whatsapp: '',
    // Link to the Android app, shown in the footer and the dashboard when set.
    appUrl: '',
    // YouTube links of short how-to videos, shown next to the matching steps.
    tutorials: { createBiodata: '', buyConnections: '', viewContact: '' },
  },
  payments: {
    verificationHours: 6,
    // Connections given once, when a member's biodata is approved for the first time.
    approvalGift: 1,
    // Discount (%) on packages for members whose biodata is approved. 0 turns it off.
    approvedDiscountPercent: 0,
    bkash: { enabled: true, manualNumber: '', accountType: 'personal' },
    nagad: { enabled: true, manualNumber: '', accountType: 'personal' },
    rocket: { enabled: true, manualNumber: '', accountType: 'personal' },
  },
  stats: { marriagesOffset: 0, show: true },
  moderation: { requireNidForApproval: false },
};

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, extra) {
  if (!isObject(base) || !isObject(extra)) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = isObject(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

export async function getSetting(key) {
  const doc = await Setting.findOne({ key }).lean();
  return deepMerge(DEFAULT_SETTINGS[key] ?? {}, doc?.value ?? {});
}

export async function getAllSettings() {
  const docs = await Setting.find({ key: { $in: Object.keys(DEFAULT_SETTINGS) } }).lean();
  const stored = Object.fromEntries(docs.map((d) => [d.key, d.value]));
  return Object.fromEntries(
    Object.keys(DEFAULT_SETTINGS).map((k) => [k, deepMerge(DEFAULT_SETTINGS[k], stored[k] ?? {})]),
  );
}

export async function setSetting(key, value, userId) {
  const merged = deepMerge(DEFAULT_SETTINGS[key] ?? {}, value);
  await Setting.findOneAndUpdate({ key }, { value: merged, updatedBy: userId }, { upsert: true });
  return merged;
}
