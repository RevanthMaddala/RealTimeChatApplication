import { useChat } from '../ChatContext.jsx';
import { formatLastSeen } from '../time.js';
import Avatar from './Avatar.jsx';
import MessageList from './MessageList.jsx';
import Composer from './Composer.jsx';

function TypingIndicator({ roomId }) {
  const { typing, users } = useChat();
  const names = Object.keys(typing[roomId] ?? {}).map((id) => users[id]?.displayName ?? 'Someone');
  if (names.length === 0) return <div className="typing" aria-hidden="true" />;
  const text =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : 'Several people are typing';
  return (
    <div className="typing" aria-live="polite">
      <span className="typing-dots">
        <i />
        <i />
        <i />
      </span>
      {text}
    </div>
  );
}

export default function ChatPanel({ onBack }) {
  const { rooms, activeRoomId, online, users, connection } = useChat();
  const room = rooms[activeRoomId];
  const peer = room?.type === 'dm' ? (users[room.peer?.id] ?? room.peer) : null;

  let subtitle = room?.description;
  if (peer) subtitle = online[peer.id] ? 'online' : formatLastSeen(peer.lastSeenAt);

  return (
    <section className="chat">
      <header className="chat-header">
        <button className="icon-btn back-btn" onClick={onBack} aria-label="Back to conversations">
          ‹
        </button>
        {peer ? <Avatar user={peer} size={34} online={Boolean(online[peer.id])} /> : <span className="hash hash-lg">#</span>}
        <div className="chat-title">
          <h1>{room?.name ?? activeRoomId}</h1>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
      </header>

      {connection !== 'connected' && (
        <div className={`banner banner-${connection}`} role="status">
          {connection === 'offline' ? 'Unable to connect. Check your connection and reload.' : 'Connecting to chat… messages will send once you’re back online.'}
        </div>
      )}

      <MessageList roomId={activeRoomId} />
      <TypingIndicator roomId={activeRoomId} />
      <Composer key={activeRoomId} roomId={activeRoomId} placeholder={room ? `Message ${room.type === 'dm' ? room.name : `#${room.name}`}` : 'Message'} />
    </section>
  );
}
