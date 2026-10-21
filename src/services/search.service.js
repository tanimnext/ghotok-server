import { EDUCATION_LEVELS } from '@ghotok/shared';
import { Biodata, Dislike, Favorite, ProfileVisit, PUBLIC_FILTER } from '../models/index.js';
import { toCard } from '../serializers/biodata.serializer.js';
import { pageParams, paginate } from '../utils/pagination.js';
import { csv, escapeRegex } from '../utils/strings.js';

// Public biodata search. Every filter maps to an indexed, denormalised field on
// the Biodata model (see biodata.model.js, "Denormalised search fields").

const LIST_FILTERS = {
  religion: 'religion',
  marital: 'maritalStatus',
  complexion: 'complexion',
  profession: 'profession',
  economic: 'economicStatus',
  division: 'division',
  district: 'district',
  upazila: 'upazila',
  presentDistrict: 'presentDistrict',
  presentUpazila: 'presentUpazila',
  medium: 'educationMedium',
  category: 'specialCategories',
};

const SORTS = {
  newest: { approvedAt: -1, _id: -1 },
  oldest: { approvedAt: 1, _id: 1 },
  age_asc: { birthDate: -1, _id: -1 },
  age_desc: { birthDate: 1, _id: -1 },
};

const yearsAgo = (years) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
};

const int = (v) => Number.parseInt(v, 10) || 0;

/** Builds the MongoDB filter for a search query. Exported for tests. */
export function buildSearchFilter(q) {
  const filter = { ...PUBLIC_FILTER };
  if (q.type === 'bride' || q.type === 'groom') filter.type = q.type;
  for (const [param, field] of Object.entries(LIST_FILTERS)) {
    const values = csv(q[param]).slice(0, 100);
    if (values.length) filter[field] = { $in: values };
  }
  // Age is stored as a birth date, so an age range becomes a birth-date range.
  const ageMin = int(q.ageMin);
  const ageMax = int(q.ageMax);
  if (ageMin || ageMax) {
    filter.birthDate = {};
    if (ageMin) filter.birthDate.$lte = yearsAgo(ageMin);
    if (ageMax) filter.birthDate.$gt = yearsAgo(ageMax + 1);
  }
  const heightMin = int(q.heightMin);
  const heightMax = int(q.heightMax);
  if (heightMin || heightMax) {
    filter.heightIn = {};
    if (heightMin) filter.heightIn.$gte = heightMin;
    if (heightMax) filter.heightIn.$lte = heightMax;
  }
  if (q.education) {
    const rank = EDUCATION_LEVELS.findIndex((e) => e.value === q.education);
    if (rank >= 0) filter.educationRank = { $gte: rank };
  }
  if (q.nid === 'verified') filter['nid.status'] = 'verified';
  if (q.q) {
    const digits = String(q.q).replace(/\D/g, '').slice(0, 10);
    if (digits) filter.biodataNo = new RegExp(`^GH-${escapeRegex(digits)}`, 'i');
  }
  return filter;
}

/** The viewer's own exclusions: their biodata and the ones they marked "not interested". */
async function viewerExclusions(filter, viewer) {
  if (!viewer) return;
  filter._id = { $nin: await Dislike.find({ user: viewer._id }).distinct('biodata') };
  filter.user = { $ne: viewer._id };
}

/**
 * Searches public biodatas. Signed-in members never see their own biodata or
 * biodatas they marked "not interested". `viewerKey` (member or anonymous visitor,
 * see visit.service.js) marks the results this viewer has already opened.
 */
export async function searchBiodatas(query, viewer, viewerKey) {
  const filter = buildSearchFilter(query);
  await viewerExclusions(filter, viewer);
  const params = pageParams(query, { defaultLimit: 12, maxLimit: 48 });
  const sort = SORTS[query.sort] ?? SORTS.newest;
  const result = await paginate(
    Biodata.find(filter).sort(sort),
    Biodata.countDocuments(filter),
    params,
    (b) => toCard(b),
  );
  if (viewerKey && result.items.length) {
    const seen = new Set(
      (
        await ProfileVisit.find({ viewerKey, biodata: { $in: result.items.map((b) => b.id) } }).distinct(
          'biodata',
        )
      ).map(String),
    );
    for (const item of result.items) item.seen = seen.has(item.id);
  }
  if (viewer && result.items.length) {
    const shortlisted = new Set(
      (
        await Favorite.find({ user: viewer._id, biodata: { $in: result.items.map((b) => b.id) } }).distinct(
          'biodata',
        )
      ).map(String),
    );
    for (const item of result.items) item.favorited = shortlisted.has(item.id);
  }
  return result;
}

/**
 * How many public biodatas match the other filters in each place, for the location
 * picker: `{ divisions: {dhaka: 12}, districts: {...}, upazilas: {...} }`.
 * `scope` is "permanent" (default) or "present".
 */
export async function locationCounts(query, viewer) {
  const present = query.scope === 'present';
  const fields = present
    ? { district: 'presentDistrict', upazila: 'presentUpazila' }
    : { district: 'district', upazila: 'upazila' };
  // Count with every filter except the location being picked.
  const {
    division: _d,
    district: _di,
    upazila: _u,
    presentDistrict: _pd,
    presentUpazila: _pu,
    ...rest
  } = query;
  const filter = buildSearchFilter(rest);
  await viewerExclusions(filter, viewer);
  const group = (field) =>
    Biodata.aggregate([
      { $match: { ...filter, [field]: { $ne: null } } },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
    ]);
  const [divisions, districts, upazilas] = await Promise.all([
    present ? Promise.resolve([]) : group('division'),
    group(fields.district),
    group(fields.upazila),
  ]);
  const asMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  return {
    scope: present ? 'present' : 'permanent',
    divisions: asMap(divisions),
    districts: asMap(districts),
    upazilas: asMap(upazilas),
  };
}

/** The most recently approved biodatas, for the home page. */
export async function featuredBiodatas(limit = 4) {
  const items = await Biodata.find(PUBLIC_FILTER).sort({ approvedAt: -1 }).limit(Math.min(12, limit));
  return items.map((b) => toCard(b));
}
