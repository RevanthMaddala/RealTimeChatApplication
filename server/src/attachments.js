// File attachments.
//
// Upload: POST /api/rooms/:roomId/attachments, raw body, filename in X-File-Name.
// The body is streamed to disk (never fully buffered), capped at MAX_BYTES, then the
// real type is sniffed from the file's magic bytes. A file is accepted only when its
// detected type is on the allowlist AND its extension agrees with that type, so a
// renamed executable or an HTML page called "photo.png" is rejected.
//
// Download: GET /api/attachments/:id, authorised by the httpOnly media cookie and room
// membership. Files are always served with `Content-Disposition: attachment`, nosniff
// and a sandboxing CSP, so even a hostile file can never render as a page on our origin.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { attachments, rooms } from './db.js';

export const MAX_BYTES = 25 * 1024 * 1024;
const SNIFF_BYTES = 64;

/** Allowlist: detected MIME type -> how it renders + the extensions that may carry it. */
const TYPES = {
  'image/png': { kind: 'image', exts: ['png'] },
  'image/jpeg': { kind: 'image', exts: ['jpg', 'jpeg'] },
  'image/gif': { kind: 'image', exts: ['gif'] },
  'image/webp': { kind: 'image', exts: ['webp'] },
  'video/mp4': { kind: 'video', exts: ['mp4', 'm4v'] },
  'video/webm': { kind: 'video', exts: ['webm'] },
  'video/quicktime': { kind: 'video', exts: ['mov'] },
  'audio/mpeg': { kind: 'audio', exts: ['mp3'] },
  'audio/mp4': { kind: 'audio', exts: ['m4a'] },
  'audio/ogg': { kind: 'audio', exts: ['ogg', 'oga', 'opus'] },
  'audio/wav': { kind: 'audio', exts: ['wav'] },
  'application/pdf': { kind: 'file', exts: ['pdf'] },
  'application/msword': { kind: 'file', exts: ['doc'] },
  'application/vnd.ms-excel': { kind: 'file', exts: ['xls'] },
  'application/vnd.ms-powerpoint': { kind: 'file', exts: ['ppt'] },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'file', exts: ['docx'] },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'file', exts: ['xlsx'] },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { kind: 'file', exts: ['pptx'] },
  'text/plain': { kind: 'file', exts: ['txt', 'md', 'log'] },
  'text/csv': { kind: 'file', exts: ['csv'] },
  'application/zip': { kind: 'file', exts: ['zip'] },
};
const ALLOWED_EXTS = new Set(Object.values(TYPES).flatMap((t) => t.exts));
const TEXT_EXT_TO_MIME = { txt: 'text/plain', md: 'text/plain', log: 'text/plain', csv: 'text/csv' };
const OOXML = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const OLE = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };
// Called out explicitly so users get a clear "blocked" message rather than "unsupported".
const BLOCKED_EXTS = new Set([
  'html', 'htm', 'xhtml', 'shtml', 'svg', 'svgz', 'xml', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'vbs', 'vbe', 'wsf', 'hta',
  'exe', 'msi', 'msix', 'dll', 'scr', 'com', 'cpl', 'bat', 'cmd', 'ps1', 'psm1', 'sh', 'bash', 'zsh', 'py', 'pl',
  'rb', 'php', 'jar', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'lnk', 'reg', 'iso', 'swf',
]);

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/** Identify a file from its leading bytes. Returns a MIME type from TYPES or null. */
function sniff(head, ext) {
  const ascii = (from, to) => head.toString('latin1', from, to);
  const startsWith = (bytes) => bytes.every((b, i) => head[i] === b);

  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'qt  ') return 'video/quicktime';
    return brand.startsWith('M4A') || brand.startsWith('M4B') || ext === 'm4a' ? 'audio/mp4' : 'video/mp4';
  }
  if (startsWith([0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  // ZIP container: docx/xlsx/pptx are zips too, so the extension picks the specific type.
  if (ascii(0, 4) === 'PK\x03\x04' || ascii(0, 4) === 'PK\x05\x06') return OOXML[ext] ?? 'application/zip';
  // Legacy Office (OLE compound file).
  if (startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return OLE[ext] ?? null;
  return null;
}

/** Plain text has no magic number: require valid UTF-8 with no NUL bytes. */
async function sniffText(filePath, ext) {
  const mime = TEXT_EXT_TO_MIME[ext];
  if (!mime) return null;
  const buf = await fsp.readFile(filePath);
  if (buf.includes(0)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return mime;
  } catch {
    return null;
  }
}

function sanitizeName(raw) {
  let name;
  try {
    name = decodeURIComponent(String(raw ?? ''));
  } catch {
    return '';
  }
  name = name
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_') // path separators, control and reserved chars
    .replace(/^[.\s]+|[.\s]+$/g, '') // no leading dots (hidden files) or trailing dots/spaces
    .slice(-200);
  return name;
}

/** Pass-through stream that errors as soon as more than `max` bytes flow through. */
function byteLimiter(max) {
  let total = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > max) return cb(Object.assign(new Error('File too large'), { status: 413 }));
      cb(null, chunk);
    },
  });
}

const uploadsDir = () => config.uploadsDir;
const filePathFor = (id) => path.join(uploadsDir(), id);

export function serializeAttachment(a) {
  return { id: a.id, name: a.name, mime: a.mime, size: a.size, kind: a.kind, url: `/api/attachments/${a.id}` };
}

const reject = (res, status, error) => res.status(status).set('Connection', 'close').json({ error });

export const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 40,
  keyGenerator: (req) => req.user.id,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many uploads, please wait a few minutes', code: 'RATE_LIMITED' },
});

export async function handleUpload(req, res, next) {
  const room = rooms.findById(req.params.roomId);
  if (!rooms.canAccess(room, req.user.id)) return reject(res, 404, 'Room not found');

  const name = sanitizeName(req.get('x-file-name'));
  if (!name) return reject(res, 400, 'Missing file name');
  const ext = extOf(name);
  if (BLOCKED_EXTS.has(ext)) return reject(res, 415, `.${ext} files are blocked for security reasons`);
  if (!ALLOWED_EXTS.has(ext)) return reject(res, 415, ext ? `.${ext} files aren't supported` : 'Files need an extension');
  const declared = Number(req.get('content-length'));
  if (declared > MAX_BYTES) return reject(res, 413, 'Files are limited to 25 MB');

  const id = crypto.randomUUID();
  const partPath = `${filePathFor(id)}.part`;
  try {
    await fsp.mkdir(uploadsDir(), { recursive: true });
    await pipeline(req, byteLimiter(MAX_BYTES), fs.createWriteStream(partPath, { flags: 'wx' }));
    const { size } = await fsp.stat(partPath);
    if (size === 0) throw Object.assign(new Error('File is empty'), { status: 400 });

    const handle = await fsp.open(partPath, 'r');
    const head = Buffer.alloc(SNIFF_BYTES);
    await handle.read(head, 0, SNIFF_BYTES, 0);
    await handle.close();

    const mime = sniff(head, ext) ?? (await sniffText(partPath, ext));
    if (!mime || !TYPES[mime].exts.includes(ext)) {
      throw Object.assign(new Error("The file's contents don't match its extension or aren't an allowed type"), { status: 415 });
    }

    await fsp.rename(partPath, filePathFor(id));
    const attachment = attachments.create({ id, roomId: room.id, uploaderId: req.user.id, name, mime, size, kind: TYPES[mime].kind });
    res.status(201).json({ attachment: serializeAttachment(attachment) });
  } catch (err) {
    await fsp.rm(partPath, { force: true }).catch(() => {});
    if (err.status) return reject(res, err.status, err.message === 'File too large' ? 'Files are limited to 25 MB' : err.message);
    if (err.code === 'ERR_STREAM_PREMATURE_CLOSE' || err.code === 'ECONNRESET') return; // client cancelled
    next(err);
  }
}

export function handleDownload(req, res, next) {
  const a = attachments.findById(req.params.id);
  const room = a && rooms.findById(a.roomId);
  // Members of the room can see attached files; the uploader can also see their own pending upload.
  const visible = a && rooms.canAccess(room, req.user.id) && (a.messageId || a.uploaderId === req.user.id);
  if (!visible) return res.status(404).json({ error: 'File not found' });

  res.set({
    'Content-Type': a.mime,
    'Content-Disposition': `attachment; filename="${a.name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=86400, immutable',
  });
  // sendFile handles Range requests, so video/audio can seek and stream.
  res.sendFile(filePathFor(a.id), { headers: { 'Content-Type': a.mime } }, (err) => {
    if (err && !res.headersSent) next(err);
  });
}

/** Removes uploads that were never attached to a message. */
export async function pruneOrphanUploads(maxAgeMs = 60 * 60 * 1000) {
  for (const a of attachments.removeOrphans(Date.now() - maxAgeMs)) {
    await fsp.rm(filePathFor(a.id), { force: true }).catch(() => {});
  }
}
