// The file types the platform accepts, with their size limits and a check of the
// first bytes so a renamed file cannot pass as another type.

const MB = 1024 * 1024;

export const FILE_TYPES = {
  'image/jpeg': { ext: 'jpg', kind: 'image', maxBytes: 5 * MB, magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': {
    ext: 'png',
    kind: 'image',
    maxBytes: 5 * MB,
    magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  'image/webp': {
    ext: 'webp',
    kind: 'image',
    maxBytes: 5 * MB,
    magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  },
  'application/pdf': {
    ext: 'pdf',
    kind: 'pdf',
    maxBytes: 10 * MB,
    magic: (b) => b.subarray(0, 5).toString() === '%PDF-',
  },
  'video/mp4': {
    ext: 'mp4',
    kind: 'video',
    maxBytes: 25 * MB,
    magic: (b) => b.subarray(4, 8).toString() === 'ftyp',
  },
  'video/webm': {
    ext: 'webm',
    kind: 'video',
    maxBytes: 25 * MB,
    magic: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  },
};

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Support ticket attachments: images, PDFs and short videos. */
export const ATTACHMENT_TYPES = Object.keys(FILE_TYPES);
/** The largest file of any accepted type. */
export const MAX_FILE_BYTES = Math.max(...Object.values(FILE_TYPES).map((t) => t.maxBytes));
