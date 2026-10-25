import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { io } from 'socket.io-client';
import { api, getAccessToken, onTokenChange, refreshSession } from './api.js';
import { useAuth } from './AuthContext.jsx';

const ChatContext = createContext(null);
const TYPING_TTL_MS = 6000;
const DEFAULT_ROOM = 'general';

const initialState = {
  connection: 'connecting', // connecting | connected | reconnecting | offline
  rooms: {},
  users: {},
  online: {},
  messages: {}, // roomId -> { items, hasMore, status: idle|loading|loaded|error }
  activeRoomId: DEFAULT_ROOM,
  unread: {},
  typing: {}, // roomId -> { userId: true }
};

const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

function mergeMessages(existing, incoming) {
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  const confirmed = [...map.values()].filter((m) => !m.pending && !m.failed);
  const local = existing.filter((m) => (m.pending || m.failed) && !incoming.some((i) => i.clientId && i.clientId === m.clientId));
  return [...confirmed.sort((a, b) => a.createdAt - b.createdAt), ...local];
}

function withoutTyping(typing, roomId, userId) {
  if (!typing[roomId]?.[userId]) return typing;
  const { [userId]: _, ...rest } = typing[roomId];
  return { ...typing, [roomId]: rest };
}

function reducer(state, action) {
  switch (action.type) {
    case 'CONNECTION':
      return { ...state, connection: action.status };

    case 'DIRECTORY':
      return {
        ...state,
        rooms: { ...state.rooms, ...byId(action.rooms) },
        users: { ...state.users, ...byId(action.users) },
        online: { ...state.online, ...Object.fromEntries(action.users.filter((u) => u.online).map((u) => [u.id, true])) },
      };

    case 'ROOM_ADDED':
      return { ...state, rooms: { ...state.rooms, [action.room.id]: action.room } };

    case 'USER_ADDED':
      return { ...state, users: { ...state.users, [action.user.id]: action.user } };

    case 'PRESENCE_INIT':
      return { ...state, online: Object.fromEntries(action.ids.map((id) => [id, true])) };

    case 'PRESENCE_UPDATE': {
      const online = { ...state.online };
      if (action.online) online[action.userId] = true;
      else delete online[action.userId];
      const user = state.users[action.userId];
      const users = user && action.lastSeenAt ? { ...state.users, [user.id]: { ...user, lastSeenAt: action.lastSeenAt } } : state.users;
      return { ...state, online, users };
    }

    case 'SELECT_ROOM':
      return { ...state, activeRoomId: action.roomId, unread: { ...state.unread, [action.roomId]: 0 } };

    case 'CLEAR_UNREAD':
      return state.unread[action.roomId] ? { ...state, unread: { ...state.unread, [action.roomId]: 0 } } : state;

    case 'HISTORY_LOADING': {
      const prev = state.messages[action.roomId] ?? { items: [], hasMore: false };
      return { ...state, messages: { ...state.messages, [action.roomId]: { ...prev, status: 'loading' } } };
    }

    case 'HISTORY_LOADED': {
      const prev = state.messages[action.roomId] ?? { items: [], hasMore: false };
      const items = mergeMessages(prev.items, action.messages);
      // hasMore is only meaningful for the oldest page we've fetched.
      const hasMore = action.older || prev.status !== 'loaded' ? action.hasMore : prev.hasMore;
      return { ...state, messages: { ...state.messages, [action.roomId]: { items, hasMore, status: 'loaded' } } };
    }

    case 'HISTORY_ERROR': {
      const prev = state.messages[action.roomId] ?? { items: [], hasMore: false };
      return { ...state, messages: { ...state.messages, [action.roomId]: { ...prev, status: 'error' } } };
    }

    case 'MESSAGE_PENDING': {
      const prev = state.messages[action.message.roomId] ?? { items: [], hasMore: false, status: 'idle' };
      return {
        ...state,
        messages: { ...state.messages, [action.message.roomId]: { ...prev, items: [...prev.items, action.message] } },
      };
    }

    case 'MESSAGE_FAILED': {
      const prev = state.messages[action.roomId];
      if (!prev) return state;
      const items = prev.items.map((m) =>
        m.clientId === action.clientId && m.pending ? { ...m, pending: false, failed: true, error: action.error } : m,
      );
      return { ...state, messages: { ...state.messages, [action.roomId]: { ...prev, items } } };
    }

    case 'MESSAGE_DISCARD': {
      const prev = state.messages[action.roomId];
      if (!prev) return state;
      const items = prev.items.filter((m) => m.clientId !== action.clientId || !(m.failed || m.pending));
      return { ...state, messages: { ...state.messages, [action.roomId]: { ...prev, items } } };
    }

    case 'MESSAGE_RECEIVED': {
      const { message, countUnread } = action;
      const prev = state.messages[message.roomId] ?? { items: [], hasMore: false, status: 'idle' };
      if (prev.items.some((m) => m.id === message.id)) return state;
      const local = message.clientId ? prev.items.findIndex((m) => m.clientId === message.clientId && !m.id) : -1;
      const items = local === -1 ? [...prev.items, message] : prev.items.map((m, i) => (i === local ? message : m));
      const room = state.rooms[message.roomId];
      return {
        ...state,
        messages: { ...state.messages, [message.roomId]: { ...prev, items } },
        rooms: room ? { ...state.rooms, [room.id]: { ...room, lastMessageAt: message.createdAt } } : state.rooms,
        unread: countUnread ? { ...state.unread, [message.roomId]: (state.unread[message.roomId] ?? 0) + 1 } : state.unread,
        typing: message.author ? withoutTyping(state.typing, message.roomId, message.author.id) : state.typing,
      };
    }

    case 'TYPING':
      if (!action.isTyping) return { ...state, typing: withoutTyping(state.typing, action.roomId, action.userId) };
      return {
        ...state,
        typing: { ...state.typing, [action.roomId]: { ...state.typing[action.roomId], [action.userId]: true } },
      };

    default:
      return state;
  }
}

const makeClientId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function ChatProvider({ children }) {
  const { user } = useAuth();
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const socketRef = useRef(null);
  const typingTimers = useRef(new Map());

  const loadHistory = useCallback(async (roomId, { older = false } = {}) => {
    const current = stateRef.current.messages[roomId];
    if (current?.status === 'loading') return;
    const oldest = older ? current?.items.find((m) => m.id) : null;
    if (older && (!oldest || !current.hasMore)) return;
    dispatch({ type: 'HISTORY_LOADING', roomId });
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (oldest) qs.set('before', oldest.id);
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/messages?${qs}`);
      dispatch({ type: 'HISTORY_LOADED', roomId, messages: data.messages, hasMore: data.hasMore, older });
    } catch {
      dispatch({ type: 'HISTORY_ERROR', roomId });
    }
  }, []);

  const loadDirectory = useCallback(async () => {
    const [{ rooms }, { users }] = await Promise.all([api('/api/rooms'), api('/api/users')]);
    dispatch({ type: 'DIRECTORY', rooms, users });
    return rooms;
  }, []);

  // Socket lifecycle: one connection per signed-in provider.
  useEffect(() => {
    const socket = io({
      autoConnect: false,
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;
    let disposed = false;
    let everConnected = false;
    let authFailures = 0;

    // Called when the server rejected or dropped us for auth reasons: get a fresh
    // access token, then reconnect. If refresh 401s, AuthContext signs us out.
    const reauthenticate = () => {
      if (disposed) return;
      if (++authFailures > 3) return dispatch({ type: 'CONNECTION', status: 'offline' });
      dispatch({ type: 'CONNECTION', status: 'reconnecting' });
      refreshSession()
        .then(() => !disposed && socket.connect())
        .catch((err) => {
          if (err?.status !== 401 && !disposed) setTimeout(reauthenticate, 3000);
        });
    };

    socket.on('connect', () => {
      authFailures = 0;
      dispatch({ type: 'CONNECTION', status: 'connected' });
      if (everConnected) {
        // Catch up on anything missed while disconnected.
        loadDirectory().catch(() => {});
        for (const [roomId, entry] of Object.entries(stateRef.current.messages)) {
          if (entry.status === 'loaded') loadHistory(roomId);
        }
      }
      everConnected = true;
    });

    socket.on('disconnect', (reason) => {
      if (disposed) return;
      dispatch({ type: 'CONNECTION', status: 'reconnecting' });
      if (reason === 'io server disconnect') reauthenticate();
    });

    socket.on('connect_error', () => {
      dispatch({ type: 'CONNECTION', status: 'reconnecting' });
      // `active` means a transport problem Socket.io will retry by itself;
      // otherwise the auth middleware rejected the handshake.
      if (!socket.active) reauthenticate();
    });

    socket.on('message:new', (message) => {
      const s = stateRef.current;
      const mine = message.author?.id === user.id;
      const viewing = message.roomId === s.activeRoomId && document.visibilityState === 'visible';
      dispatch({ type: 'MESSAGE_RECEIVED', message, countUnread: !mine && !viewing });
    });

    socket.on('typing', ({ roomId, userId, isTyping }) => {
      const key = `${roomId}:${userId}`;
      clearTimeout(typingTimers.current.get(key));
      dispatch({ type: 'TYPING', roomId, userId, isTyping });
      if (isTyping) {
        typingTimers.current.set(
          key,
          setTimeout(() => dispatch({ type: 'TYPING', roomId, userId, isTyping: false }), TYPING_TTL_MS),
        );
      }
    });

    socket.on('presence:init', ({ onlineUserIds }) => dispatch({ type: 'PRESENCE_INIT', ids: onlineUserIds }));
    socket.on('presence:update', (p) => dispatch({ type: 'PRESENCE_UPDATE', ...p }));
    socket.on('room:created', (room) => dispatch({ type: 'ROOM_ADDED', room }));
    socket.on('user:new', (u) => dispatch({ type: 'USER_ADDED', user: { ...u, online: false } }));

    // Hand rotated access tokens to the live socket so the server extends its expiry.
    const offToken = onTokenChange((token) => {
      if (token && socket.connected) socket.emit('auth:refresh', token);
    });

    socket.connect();
    loadDirectory().catch(() => {});
    loadHistory(DEFAULT_ROOM);

    const timers = typingTimers.current;
    return () => {
      disposed = true;
      offToken();
      socket.removeAllListeners();
      socket.disconnect();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [user.id, loadDirectory, loadHistory]);

  // Clear the badge on the open room when the tab regains focus; show total unread in the title.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') dispatch({ type: 'CLEAR_UNREAD', roomId: stateRef.current.activeRoomId });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const totalUnread = Object.values(state.unread).reduce((a, b) => a + b, 0);
  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Relay Chat` : 'Relay Chat';
  }, [totalUnread]);

  const selectRoom = useCallback(
    (roomId) => {
      dispatch({ type: 'SELECT_ROOM', roomId });
      const entry = stateRef.current.messages[roomId];
      if (!entry || entry.status === 'idle' || entry.status === 'error') loadHistory(roomId);
    },
    [loadHistory],
  );

  const emitMessage = useCallback((roomId, text, clientId, attachments = []) => {
    const payload = { roomId, text, clientId, attachmentIds: attachments.map((a) => a.id) };
    socketRef.current.timeout(10_000).emit('message:send', payload, (err, res) => {
      if (err || !res?.ok) {
        dispatch({ type: 'MESSAGE_FAILED', roomId, clientId, error: err ? 'Timed out — tap to retry' : res.error });
      }
    });
  }, []);

  const sendMessage = useCallback(
    (text, attachments = []) => {
      const roomId = stateRef.current.activeRoomId;
      const clientId = makeClientId();
      dispatch({
        type: 'MESSAGE_PENDING',
        message: {
          clientId,
          roomId,
          text,
          attachments,
          createdAt: Date.now(),
          pending: true,
          author: { id: user.id, username: user.username, displayName: user.displayName },
        },
      });
      emitMessage(roomId, text, clientId, attachments);
    },
    [user, emitMessage],
  );

  const retryMessage = useCallback(
    (message) => {
      dispatch({ type: 'MESSAGE_DISCARD', roomId: message.roomId, clientId: message.clientId });
      const clientId = makeClientId();
      dispatch({ type: 'MESSAGE_PENDING', message: { ...message, clientId, failed: false, pending: true, error: null } });
      emitMessage(message.roomId, message.text, clientId, message.attachments);
    },
    [emitMessage],
  );

  const discardMessage = useCallback((message) => {
    dispatch({ type: 'MESSAGE_DISCARD', roomId: message.roomId, clientId: message.clientId });
  }, []);

  const setTyping = useCallback((roomId, isTyping) => {
    const socket = socketRef.current;
    if (socket?.connected) socket.volatile.emit('typing', { roomId, isTyping });
  }, []);

  const createRoom = useCallback(
    async (name, description) => {
      const { room } = await api('/api/rooms', { method: 'POST', body: { name, description } });
      dispatch({ type: 'ROOM_ADDED', room });
      selectRoom(room.id);
      return room;
    },
    [selectRoom],
  );

  const openDm = useCallback(
    async (userId) => {
      const { room } = await api('/api/dms', { method: 'POST', body: { userId } });
      dispatch({ type: 'ROOM_ADDED', room });
      selectRoom(room.id);
      return room;
    },
    [selectRoom],
  );

  const value = useMemo(
    () => ({
      ...state,
      me: user,
      loadOlder: () => loadHistory(stateRef.current.activeRoomId, { older: true }),
      selectRoom,
      sendMessage,
      retryMessage,
      discardMessage,
      setTyping,
      createRoom,
      openDm,
    }),
    [state, user, loadHistory, selectRoom, sendMessage, retryMessage, discardMessage, setTyping, createRoom, openDm],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
