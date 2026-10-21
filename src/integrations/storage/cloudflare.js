import crypto from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env.js';

// Production storage:
// - Photos: Cloudflare Images "direct creator upload". The browser uploads straight
//   to Cloudflare; the API never handles the file. When CF_IMAGES_SIGNING_KEY is set,
//   images require signed URLs, so a photo cannot be hot-linked once its URL expires.
// - NID documents: a private R2 bucket accessed only through short-lived presigned URLs.

const CF_API = 'https://api.cloudflare.com/client/v4';

let s3;
function r2() {
  s3 ??= new S3Client({
    region: 'auto',
    endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  return s3;
}

async function cfImages(pathname, init = {}) {
  const res = await fetch(`${CF_API}/accounts/${env.CF_ACCOUNT_ID}/images${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.CF_IMAGES_API_TOKEN}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(`Cloudflare Images error ${res.status}: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result;
}

export const cloudflareStorage = {
  name: 'cloudflare',

  async createPhotoUpload({ userId }) {
    const form = new FormData();
    form.append('requireSignedURLs', env.CF_IMAGES_SIGNING_KEY ? 'true' : 'false');
    form.append('metadata', JSON.stringify({ userId: String(userId), purpose: 'biodata-photo' }));
    const result = await cfImages('/v2/direct_upload', { method: 'POST', body: form });
    return {
      imageId: result.id,
      storage: 'cloudflare',
      uploadURL: result.uploadURL,
      method: 'POST',
      field: 'file',
    };
  },

  photoUrl(imageId) {
    const url = new URL(
      `https://imagedelivery.net/${env.CF_IMAGES_ACCOUNT_HASH}/${imageId}/${env.CF_IMAGES_VARIANT}`,
    );
    if (!env.CF_IMAGES_SIGNING_KEY) return url.toString();
    url.searchParams.set('exp', String(Math.floor(Date.now() / 1000) + 3600));
    const sig = crypto
      .createHmac('sha256', env.CF_IMAGES_SIGNING_KEY)
      .update(`${url.pathname}?${url.searchParams.toString()}`)
      .digest('hex');
    url.searchParams.set('sig', sig);
    return url.toString();
  },

  async deletePhoto(imageId) {
    await cfImages(`/v1/${encodeURIComponent(imageId)}`, { method: 'DELETE' }).catch(() => undefined);
  },

  /**
   * A presigned PUT for exactly `contentType` (and `size`, when given: R2 then
   * rejects any other length, which enforces the per-type size limit).
   */
  async createPrivateUpload({ key, contentType, size }) {
    const uploadURL = await getSignedUrl(
      r2(),
      new PutObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        ContentType: contentType,
        ...(size ? { ContentLength: size } : {}),
      }),
      { expiresIn: 600 },
    );
    return { key, uploadURL, method: 'PUT', headers: { 'Content-Type': contentType } };
  },

  async privateUrl(key, { filename, expiresIn = '5m' } = {}) {
    const seconds = Number.parseInt(expiresIn, 10) * (String(expiresIn).endsWith('h') ? 3600 : 60);
    return getSignedUrl(
      r2(),
      new GetObjectCommand({
        Bucket: env.R2_BUCKET,
        Key: key,
        ...(filename
          ? { ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"` }
          : {}),
      }),
      { expiresIn: seconds || 300 },
    );
  },

  async deletePrivate(key) {
    await r2()
      .send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }))
      .catch(() => undefined);
  },

  async exists(key) {
    try {
      await r2().send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  },
};
