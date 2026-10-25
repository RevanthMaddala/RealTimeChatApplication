import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useChat } from '../ChatContext.jsx';

const MAX_LENGTH = 2000;
const TYPING_IDLE_MS = 2500;
const drafts = new Map(); // roomId -> unsent text, survives switching rooms

export default function Composer({ roomId, placeholder }) {
  const { sendMessage, setTyping } = useChat();
  const [text, setText] = useState(() => drafts.get(roomId) ?? '');
  const inputRef = useRef(null);
  const typingActive = useRef(false);
  const idleTimer = useRef(null);

  const stopTyping = () => {
    clearTimeout(idleTimer.current);
    if (typingActive.current) {
      typingActive.current = false;
      setTyping(roomId, false);
    }
  };

  // Tell the room we've stopped typing when leaving it.
  useEffect(() => stopTyping, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-grow the textarea up to the CSS max-height.
  useLayoutEffect(() => {
    const el = inputRef.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function onChange(e) {
    const value = e.target.value.slice(0, MAX_LENGTH);
    setText(value);
    drafts.set(roomId, value);
    if (!value.trim()) return stopTyping();
    if (!typingActive.current) {
      typingActive.current = true;
      setTyping(roomId, true);
    }
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  }

  function submit(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body) return;
    sendMessage(body);
    setText('');
    drafts.delete(roomId);
    stopTyping();
    inputRef.current.focus();
  }

  function onKeyDown(e) {
    // Enter sends, Shift+Enter adds a newline. Respect IME composition (e.g. Japanese input).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  const remaining = MAX_LENGTH - text.length;

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        ref={inputRef}
        rows={1}
        value={text}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="send"
      />
      {remaining < 200 && <span className={`char-count ${remaining < 50 ? 'warn' : ''}`}>{remaining}</span>}
      <button className="send-btn" disabled={!text.trim()} aria-label="Send message">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
        </svg>
      </button>
    </form>
  );
}
