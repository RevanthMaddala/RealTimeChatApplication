// Tiny JSON-file persistence layer. Everything lives in memory and is flushed
// to disk (atomically, debounced) after each write. Swap this module for
// MongoDB/Postgres without touching the routes or socket handlers.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const DEFAULT_ROOMS = [
  { id: 'general', name: 'general', description: 'Company-wide announcements and chatter' },
  { id: 'random', name: 'random', description: 'Off-topic, memes and everything else' },
  { id: 'help', name: 'help', description: 'Ask questions, get answers' },
];

function load() {
  try {
    return JSON.parse(fs.readFileSync(config.dataFile, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return {
      users: [],
      sessions: [],
      rooms: DEFAULT_ROOMS.map((r) => ({ ...r, type: 'public', createdBy: null, createdAt: Date.now() })),
      messages: {},
      attachments: [],
      passwordResets: [],
    };
  }
}

const data = load();
data.attachments ??= []; // stores created before attachments existed
data.passwordResets ??= []; // ...or password resets

let saveTimer = null;
function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
  const tmp = `${config.dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, config.dataFile);
}
function persist() {
  if (!saveTimer) saveTimer = setTimeout(writeNow, 100);
}
// Session changes are written before the response goes out: if the process died inside
// the debounce window after a refresh-token rotation, the browser would hold a cookie the
// store never saw, and the next refresh would be treated as token theft.
const persistNow = writeNow;
export function flush() {
  if (saveTimer) writeNow();
}

const id = () => crypto.randomUUID();

export function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.displayName, lastSeenAt: u.lastSeenAt ?? null };
}

export const users = {
  findById: (userId) => data.users.find((u) => u.id === userId),
  findByUsername: (username) => {
    const needle = username.toLowerCase();
    return data.users.find((u) => u.username.toLowerCase() === needle);
  },
  /** Emails are stored lower-cased, so callers pass a normalised address. */
  findByEmail: (email) => data.users.find((u) => u.email === email),
  all: () => data.users,
  create({ username, displayName, email, passwordHash }) {
    const user = { id: id(), username, displayName, email, passwordHash, createdAt: Date.now(), lastSeenAt: null };
    data.users.push(user);
    persist();
    return user;
  },
  setEmail(user, email) {
    user.email = email;
    persistNow();
  },
  setPassword(user, passwordHash) {
    user.passwordHash = passwordHash;
    persistNow();
  },
  touchLastSeen(userId) {
    const u = users.findById(userId);
    if (u) {
      u.lastSeenAt = Date.now();
      persist();
    }
    return u;
  },
};

export const sessions = {
  findById: (sid) => data.sessions.find((s) => s.id === sid),
  create({ userId, tokenHash, userAgent }) {
    const now = Date.now();
    const session = {
      id: id(),
      userId,
      tokenHash,
      prevTokenHash: null,
      rotatedAt: now,
      userAgent: String(userAgent ?? '').slice(0, 200),
      createdAt: now,
      expiresAt: now + config.refreshTtlMs,
      revokedAt: null,
    };
    data.sessions.push(session);
    persistNow();
    return session;
  },
  rotate(session, tokenHash) {
    session.prevTokenHash = session.tokenHash;
    session.tokenHash = tokenHash;
    session.rotatedAt = Date.now();
    session.expiresAt = Date.now() + config.refreshTtlMs;
    persistNow();
  },
  revoke(session) {
    session.revokedAt = Date.now();
    persistNow();
  },
  /** Revokes every live session for a user and returns them (so callers can drop their sockets). */
  revokeAllForUser(userId) {
    const now = Date.now();
    const live = data.sessions.filter((s) => s.userId === userId && sessions.isActive(s));
    for (const s of live) s.revokedAt = now;
    if (live.length) persistNow();
    return live;
  },
  isActive: (s) => Boolean(s) && !s.revokedAt && s.expiresAt > Date.now(),
  pruneExpired() {
    const before = data.sessions.length;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    data.sessions = data.sessions.filter((s) => s.expiresAt > cutoff && !(s.revokedAt && s.revokedAt < cutoff));
    if (data.sessions.length !== before) persist();
  },
};

// Only the SHA-256 of a reset token is stored, so a leaked db file can't be used to reset passwords.
export const passwordResets = {
  /** Issues a new token for the user, replacing any earlier one so only the latest emailed link works. */
  create({ userId, tokenHash, ttlMs }) {
    const now = Date.now();
    data.passwordResets = data.passwordResets.filter((r) => r.userId !== userId);
    const reset = { id: id(), userId, tokenHash, createdAt: now, expiresAt: now + ttlMs };
    data.passwordResets.push(reset);
    persistNow();
    return reset;
  },
  findLiveByHash: (tokenHash) => data.passwordResets.find((r) => r.tokenHash === tokenHash && r.expiresAt > Date.now()),
  consume(reset) {
    data.passwordResets = data.passwordResets.filter((r) => r.userId !== reset.userId);
    persistNow();
  },
  pruneExpired() {
    const before = data.passwordResets.length;
    data.passwordResets = data.passwordResets.filter((r) => r.expiresAt > Date.now());
    if (data.passwordResets.length !== before) persist();
  },
};

export const rooms = {
  findById: (roomId) => data.rooms.find((r) => r.id === roomId),
  findByName: (name) => data.rooms.find((r) => r.type === 'public' && r.name === name),
  canAccess: (room, userId) => Boolean(room) && (room.type === 'public' || room.members.includes(userId)),
  listForUser: (userId) => data.rooms.filter((r) => rooms.canAccess(r, userId)),
  createPublic({ name, description, createdBy }) {
    const room = { id: id(), name, description, type: 'public', createdBy, createdAt: Date.now() };
    data.rooms.push(room);
    persist();
    return room;
  },
  getOrCreateDm(userA, userB) {
    const members = [userA, userB].sort();
    const roomId = `dm:${members.join(':')}`;
    let room = rooms.findById(roomId);
    if (room) return { room, created: false };
    room = { id: roomId, name: null, description: '', type: 'dm', members, createdBy: userA, createdAt: Date.now() };
    data.rooms.push(room);
    persist();
    return { room, created: true };
  },
};

export const messages = {
  create({ roomId, userId, text, attachmentIds = [] }) {
    const message = { id: id(), roomId, userId, text, attachmentIds, createdAt: Date.now() };
    (data.messages[roomId] ??= []).push(message);
    persist();
    return message;
  },
  /** Oldest-first page of up to `limit` messages that precede message `beforeId` (or the latest ones). */
  page(roomId, { beforeId, limit }) {
    const all = data.messages[roomId] ?? [];
    let end = all.length;
    if (beforeId) end = Math.max(0, all.findIndex((m) => m.id === beforeId));
    const start = Math.max(0, end - limit);
    return { items: all.slice(start, end), hasMore: start > 0 };
  },
  lastInRoom: (roomId) => data.messages[roomId]?.at(-1) ?? null,
};

export const attachments = {
  findById: (attachmentId) => data.attachments.find((a) => a.id === attachmentId),
  create({ id: attachmentId, roomId, uploaderId, name, mime, size, kind }) {
    const attachment = { id: attachmentId, roomId, uploaderId, name, mime, size, kind, messageId: null, createdAt: Date.now() };
    data.attachments.push(attachment);
    persist();
    return attachment;
  },
  /** Uploads this user made in this room that haven't been sent in a message yet. */
  claimable(ids, { roomId, uploaderId }) {
    return ids.map((aid) => attachments.findById(aid)).filter((a) => a && a.roomId === roomId && a.uploaderId === uploaderId && !a.messageId);
  },
  linkToMessage(list, messageId) {
    for (const a of list) a.messageId = messageId;
    persist();
  },
  removeOrphans(olderThan) {
    const orphans = data.attachments.filter((a) => !a.messageId && a.createdAt < olderThan);
    if (orphans.length) {
      data.attachments = data.attachments.filter((a) => !orphans.includes(a));
      persist();
    }
    return orphans;
  },
};
