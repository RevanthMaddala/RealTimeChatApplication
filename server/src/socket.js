import { Server } from 'socket.io';
import { config } from './config.js';
import { verifyAccessToken } from './auth.js';
import { rooms, messages, users, attachments, publicUser } from './db.js';
import { serializeMessage } from './serialize.js';
import { addConnection, removeConnection, onlineUserIds } from './presence.js';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_ATTACHMENTS = 10;
const RATE_WINDOW_MS = 5000;
const RATE_MAX_MESSAGES = 10;

function authError(code) {
  const err = new Error('unauthorized');
  err.data = { code };
  return err;
}

/** Disconnects the socket when its access token expires unless the client sends a fresh one first. */
function armExpiry(socket) {
  clearTimeout(socket.data.expiryTimer);
  const ms = Math.max(socket.data.exp * 1000 - Date.now(), 0);
  socket.data.expiryTimer = setTimeout(() => {
    socket.emit('auth:expired');
    socket.disconnect(true);
  }, ms);
}

function createRateLimiter() {
  const stamps = [];
  return () => {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > RATE_WINDOW_MS) stamps.shift();
    if (stamps.length >= RATE_MAX_MESSAGES) return false;
    stamps.push(now);
    return true;
  };
}

const safeAck = (ack) => (typeof ack === 'function' ? ack : () => {});

export function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigin, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || !token) return next(authError('NO_TOKEN'));
    try {
      const { user, sid, exp } = verifyAccessToken(token);
      Object.assign(socket.data, { userId: user.id, sid, exp });
      next();
    } catch (err) {
      next(authError(err.code ?? 'INVALID_TOKEN'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, sid } = socket.data;
    const allowMessage = createRateLimiter();
    armExpiry(socket);

    socket.join([`user:${userId}`, `session:${sid}`, ...rooms.listForUser(userId).map((r) => r.id)]);

    if (addConnection(userId, socket.id)) {
      socket.broadcast.emit('presence:update', { userId, online: true });
    }
    socket.emit('presence:init', { onlineUserIds: onlineUserIds() });

    socket.on('auth:refresh', (token, ack) => {
      ack = safeAck(ack);
      try {
        const next = verifyAccessToken(token);
        if (next.user.id !== userId) throw new Error('user mismatch');
        socket.data.exp = next.exp;
        armExpiry(socket);
        ack({ ok: true });
      } catch {
        ack({ ok: false });
        socket.disconnect(true);
      }
    });

    socket.on('message:send', (payload, ack) => {
      ack = safeAck(ack);
      const { roomId, text = '', clientId, attachmentIds = [] } = payload ?? {};
      const room = typeof roomId === 'string' ? rooms.findById(roomId) : null;
      if (!rooms.canAccess(room, userId)) return ack({ ok: false, error: 'Room not found' });
      if (typeof text !== 'string') return ack({ ok: false, error: 'Message must be text' });
      if (!Array.isArray(attachmentIds) || attachmentIds.length > MAX_ATTACHMENTS || !attachmentIds.every((a) => typeof a === 'string')) {
        return ack({ ok: false, error: `Up to ${MAX_ATTACHMENTS} attachments per message` });
      }
      const files = attachments.claimable([...new Set(attachmentIds)], { roomId: room.id, uploaderId: userId });
      if (files.length !== new Set(attachmentIds).size) return ack({ ok: false, error: 'One or more attachments are no longer available' });
      const body = text.trim();
      if (!body && files.length === 0) return ack({ ok: false, error: 'Message is empty' });
      if (body.length > MAX_MESSAGE_LENGTH) return ack({ ok: false, error: `Messages are limited to ${MAX_MESSAGE_LENGTH} characters` });
      if (!allowMessage()) return ack({ ok: false, error: "You're sending messages too quickly" });

      const stored = messages.create({ roomId: room.id, userId, text: body, attachmentIds: files.map((f) => f.id) });
      attachments.linkToMessage(files, stored.id);
      const message = serializeMessage(stored);
      const echoId = typeof clientId === 'string' ? clientId.slice(0, 64) : undefined;
      io.to(room.id).emit('message:new', { ...message, clientId: echoId });
      ack({ ok: true, message });
    });

    socket.on('typing', (payload) => {
      const { roomId, isTyping } = payload ?? {};
      if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) return;
      socket.to(roomId).emit('typing', { roomId, userId, isTyping: Boolean(isTyping) });
    });

    socket.on('disconnect', () => {
      clearTimeout(socket.data.expiryTimer);
      if (removeConnection(userId, socket.id)) {
        const user = users.touchLastSeen(userId);
        io.emit('presence:update', { userId, online: false, lastSeenAt: user ? publicUser(user).lastSeenAt : Date.now() });
      }
    });
  });

  return io;
}
