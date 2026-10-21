import fs from 'node:fs';
import { resolveSignedDownload, saveSignedUpload } from '../integrations/storage/local.js';
import { badRequest, forbidden, notFound } from '../utils/api-error.js';

// Endpoints for the local (development) storage driver. With STORAGE_DRIVER=cloudflare,
// browsers upload straight to Cloudflare Images / R2 and these endpoints are unused.

export async function upload(req, res) {
  const result = await saveSignedUpload(req.params.token, req.get('content-type'), req.body);
  if (result.error === 'BAD_TOKEN') throw forbidden('BAD_UPLOAD_TOKEN', 'The upload link has expired.');
  if (result.error === 'EMPTY') throw badRequest('EMPTY', 'The file is empty.');
  if (result.error === 'TOO_LARGE') throw badRequest('TOO_LARGE', 'The file is too large.');
  if (result.error) throw badRequest('BAD_TYPE', 'This type of file is not accepted here.');
  res.json({ ok: true });
}

export async function download(req, res) {
  const file = await resolveSignedDownload(req.params.token);
  if (file.error === 'BAD_TOKEN') throw forbidden('BAD_FILE_TOKEN', 'This link has expired.');
  if (file.error) throw notFound('File');
  res.set({
    'Content-Type': file.contentType,
    'Cache-Control': 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (file.filename) res.attachment(file.filename);
  fs.createReadStream(file.full).pipe(res);
}
