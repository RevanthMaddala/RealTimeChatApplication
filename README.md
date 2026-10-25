# Relay — Real-Time Chat Application

Full-stack real-time chat for many concurrent users. React front end (responsive, mobile-friendly), Node/Express API, Socket.io for low-latency bidirectional messaging, and JWT authentication with secure, revocable sessions.

## Features

- **Real-time messaging** over Socket.io: public channels, 1:1 direct messages, typing indicators, online/last-seen presence, unread badges
- **Optimistic UI**: messages appear instantly and are reconciled with the server ack (pending / failed + retry)
- **History** with cursor pagination and scroll anchoring when older messages load
- **Resilient connection**: auto-reconnect, catch-up on missed messages, status banner
- **Responsive layout**: two-pane on desktop, single-pane with back navigation on phones; safe-area aware, 44px touch targets, light/dark themes

## Security model

| Concern | Approach |
| --- | --- |
| Access token | Short-lived (15 min) HS256 JWT carrying user + session id. Held **in memory only** on the client, never in `localStorage`. Sent as `Authorization: Bearer` and in the Socket.io handshake. |
| Refresh token | Opaque random secret in an `httpOnly`, `SameSite=Strict`, path-scoped (`/api/auth`) cookie, `Secure` in production. Only its SHA-256 hash is stored. |
| Rotation & theft detection | Refresh tokens rotate on every use. Replaying an old one revokes the whole session and disconnects its sockets. Cross-tab refreshes are serialized with the Web Locks API (plus a 10s server grace window). |
| Instant revocation | Every request and socket handshake checks the session is still live, so logout takes effect immediately; live sockets in that session are disconnected. |
| Socket expiry | The server drops a socket when its token expires unless the client sends a refreshed token (`auth:refresh`) first, which the client does automatically. |
| Passwords | bcrypt (cost 12); login does constant work whether or not the user exists. |
| Abuse | Rate limiting on auth endpoints, per-socket message rate limiting, input validation, payload size caps, `helmet` headers. |
| Authorization | DMs are visible only to their two members, checked on both REST and socket paths. |

## Getting started

Requires Node 18+.

```bash
npm install
```

```bash
npm run dev
```

The API runs on http://localhost:4000 and the React app on http://localhost:5173 (Vite proxies `/api` and `/socket.io`, so the browser sees a single origin). If 5173 is taken, Vite picks the next free port.

Optional demo accounts (`alice`, `bob`, `carol`; the password is printed by the script). Run this while the server is up:

```bash
npm run seed -w server
```

To try multi-user chat yourself, sign in as different users in two different browsers (or a normal + private window), since tabs in the same browser share the session cookie.

### Production

```bash
npm run build
```

```bash
NODE_ENV=production JWT_ACCESS_SECRET=<long random string> npm start
```

In production the Express server also serves the built React app from `client/dist`. Copy `server/.env.example` to `server/.env` for configuration.

## Project structure

```
server/src
  index.js       Express app, security middleware, static hosting
  auth.js        register / login / refresh / logout, JWT + session verification
  api.js         rooms, DMs, message history, user directory (REST)
  socket.js      Socket.io auth middleware, messaging, typing, presence, token expiry
  db.js          JSON-file persistence (swap for MongoDB/Postgres without touching routes)
client/src
  api.js         fetch wrapper, in-memory token, silent refresh
  AuthContext    session restore + auth actions
  ChatContext    socket lifecycle, reducer for rooms/messages/presence/typing
  components/    AuthPage, Sidebar, ChatPanel, MessageList, Composer, Avatar
```

## Socket events

| Client → server | Server → client |
| --- | --- |
| `message:send {roomId, text, clientId}` (ack) | `message:new` |
| `typing {roomId, isTyping}` | `typing {roomId, userId, isTyping}` |
| `auth:refresh token` (ack) | `presence:init`, `presence:update` |
| | `room:created`, `user:new`, `auth:expired` |
