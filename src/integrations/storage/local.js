import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { FILE_TYPES, IMAGE_TYPES } from './file-types.js';
import { signUploadToken, verifyUploadToken } from './upload-token.js';

// Development storage: files live on the API server's disk and every read or
// write goes through a short-lived signed URL served by routes/uploads.js.

export const EXT_BY_TYPE = Object.fromEntries(Object.entries(FILE_TYPES).map(([type, t]) => [type, t.ext]));
const root = () => path.resolve(env.UPLOAD_DIR);

/** Absolute path of a stored object, refusing anything that escapes the upload directory. */
export function resolveKey(key) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export async function writeObject(key, buffer) {
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
}

export async function findObject(key) {
  for (const ext of Object.values(EXT_BY_TYPE)) {
    const full = resolveKey(`${key}.${ext}`);
    try {
      await fs.access(full);
      return { full, ext };
    } catch {
      /* try next */
    }
  }
  return null;
}

async function removeObject(key) {
  const found = await findObject(key);
  if (found) await fs.rm(found.full, { force: true });
}

export const localDiskStorage = {
  name: 'local',

  async createPhotoUpload({ userId }) {
    const imageId = crypto.randomUUID();
    const key = `photos/${imageId}`;
    const token = signUploadToken({ kind: 'put', key, userId, types: IMAGE_TYPES });
    return { imageId, storage: 'local', uploadURL: `/api/uploads/local/${token}`, method: 'PUT' };
  },

  photoUrl(imageId) {
    return `/api/uploads/file/${signUploadToken({ kind: 'get', key: `photos/${imageId}` }, '1h')}`;
  },

  async deletePhoto(imageId) {
    await removeObject(`photos/${imageId}`);
  },

  /** A one-off upload of exactly `contentType` to `key` (private: NID images, attachments, banners). */
  async createPrivateUpload({ key, userId, contentType }) {
    const token = signUploadToken({ kind: 'put', key, userId, types: [contentType] });
    return {
      key,
      uploadURL: `/api/uploads/local/${token}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
    };
  },

  /** A short-lived link to a private file; with `filename` it downloads as that name. */
  async privateUrl(key, { filename, expiresIn = '5m' } = {}) {
    return `/api/uploads/file/${signUploadToken({ kind: 'get', key, filename }, expiresIn)}`;
  },

  async deletePrivate(key) {
    await removeObject(key);
  },

  async exists(key) {
    return !!(await findObject(key));
  },
};

/**
 * Stores a file uploaded to a signed local upload URL.
 * @returns {Promise<{ ok: true } | { error: 'BAD_TOKEN' | 'BAD_TYPE' | 'EMPTY' }>}
 */
export async function saveSignedUpload(token, contentType, body) {
  const t = verifyUploadToken(token, 'put');
  if (!t) return { error: 'BAD_TOKEN' };
  const type = String(contentType ?? '')
    .split(';')[0]
    .trim();
  const fileType = FILE_TYPES[type];
  // Older tokens without `types` were issued for photos only.
  if (!fileType || !(t.types ?? IMAGE_TYPES).includes(type)) return { error: 'BAD_TYPE' };
  if (!Buffer.isBuffer(body) || !body.length) return { error: 'EMPTY' };
  if (body.length > fileType.maxBytes) return { error: 'TOO_LARGE' };
  if (!fileType.magic(body)) return { error: 'BAD_TYPE' };
  await writeObject(`${t.key}.${fileType.ext}`, body);
  return { ok: true };
}

/**
 * Resolves a signed local download URL to a file on disk.
 * @returns {Promise<{ full: string, contentType: string } | { error: 'BAD_TOKEN' | 'NOT_FOUND' }>}
 */
export async function resolveSignedDownload(token) {
  const t = verifyUploadToken(token, 'get');
  if (!t) return { error: 'BAD_TOKEN' };
  const found = await findObject(t.key);
  if (!found) return { error: 'NOT_FOUND' };
  const contentType = Object.entries(EXT_BY_TYPE).find(([, ext]) => ext === found.ext)?.[0];
  return { full: found.full, contentType, filename: t.filename };
}
