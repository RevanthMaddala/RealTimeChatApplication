// userId -> Set<socketId>. A user is online while at least one of their tabs/devices is connected.
const connections = new Map();

/** Returns true if this socket made the user go online. */
export function addConnection(userId, socketId) {
  let set = connections.get(userId);
  const wasOffline = !set;
  if (!set) connections.set(userId, (set = new Set()));
  set.add(socketId);
  return wasOffline;
}

/** Returns true if this socket was the user's last connection. */
export function removeConnection(userId, socketId) {
  const set = connections.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size > 0) return false;
  connections.delete(userId);
  return true;
}

export const isOnline = (userId) => connections.has(userId);
export const onlineUserIds = () => [...connections.keys()];
