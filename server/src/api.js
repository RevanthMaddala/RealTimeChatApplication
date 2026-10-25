import express from 'express';
import { users, rooms, messages, publicUser } from './db.js';
import { serializeMessage, serializeRoom } from './serialize.js';
import { isOnline } from './presence.js';
import { handleUpload, uploadLimiter } from './attachments.js';

const ROOM_NAME_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export const apiRouter = express.Router();

apiRouter.get('/rooms', (req, res) => {
  res.json({ rooms: rooms.listForUser(req.user.id).map((r) => serializeRoom(r, req.user.id)) });
});

apiRouter.post('/rooms', (req, res) => {
  const name = String(req.body?.name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  const description = String(req.body?.description ?? '').trim().slice(0, 140);
  if (!ROOM_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Room names are 2-32 chars: lowercase letters, numbers and dashes' });
  }
  if (rooms.findByName(name)) return res.status(409).json({ error: 'A room with that name already exists' });

  const room = rooms.createPublic({ name, description, createdBy: req.user.id });
  const io = req.app.get('io');
  io.socketsJoin(room.id);
  io.emit('room:created', serializeRoom(room, req.user.id));
  res.status(201).json({ room: serializeRoom(room, req.user.id) });
});

apiRouter.post('/dms', (req, res) => {
  const peer = users.findById(String(req.body?.userId ?? ''));
  if (!peer) return res.status(404).json({ error: 'User not found' });
  if (peer.id === req.user.id) return res.status(400).json({ error: "You can't DM yourself" });

  const { room, created } = rooms.getOrCreateDm(req.user.id, peer.id);
  if (created) {
    const io = req.app.get('io');
    for (const memberId of room.members) {
      io.in(`user:${memberId}`).socketsJoin(room.id);
      io.to(`user:${memberId}`).emit('room:created', serializeRoom(room, memberId));
    }
  }
  res.status(created ? 201 : 200).json({ room: serializeRoom(room, req.user.id) });
});

apiRouter.get('/rooms/:roomId/messages', (req, res) => {
  const room = rooms.findById(req.params.roomId);
  if (!rooms.canAccess(room, req.user.id)) return res.status(404).json({ error: 'Room not found' });
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const beforeId = typeof req.query.before === 'string' ? req.query.before : undefined;
  const { items, hasMore } = messages.page(room.id, { beforeId, limit });
  res.json({ messages: items.map(serializeMessage), hasMore });
});

apiRouter.post('/rooms/:roomId/attachments', uploadLimiter, handleUpload);

apiRouter.get('/users', (req, res) => {
  res.json({
    users: users
      .all()
      .map((u) => ({ ...publicUser(u), online: isOnline(u.id) }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName)),
  });
});
