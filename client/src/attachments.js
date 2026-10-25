// Client-side mirror of the server allowlist, used for the file picker filter and
// instant feedback. The server re-checks every upload by content, so this is UX only.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE = 10;

const ALLOWED_EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'mp4', 'm4v', 'webm', 'mov',
  'mp3', 'm4a', 'ogg', 'oga', 'opus', 'wav',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'log', 'csv', 'zip',
];

export const ACCEPT = ALLOWED_EXTS.map((e) => `.${e}`).join(',');

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

/** Returns an error message if the file obviously can't be uploaded, otherwise null. */
export function precheck(file) {
  const ext = extOf(file.name);
  if (!ALLOWED_EXTS.includes(ext)) return ext ? `.${ext} files aren't allowed` : 'Files need an extension';
  if (file.size > MAX_FILE_BYTES) return 'Files are limited to 25 MB';
  if (file.size === 0) return 'File is empty';
  return null;
}

export function previewKind(file) {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Short label for the file-card icon, e.g. "PDF", "XLSX". */
export const fileBadge = (name) => (extOf(name) || 'file').slice(0, 4).toUpperCase();
