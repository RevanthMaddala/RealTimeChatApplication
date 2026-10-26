import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext.jsx';
import { useChat } from '../ChatContext.jsx';
import AccountDialog from './AccountDialog.jsx';
import Avatar from './Avatar.jsx';

const CONNECTION_LABEL = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
};

function NewRoomForm({ onDone }) {
  const { createRoom } = useChat();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createRoom(name);
      onDone(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="new-room" onSubmit={submit}>
      <input
        autoFocus
        placeholder="room-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone(false)}
        maxLength={32}
        aria-label="New room name"
      />
      <button className="btn btn-primary btn-sm" disabled={busy || name.trim().length < 2}>
        Create
      </button>
      {error && <div className="field-error">{error}</div>}
    </form>
  );
}

export default function Sidebar({ onNavigate }) {
  const { logout } = useAuth();
  const { me, rooms, users, online, unread, activeRoomId, connection, selectRoom, openDm } = useChat();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const closeAccount = useCallback(() => setAccountOpen(false), []);

  const { channels, dms } = useMemo(() => {
    const all = Object.values(rooms);
    return {
      channels: all.filter((r) => r.type === 'public').sort((a, b) => a.name.localeCompare(b.name)),
      dms: all.filter((r) => r.type === 'dm').sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    };
  }, [rooms]);

  const people = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return Object.values(users)
      .filter((u) => u.id !== me.id)
      .filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
      .sort((a, b) => Number(Boolean(online[b.id])) - Number(Boolean(online[a.id])) || a.displayName.localeCompare(b.displayName));
  }, [users, online, me.id, filter]);

  const onlineCount = Object.keys(online).filter((id) => id !== me.id).length;

  const go = (roomId) => {
    selectRoom(roomId);
    onNavigate();
  };

  const startDm = async (userId) => {
    try {
      await openDm(userId);
      onNavigate();
    } catch {
      /* surfaced by connection state; nothing else to do */
    }
  };

  const roomButton = (room, icon) => (
    <li key={room.id}>
      <button className={`room-item ${room.id === activeRoomId ? 'active' : ''}`} onClick={() => go(room.id)}>
        {icon}
        <span className="room-name">{room.name}</span>
        {unread[room.id] > 0 && <span className="badge">{unread[room.id] > 99 ? '99+' : unread[room.id]}</span>}
      </button>
    </li>
  );

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          Relay
        </div>
        <span className={`conn conn-${connection}`} title={CONNECTION_LABEL[connection]}>
          <span className="conn-dot" />
          <span className="conn-label">{CONNECTION_LABEL[connection]}</span>
        </span>
      </header>

      <nav className="sidebar-scroll">
        <section>
          <div className="section-title">
            <span>Channels</span>
            <button className="icon-btn" onClick={() => setCreating((c) => !c)} aria-label="Create channel" title="Create channel">
              {creating ? '×' : '+'}
            </button>
          </div>
          {creating && <NewRoomForm onDone={(made) => { setCreating(false); if (made) onNavigate(); }} />}
          <ul>
            {channels.map((r) => roomButton(r, <span className="hash">#</span>))}
          </ul>
        </section>

        {dms.length > 0 && (
          <section>
            <div className="section-title">
              <span>Direct messages</span>
            </div>
            <ul>
              {dms.map((r) => roomButton(r, <Avatar user={r.peer} size={22} online={Boolean(online[r.peer?.id])} />))}
            </ul>
          </section>
        )}

        <section>
          <div className="section-title">
            <span>People</span>
            <span className="muted small">{onlineCount} online</span>
          </div>
          {Object.keys(users).length > 6 && (
            <input className="people-filter" placeholder="Find people…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
          <ul>
            {people.map((u) => (
              <li key={u.id}>
                <button className="room-item" onClick={() => startDm(u.id)} title={`Message ${u.displayName}`}>
                  <Avatar user={u} size={22} online={Boolean(online[u.id])} />
                  <span className="room-name">{u.displayName}</span>
                  <span className="muted small">@{u.username}</span>
                </button>
              </li>
            ))}
            {people.length === 0 && <li className="empty-hint">No one else here yet — open another browser and sign up a second user.</li>}
          </ul>
        </section>
      </nav>

      <footer className="sidebar-footer">
        <Avatar user={me} size={32} online={connection === 'connected'} />
        <div className="me">
          <strong>{me.displayName}</strong>
          <span className="muted small">@{me.username}</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setAccountOpen(true)}>
          Account
        </button>
        <button className="btn btn-ghost btn-sm" onClick={logout}>
          Sign out
        </button>
      </footer>
      {accountOpen && <AccountDialog onClose={closeAccount} />}
    </aside>
  );
}
