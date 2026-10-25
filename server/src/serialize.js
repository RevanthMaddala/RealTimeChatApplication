import { users, messages, attachments, publicUser } from './db.js';
import { serializeAttachment } from './attachments.js';

export function serializeMessage(m) {
  const author = users.findById(m.userId);
  return {
    id: m.id,
    roomId: m.roomId,
    text: m.text,
    attachments: (m.attachmentIds ?? [])
      .map((id) => attachments.findById(id))
      .filter(Boolean)
      .map(serializeAttachment),
    createdAt: m.createdAt,
    author: author ? { id: author.id, username: author.username, displayName: author.displayName } : null,
  };
}

/** DMs are rendered relative to the viewer, so the "name" is the other participant. */
export function serializeRoom(room, viewerId) {
  const last = messages.lastInRoom(room.id);
  const base = {
    id: room.id,
    type: room.type,
    name: room.name,
    description: room.description,
    createdAt: room.createdAt,
    lastMessageAt: last?.createdAt ?? null,
  };
  if (room.type === 'dm') {
    const peerId = room.members.find((m) => m !== viewerId) ?? viewerId;
    const peer = users.findById(peerId);
    base.peer = peer ? publicUser(peer) : null;
    base.name = peer?.displayName ?? 'Unknown user';
  }
  return base;
}
