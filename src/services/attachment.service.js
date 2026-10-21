import crypto from 'node:crypto';
import { FILE_TYPES, signUploadToken, storage, verifyUploadToken } from '../integrations/storage/index.js';
import { badRequest } from '../utils/api-error.js';

// Files attached to support messages: images (5 MB), PDFs (10 MB) and videos (25 MB).
// Members and staff upload straight to private storage and attach the signed ticket.

/** An upload target for one attachment. The caller has already validated type and size. */
export async function createAttachmentUpload(userId, { contentType, size, name }) {
  const key = `attachments/${userId}/${crypto.randomUUID()}`;
  const upload = await storage.createPrivateUpload({ key, contentType, size, userId: String(userId) });
  const ticket = signUploadToken(
    { kind: 'ticket', purpose: 'attachment', key, userId: String(userId), name, type: contentType, size },
    '1h',
  );
  return { ...upload, ticket, maxBytes: FILE_TYPES[contentType].maxBytes };
}

/** Turns attachment tickets into stored attachments, checking each was issued to this user and uploaded. */
export async function resolveAttachments(userId, tickets = []) {
  const out = [];
  for (const ticket of tickets) {
    const t = verifyUploadToken(ticket, 'ticket');
    if (!t || t.purpose !== 'attachment' || t.userId !== String(userId)) {
      throw badRequest('BAD_TICKET', 'An attachment upload has expired. Please attach it again.');
    }
    if (!(await storage.exists(t.key)))
      throw badRequest('UPLOAD_MISSING', 'We could not find an attached file.');
    out.push({ key: t.key, name: t.name, type: t.type, size: t.size });
  }
  return out.length ? out : undefined;
}

/** Adds short-lived download links to the attachments of serialized messages. */
export async function withAttachmentUrls(dto) {
  if (!dto.messages) return dto;
  dto.messages = await Promise.all(
    dto.messages.map(async (m) => ({
      ...m,
      attachments: m.attachments
        ? await Promise.all(
            m.attachments.map(async (a) => ({
              name: a.name ?? null,
              type: a.type,
              size: a.size ?? null,
              // Opened inline (images, PDFs and videos all display in the browser).
              url: await storage.privateUrl(a.key, { expiresIn: '30m' }),
            })),
          )
        : [],
    })),
  );
  return dto;
}
