import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = process.env.NODE_ENV === 'production';

let accessSecret = process.env.JWT_ACCESS_SECRET;
if (!accessSecret) {
  if (isProd) throw new Error('JWT_ACCESS_SECRET must be set in production');
  // Dev convenience: a random secret means access tokens die on restart, but
  // refresh cookies (stored server-side) still restore the session transparently.
  accessSecret = crypto.randomBytes(48).toString('base64url');
  console.warn('[config] JWT_ACCESS_SECRET not set - using a random per-process secret');
}

export const config = {
  isProd,
  port: Number(process.env.PORT) || 4000,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  accessSecret,
  accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTtlMs: (Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 7) * 24 * 60 * 60 * 1000,
  dataFile: path.resolve(rootDir, process.env.DATA_FILE || './data/db.json'),
  uploadsDir: path.resolve(rootDir, process.env.UPLOADS_DIR || './data/uploads'),
  clientDist: path.resolve(rootDir, '../client/dist'),
};
