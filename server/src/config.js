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
  // Public URL of the app, used to build links in emails.
  appUrl: (process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, ''),
  resetTtlMs: (Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 30) * 60 * 1000,
  // Without SMTP_HOST, emails are printed to the server console instead of sent (dev only).
  smtp: process.env.SMTP_HOST
    ? {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      }
    : null,
  mailFrom: process.env.MAIL_FROM || 'Relay <no-reply@localhost>',
};

if (isProd && !config.smtp) throw new Error('SMTP_HOST must be set in production so password reset emails can be sent');
