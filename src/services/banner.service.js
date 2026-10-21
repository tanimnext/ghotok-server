import crypto from 'node:crypto';
import { signUploadToken, storage, verifyUploadToken } from '../integrations/storage/index.js';
import { Banner } from '../models/index.js';
import { badRequest, notFound } from '../utils/api-error.js';
import { recordAudit } from './audit.service.js';

// Printable wedding banners: staff upload a PDF and a preview image; visitors
// download them for free.

async function toBannerDTO(b, { admin = false } = {}) {
  return {
    id: b._id.toString(),
    title: b.title,
    previewUrl: await storage.privateUrl(b.previewKey, { expiresIn: '1h' }),
    downloads: b.downloads,
    ...(admin ? { isActive: b.isActive, sortOrder: b.sortOrder, fileName: b.fileName ?? null } : {}),
  };
}

export async function activeBanners() {
  const items = await Banner.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
  return Promise.all(items.map((b) => toBannerDTO(b)));
}

/** Counts a download and returns a short-lived link to the PDF. */
export async function downloadBanner(id) {
  const b = await Banner.findOneAndUpdate(
    { _id: id, isActive: true },
    { $inc: { downloads: 1 } },
    { new: true },
  );
  if (!b) throw notFound('Banner');
  return { url: await storage.privateUrl(b.fileKey, { filename: b.fileName || 'ghotok-banner.pdf' }) };
}

// ----- Staff -------------------------------------------------------------------

export async function listBanners() {
  const items = await Banner.find().sort({ sortOrder: 1, createdAt: -1 });
  return Promise.all(items.map((b) => toBannerDTO(b, { admin: true })));
}

/** An upload target for a banner file (`kind` is "preview" for the image or "file" for the PDF). */
export async function createBannerUpload(userId, { kind, contentType, size }) {
  const key = `banners/${kind}-${crypto.randomUUID()}`;
  const upload = await storage.createPrivateUpload({ key, contentType, size, userId: String(userId) });
  return {
    ...upload,
    ticket: signUploadToken({ kind: 'ticket', key, userId: String(userId), purpose: `banner-${kind}` }, '1h'),
  };
}

function keyFromTicket(ticket, userId, kind) {
  const t = verifyUploadToken(ticket, 'ticket');
  if (!t?.key || t.userId !== String(userId) || t.purpose !== `banner-${kind}`) {
    throw badRequest('BAD_TICKET', 'The upload has expired. Please upload the file again.');
  }
  return t.key;
}

export async function createBanner(data, ctx) {
  const userId = ctx.actor._id;
  const previewKey = keyFromTicket(data.previewTicket, userId, 'preview');
  const fileKey = keyFromTicket(data.fileTicket, userId, 'file');
  for (const key of [previewKey, fileKey]) {
    if (!(await storage.exists(key)))
      throw badRequest('UPLOAD_MISSING', 'We could not find the uploaded file.');
  }
  const b = await Banner.create({
    title: data.title,
    fileName: data.fileName,
    sortOrder: data.sortOrder ?? 0,
    isActive: data.isActive ?? true,
    previewKey,
    fileKey,
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
  for (const key of ['title', 'fileName', 'sortOrder', 'isActive'])
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
  await Promise.all([storage.deletePrivate(b.previewKey), storage.deletePrivate(b.fileKey)]);
  await recordAudit(ctx, 'banner.delete', {
    targetType: 'banner',
    targetId: b._id,
    summary: `Deleted banner ${b.title.en}`,
  });
}
