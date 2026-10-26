import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRouter, requireAuth, requireMediaCookie } from './auth.js';
import { apiRouter } from './api.js';
import { handleDownload, pruneOrphanUploads } from './attachments.js';
import { initSocket } from './socket.js';
import { flush, sessions, passwordResets } from './db.js';

const app = express();
if (config.isProd) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      // blob: lets the composer preview a picked file before it's uploaded.
      directives: { imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'] },
    },
  }),
);
app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.get('/api/attachments/:id', requireMediaCookie, handleDownload);
app.use('/api', requireAuth, apiRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// In production the server also hosts the built React app (single origin = no CORS, strict cookies just work).
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message, code: err.code });
});

const server = http.createServer(app);
app.set('io', initSocket(server));

const housekeeping = () => {
  sessions.pruneExpired();
  passwordResets.pruneExpired();
  pruneOrphanUploads().catch((err) => console.error('[uploads] prune failed', err));
};
housekeeping();
setInterval(housekeeping, 15 * 60 * 1000).unref();

server.listen(config.port, () => {
  console.log(`[server] listening on http://localhost:${config.port}`);
});

process.on('exit', flush);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
