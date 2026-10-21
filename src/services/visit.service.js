import crypto from 'node:crypto';
import { Biodata, ProfileVisit } from '../models/index.js';
import { dayKey } from '../utils/strings.js';

/** A stable anonymous visitor id for the `gh_vid` cookie. */
export const newVisitorId = () => crypto.randomUUID();
export const isValidVisitorId = (id) => typeof id === 'string' && /^[\w-]{20,64}$/.test(id);

/**
 * Records one visit per viewer per biodata per day.
 * @returns {Promise<boolean>} true when this visit was counted
 */
export async function recordVisit(biodata, viewerKey) {
  if (!viewerKey) return false;
  try {
    await ProfileVisit.create({ biodata: biodata._id, viewerKey, day: dayKey() });
  } catch (err) {
    if (err?.code === 11000) return false; // already counted today
    throw err;
  }
  await Biodata.updateOne({ _id: biodata._id }, { $inc: { 'stats.views': 1 } });
  return true;
}

/** Visit counts for today, the last 7 days and the last 30 days. */
export async function visitStats(biodataId) {
  const now = Date.now();
  const since = (days) => dayKey(new Date(now - (days - 1) * 864e5));
  const [today, week, month] = await Promise.all([
    ProfileVisit.countDocuments({ biodata: biodataId, day: dayKey() }),
    ProfileVisit.countDocuments({ biodata: biodataId, day: { $gte: since(7) } }),
    ProfileVisit.countDocuments({ biodata: biodataId, day: { $gte: since(30) } }),
  ]);
  return { today, week, month };
}
