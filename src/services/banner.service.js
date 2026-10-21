import { Banner } from '../models/index.js';
import { notFound } from '../utils/api-error.js';
import { recordAudit } from './audit.service.js';

// Printable wedding banners: staff upload a preview and the full design to ImgBB
// from the admin panel; visitors download them for free.

function toBannerDTO(b, { admin = false } = {}) {
  return {
    id: b._id.toString(),
    title: b.title,
    imageUrl: b.imageUrl,
    downloads: b.downloads,
    ...(admin ? { downloadUrl: b.downloadUrl, isActive: b.isActive, sortOrder: b.sortOrder } : {}),
  };
}

export async function activeBanners() {
  const items = await Banner.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
  return items.map((b) => toBannerDTO(b));
}

/** Counts a download and returns the link to the full-size design. */
export async function downloadBanner(id) {
  const b = await Banner.findOneAndUpdate(
    { _id: id, isActive: true },
    { $inc: { downloads: 1 } },
    { new: true },
  );
  if (!b) throw notFound('Banner');
  return { url: b.downloadUrl };
}

// ----- Staff -------------------------------------------------------------------

export async function listBanners() {
  const items = await Banner.find().sort({ sortOrder: 1, createdAt: -1 });
  return items.map((b) => toBannerDTO(b, { admin: true }));
}

export async function createBanner(data, ctx) {
  const b = await Banner.create({
    title: data.title,
    imageUrl: data.imageUrl,
    downloadUrl: data.downloadUrl ?? data.imageUrl,
    sortOrder: data.sortOrder ?? 0,
    isActive: data.isActive ?? true,
  });
  await recordAudit(ctx, 'banner.create', {
    targetType: 'banner',
    targetId: b._id,
    summary: `Added banner ${b.title.en}`,
  });
  return toBannerDTO(b, { admin: true });
}

export async function updateBanner(id, data, ctx) {
  const b = await Banner.findById(id);
  if (!b) throw notFound('Banner');
  for (const key of ['title', 'imageUrl', 'downloadUrl', 'sortOrder', 'isActive'])
    if (data[key] !== undefined) b[key] = data[key];
  await b.save();
  await recordAudit(ctx, 'banner.update', {
    targetType: 'banner',
    targetId: b._id,
    summary: `Updated banner ${b.title.en}`,
  });
  return toBannerDTO(b, { admin: true });
}

export async function deleteBanner(id, ctx) {
  const b = await Banner.findByIdAndDelete(id);
  if (!b) throw notFound('Banner');
  await recordAudit(ctx, 'banner.delete', {
    targetType: 'banner',
    targetId: b._id,
    summary: `Deleted banner ${b.title.en}`,
  });
}
