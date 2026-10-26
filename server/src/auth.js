// Auth model:
//  - Access token: short-lived HS256 JWT (default 15 min), sent as a Bearer header
//    and in the Socket.io handshake. Kept in memory on the client, never in storage.
//  - Refresh token: opaque random secret in an httpOnly, SameSite=Strict cookie
//    scoped to /api/auth. Only its SHA-256 hash is stored server-side, it is
//    rotated on every use, and presenting a stale one revokes the whole session.
//  - Every access token carries its session id, so logout/revocation takes effect
//    immediately for HTTP requests and connected sockets alike.
//  - Media token: <img>/<video> tags can't send a Bearer header, so attachments are
//    authorised by a separate JWT (audience "media") in an httpOnly cookie scoped to
//    /api/attachments. It's refreshed alongside the access token and is useless as one.
//  - Password reset: a random single-use token, emailed as a link and stored only as a
//    SHA-256 hash, expiring after config.resetTtlMs. Using it revokes every session.
import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { users, sessions, passwordResets, publicUser } from './db.js';
import { sendPasswordResetMail } from './mailer.js';

const REFRESH_COOKIE = 'rt_refresh';
const MEDIA_COOKIE = 'rt_media';
const MEDIA_PATH = '/api/attachments';
const MEDIA_TTL_SECONDS = 60 * 60;
const ROTATION_GRACE_MS = 10_000; // lets two tabs refresh concurrently without tripping reuse detection
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 12);

export class AuthError extends Error {
  constructor(code, message = 'Unauthorized', status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

function signAccessToken(user, sid) {
  return jwt.sign({ sub: user.id, username: user.username, sid }, config.accessSecret, {
    algorithm: 'HS256',
    expiresIn: config.accessTtl,
    issuer: 'rt-chat',
    audience: 'api',
  });
}

function signMediaToken(user, sid) {
  return jwt.sign({ sub: user.id, sid }, config.accessSecret, {
    algorithm: 'HS256',
    expiresIn: MEDIA_TTL_SECONDS,
    issuer: 'rt-chat',
    audience: 'media',
  });
}

/** Validates the JWT *and* that its session is still live. Returns { user, sid, exp }. */
export function verifyAccessToken(token, audience = 'api') {
  let payload;
  try {
    payload = jwt.verify(token, config.accessSecret, { algorithms: ['HS256'], issuer: 'rt-chat', audience });
  } catch (err) {
    throw new AuthError(err instanceof jwt.TokenExpiredError ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
  }
  const session = sessions.findById(payload.sid);
  if (!sessions.isActive(session) || session.userId !== payload.sub) throw new AuthError('SESSION_REVOKED');
  const user = users.findById(payload.sub);
  if (!user) throw new AuthError('INVALID_TOKEN');
  return { user, sid: payload.sid, exp: payload.exp };
}

export function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(new AuthError('NO_TOKEN'));
  try {
    const { user, sid } = verifyAccessToken(token);
    req.user = user;
    req.sid = sid;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireMediaCookie(req, _res, next) {
  const token = req.cookies?.[MEDIA_COOKIE];
  if (typeof token !== 'string') return next(new AuthError('NO_TOKEN'));
  try {
    req.user = verifyAccessToken(token, 'media').user;
    next();
  } catch (err) {
    next(err);
  }
}

function newRefreshSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function setRefreshCookie(res, sid, secret) {
  res.cookie(REFRESH_COOKIE, `${sid}.${secret}`, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: config.refreshTtlMs,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: '/api/auth' });
  res.clearCookie(MEDIA_COOKIE, { httpOnly: true, secure: config.isProd, sameSite: 'strict', path: MEDIA_PATH });
}

/** Sets both cookies and returns the response body for login/register/refresh. */
function issueTokens(res, user, sid, refreshSecret) {
  setRefreshCookie(res, sid, refreshSecret);
  res.cookie(MEDIA_COOKIE, signMediaToken(user, sid), {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: MEDIA_PATH,
    maxAge: MEDIA_TTL_SECONDS * 1000,
  });
  return { user: publicUser(user), accessToken: signAccessToken(user, sid) };
}

function startSession(req, res, user) {
  const secret = newRefreshSecret();
  const session = sessions.create({ userId: user.id, tokenHash: sha256(secret).toString('hex'), userAgent: req.get('user-agent') });
  return issueTokens(res, user, session.id, secret);
}

function parseRefreshCookie(req) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw !== 'string') return null;
  const dot = raw.indexOf('.');
  if (dot < 1) return null;
  return { sid: raw.slice(0, dot), secret: raw.slice(dot + 1) };
}

const hashMatches = (hex, secret) => {
  if (!hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = sha256(secret);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later', code: 'RATE_LIMITED' },
});

// Reset requests send email, so they get a much tighter budget than sign-in attempts.
const resetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reset requests, please try again later', code: 'RATE_LIMITED' },
});

function readCredentials(body) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  return { username, password };
}

const readEmail = (body) => (typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '');
const isValidEmail = (email) => email.length <= 254 && EMAIL_RE.test(email);
const isValidPassword = (password) => password.length >= 8 && password.length <= 128;
const PASSWORD_RULE = 'Password must be 8-128 characters';

/** Revokes all of a user's sessions and disconnects their sockets. */
function endAllSessions(req, userId) {
  const io = req.app.get('io');
  for (const s of sessions.revokeAllForUser(userId)) io?.in(`session:${s.id}`).disconnectSockets(true);
}

export const authRouter = express.Router();

authRouter.post(
  '/register',
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = readCredentials(req.body);
    const email = readEmail(req.body);
    const displayName = (typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '') || username;
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 letters, numbers or underscores' });
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!isValidPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });
    if (displayName.length > 40) return res.status(400).json({ error: 'Display name must be at most 40 characters' });
    if (users.findByUsername(username)) return res.status(409).json({ error: 'That username is taken' });
    if (users.findByEmail(email)) return res.status(409).json({ error: 'That email is already used by another account' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = users.create({ username, displayName, email, passwordHash });
    req.app.get('io')?.emit('user:new', publicUser(user));
    res.status(201).json(startSession(req, res, user));
  }),
);

authRouter.post(
  '/login',
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = readCredentials(req.body);
    const user = username ? users.findByUsername(username) : null;
    // Always run bcrypt so response time doesn't reveal whether the username exists.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ error: 'Invalid username or password', code: 'BAD_CREDENTIALS' });
    res.json(startSession(req, res, user));
  }),
);

authRouter.post('/refresh', (req, res, next) => {
  const parsed = parseRefreshCookie(req);
  const session = parsed && sessions.findById(parsed.sid);
  if (!sessions.isActive(session)) {
    clearRefreshCookie(res);
    return next(new AuthError('NO_SESSION', 'Session expired, please sign in again'));
  }

  const current = hashMatches(session.tokenHash, parsed.secret);
  const recentPrev = !current && Date.now() - session.rotatedAt < ROTATION_GRACE_MS && hashMatches(session.prevTokenHash, parsed.secret);
  if (!current && !recentPrev) {
    // A rotated-out token was replayed: assume it was stolen and kill the session.
    sessions.revoke(session);
    req.app.get('io')?.in(`session:${session.id}`).disconnectSockets(true);
    clearRefreshCookie(res);
    return next(new AuthError('TOKEN_REUSE', 'Session expired, please sign in again'));
  }

  const user = users.findById(session.userId);
  if (!user) return next(new AuthError('NO_SESSION'));
  const secret = newRefreshSecret();
  sessions.rotate(session, sha256(secret).toString('hex'));
  res.json(issueTokens(res, user, session.id, secret));
});

authRouter.post('/logout', (req, res) => {
  const parsed = parseRefreshCookie(req);
  const session = parsed && sessions.findById(parsed.sid);
  if (session && hashMatches(session.tokenHash, parsed.secret) && !session.revokedAt) {
    sessions.revoke(session);
    req.app.get('io')?.in(`session:${session.id}`).disconnectSockets(true);
  }
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), email: req.user.email ?? null });
});

// Lets a signed-in user add or change their recovery email. Requires the current
// password so a hijacked session can't redirect password resets to an attacker.
authRouter.put(
  '/email',
  credentialLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    const email = readEmail(req.body);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (!(await bcrypt.compare(password, req.user.passwordHash))) {
      return res.status(403).json({ error: 'Current password is incorrect', code: 'BAD_CREDENTIALS' });
    }
    const owner = users.findByEmail(email);
    if (owner && owner.id !== req.user.id) return res.status(409).json({ error: 'That email is already used by another account' });
    users.setEmail(req.user, email);
    res.json({ email });
  }),
);

// Always answers the same way, whether or not the address belongs to an account, and
// does the lookup + send after responding so timing doesn't give that away either.
authRouter.post('/forgot-password', resetRequestLimiter, (req, res) => {
  const email = readEmail(req.body);
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  res.status(202).json({ ok: true });

  setImmediate(() => {
    const user = users.findByEmail(email);
    if (!user) return;
    const token = crypto.randomBytes(32).toString('base64url');
    passwordResets.create({ userId: user.id, tokenHash: sha256(token).toString('hex'), ttlMs: config.resetTtlMs });
    // The token goes in the fragment, which browsers never send to servers or in Referer headers.
    sendPasswordResetMail(user, `${config.appUrl}/reset-password#token=${token}`).catch((err) =>
      console.error('[mail] password reset email failed', err),
    );
  });
});

authRouter.post(
  '/reset-password',
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const reset = token && passwordResets.findLiveByHash(sha256(token).toString('hex'));
    const user = reset && users.findById(reset.userId);
    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.', code: 'RESET_INVALID' });
    }
    if (!isValidPassword(password)) return res.status(400).json({ error: PASSWORD_RULE });

    // Consume before the slow hash so the same link can't be raced into two resets.
    passwordResets.consume(reset);
    users.setPassword(user, await bcrypt.hash(password, 12));
    endAllSessions(req, user.id);
    res.json(startSession(req, res, user));
  }),
);
