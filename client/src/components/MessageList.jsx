import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { useChat } from '../ChatContext.jsx';
import { formatDay, formatTime, sameDay } from '../time.js';
import Avatar from './Avatar.jsx';

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 80;
const keyOf = (m) => m?.id ?? m?.clientId ?? null;

export default function MessageList({ roomId }) {
  const { messages, me, loadOlder, retryMessage, discardMessage } = useChat();
  const entry = messages[roomId];
  const items = entry?.items ?? [];
  const scrollRef = useRef(null);
  const stickToBottom = useRef(true);
  const prev = useRef({ roomId: null, first: null, last: null, height: 0 });
  const [showJump, setShowJump] = useState(false);

  // Keep the viewport where the user expects it: pinned to the bottom for new
  // messages, anchored in place when older history is prepended above.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const p = prev.current;
    const first = keyOf(items[0]);
    const last = keyOf(items.at(-1));
    if (p.roomId !== roomId) {
      stickToBottom.current = true;
      el.scrollTop = el.scrollHeight;
    } else if (first !== p.first && last === p.last) {
      el.scrollTop += el.scrollHeight - p.height;
    } else if (last !== p.last) {
      if (stickToBottom.current || items.at(-1)?.author?.id === me.id) el.scrollTop = el.scrollHeight;
      else setShowJump(true);
    }
    prev.current = { roomId, first, last, height: el.scrollHeight };
  }, [items, roomId, me.id]);

  function onScroll() {
    const el = scrollRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stickToBottom.current = nearBottom;
    if (nearBottom) setShowJump(false);
    if (el.scrollTop < 150 && entry?.hasMore && entry.status !== 'loading') loadOlder();
    prev.current.height = el.scrollHeight;
  }

  const jumpToBottom = () => {
    const el = scrollRef.current;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowJump(false);
  };

  return (
    <div className="messages-wrap">
      <div className="messages" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite" aria-relevant="additions">
        {entry?.hasMore && (
          <div className="history-hint">
            {entry.status === 'loading' ? (
              'Loading older messages…'
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={loadOlder}>
                Load older messages
              </button>
            )}
          </div>
        )}
        {entry?.status === 'error' && items.length === 0 && <div className="empty">Couldn&apos;t load messages.</div>}
        {entry?.status === 'loading' && items.length === 0 && <div className="empty">Loading…</div>}
        {entry?.status === 'loaded' && items.length === 0 && (
          <div className="empty">
            <div className="empty-icon">👋</div>
            No messages yet. Say hello!
          </div>
        )}

        {items.map((m, i) => {
          const before = items[i - 1];
          const newDay = !before || !sameDay(before.createdAt, m.createdAt);
          const grouped =
            !newDay && before?.author?.id === m.author?.id && m.createdAt - before.createdAt < GROUP_WINDOW_MS && !before.failed;
          const mine = m.author?.id === me.id;
          return (
            <Fragment key={keyOf(m)}>
              {newDay && (
                <div className="day-divider">
                  <span>{formatDay(m.createdAt)}</span>
                </div>
              )}
              <article className={`msg ${grouped ? 'grouped' : ''} ${mine ? 'mine' : ''} ${m.pending ? 'pending' : ''} ${m.failed ? 'failed' : ''}`}>
                <div className="msg-gutter">
                  {grouped ? (
                    <time className="msg-time-hover">{formatTime(m.createdAt)}</time>
                  ) : (
                    <Avatar user={m.author} size={36} />
                  )}
                </div>
                <div className="msg-body">
                  {!grouped && (
                    <header>
                      <strong>{m.author?.displayName ?? 'Deleted user'}</strong>
                      <time dateTime={new Date(m.createdAt).toISOString()}>{formatTime(m.createdAt)}</time>
                    </header>
                  )}
                  <p className="msg-text">{m.text}</p>
                  {m.pending && <span className="msg-status">Sending…</span>}
                  {m.failed && (
                    <span className="msg-status error">
                      {m.error || 'Failed to send'} ·{' '}
                      <button className="link" onClick={() => retryMessage(m)}>
                        Retry
                      </button>{' '}
                      ·{' '}
                      <button className="link" onClick={() => discardMessage(m)}>
                        Discard
                      </button>
                    </span>
                  )}
                </div>
              </article>
            </Fragment>
          );
        })}
      </div>
      {showJump && (
        <button className="jump" onClick={jumpToBottom}>
          New messages ↓
        </button>
      )}
    </div>
  );
}
