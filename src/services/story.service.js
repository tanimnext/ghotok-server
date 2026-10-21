import { DISTRICTS } from '@ghotok/shared';
import { MarriageReport } from '../models/index.js';
import { toUserSummary } from '../serializers/user.serializer.js';
import { conflict, notFound } from '../utils/api-error.js';
import { pageParams, paginate } from '../utils/pagination.js';
import { recordAudit } from './audit.service.js';
import { clearStatsCache } from './content.service.js';

// "We got married" reports and the success stories published from them.

const monthOf = (d) => (d ? new Date(d).toISOString().slice(0, 7) : null);

/** Published stories for the home page. No names: the couple's districts and the month only. */
export async function publishedStories(limit = 8) {
  const items = await MarriageReport.find({ storyStatus: 'published' })
    .sort({ publishedAt: -1 })
    .limit(Math.min(20, limit))
    .populate('biodata', 'type district')
    .populate('partnerBiodata', 'type district')
    .lean();
  return items.map((r) => ({
    id: r._id,
    story: r.publishedStory || r.story,
    marriedOn: monthOf(r.marriedOn),
    viaGhotok: r.viaGhotok,
    districts: [r.biodata?.district, r.partnerBiodata?.district ?? r.partner?.district]
      .filter((d) => DISTRICTS.some((x) => x.value === d))
      .filter((d, i, all) => all.indexOf(d) === i),
  }));
}

/** Staff: every report, newest first, optionally by story status. */
export function listMarriageReports({ status }, query) {
  const filter = status ? { storyStatus: status } : {};
  return paginate(
    MarriageReport.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'name email phone role status')
      .populate('biodata', 'biodataNo district')
      .populate('partnerBiodata', 'biodataNo')
      .lean(),
    MarriageReport.countDocuments(filter),
    pageParams(query, { defaultLimit: 20 }),
    (r) => ({
      id: r._id,
      user: toUserSummary(r.user),
      biodataNo: r.biodata?.biodataNo ?? null,
      partnerBiodataNo: r.partnerBiodata?.biodataNo ?? null,
      partner: r.partner ?? null,
      viaGhotok: r.viaGhotok,
      marriedOn: r.marriedOn ?? null,
      place: r.place ?? null,
      story: r.story ?? null,
      shareStory: r.shareStory,
      storyStatus: r.storyStatus,
      publishedStory: r.publishedStory ?? null,
      createdAt: r.createdAt,
    }),
  );
}

/** Publishes (with optional edited text) or hides a story. Publishing needs the member's consent. */
export async function updateStory(id, { storyStatus, publishedStory }, ctx) {
  const r = await MarriageReport.findById(id);
  if (!r) throw notFound('Report');
  if (storyStatus === 'published' && !r.shareStory) {
    throw conflict('NO_CONSENT', 'The member did not agree to share this story.');
  }
  if (storyStatus === 'published' && !(publishedStory ?? r.publishedStory ?? r.story)) {
    throw conflict('NO_STORY', 'There is no story text to publish.');
  }
  if (publishedStory !== undefined) r.publishedStory = publishedStory || undefined;
  if (storyStatus) {
    r.storyStatus = storyStatus;
    r.publishedAt = storyStatus === 'published' ? new Date() : r.publishedAt;
  }
  await r.save();
  clearStatsCache();
  await recordAudit(ctx, 'story.update', {
    targetType: 'marriage_report',
    targetId: r._id,
    summary: `Success story ${r.storyStatus}`,
  });
  return { id: r._id, storyStatus: r.storyStatus, publishedStory: r.publishedStory ?? null };
}
