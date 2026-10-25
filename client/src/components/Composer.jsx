import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useChat } from '../ChatContext.jsx';
import { uploadFile } from '../api.js';
import { ACCEPT, MAX_FILES_PER_MESSAGE, fileBadge, formatBytes, precheck, previewKind } from '../attachments.js';

const MAX_LENGTH = 2000;
const TYPING_IDLE_MS = 2500;
const drafts = new Map(); // roomId -> unsent text, survives switching rooms
let nextKey = 0;

/** Pending file in the composer tray. Uploads start as soon as it's added. */
function TrayItem({ item, onRemove }) {
  return (
    <li className={`tray-item ${item.status}`} title={item.error ?? item.name}>
      {item.previewUrl && item.kind === 'image' ? (
        <img src={item.previewUrl} alt="" />
      ) : item.previewUrl && item.kind === 'video' ? (
        <video src={item.previewUrl} muted />
      ) : (
        <span className="tray-badge">{fileBadge(item.name)}</span>
      )}
      <span className="tray-meta">
        <span className="tray-name">{item.name}</span>
        <span className="tray-sub">{item.status === 'error' ? item.error : formatBytes(item.size)}</span>
      </span>
      {item.status === 'uploading' && (
        <span className="tray-progress" style={{ '--p': `${Math.round(item.progress * 100)}%` }} aria-label="Uploading" />
      )}
      <button type="button" className="tray-remove" onClick={() => onRemove(item.key)} aria-label={`Remove ${item.name}`}>
        ×
      </button>
    </li>
  );
}

const Composer = forwardRef(function Composer({ roomId, placeholder }, ref) {
  const { sendMessage, setTyping } = useChat();
  const [text, setText] = useState(() => drafts.get(roomId) ?? '');
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingActive = useRef(false);
  const idleTimer = useRef(null);

  const stopTyping = () => {
    clearTimeout(idleTimer.current);
    if (typingActive.current) {
      typingActive.current = false;
      setTyping(roomId, false);
    }
  };

  // Leaving the room: stop "typing", cancel in-flight uploads, free preview blobs.
  useEffect(
    () => () => {
      stopTyping();
      for (const item of itemsRef.current) {
        item.controller?.abort();
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Auto-grow the textarea up to the CSS max-height.
  useLayoutEffect(() => {
    const el = inputRef.current;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const patch = (key, changes) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...changes } : i)));

  function addFiles(fileList) {
    const all = [...fileList];
    if (all.length === 0) return;
    const slots = Math.max(MAX_FILES_PER_MESSAGE - itemsRef.current.length, 0);
    setNotice(all.length > slots ? `You can attach up to ${MAX_FILES_PER_MESSAGE} files per message` : null);

    const created = all.slice(0, slots).map((file) => {
      const error = precheck(file);
      const kind = previewKind(file);
      return {
        key: ++nextKey,
        file,
        name: file.name,
        size: file.size,
        kind,
        previewUrl: !error && (kind === 'image' || kind === 'video') ? URL.createObjectURL(file) : null,
        status: error ? 'error' : 'uploading',
        progress: 0,
        error,
        attachment: null,
        controller: error ? null : new AbortController(),
      };
    });
    setItems((prev) => [...prev, ...created]);

    for (const item of created) {
      if (item.status !== 'uploading') continue;
      uploadFile(roomId, item.file, {
        signal: item.controller.signal,
        onProgress: (progress) => patch(item.key, { progress }),
      })
        .then((attachment) => patch(item.key, { status: 'done', attachment, progress: 1 }))
        .catch((err) => err.code !== 'ABORTED' && patch(item.key, { status: 'error', error: err.message }));
    }
    inputRef.current?.focus();
  }

  useImperativeHandle(ref, () => ({ addFiles }));

  function removeItem(key) {
    const item = itemsRef.current.find((i) => i.key === key);
    item?.controller?.abort();
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setItems((prev) => prev.filter((i) => i.key !== key));
    setNotice(null);
  }

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

  const uploading = items.some((i) => i.status === 'uploading');
  const failed = items.some((i) => i.status === 'error');
  const ready = items.filter((i) => i.status === 'done');
  const canSend = (text.trim() || ready.length > 0) && !uploading && !failed;

  function submit(e) {
    e?.preventDefault();
    if (!canSend) return;
    sendMessage(
      text.trim(),
      ready.map((i) => i.attachment),
    );
    for (const item of items) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setItems([]);
    setNotice(null);
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

  function onPaste(e) {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  }

  const remaining = MAX_LENGTH - text.length;
  const hint = notice ?? (failed ? 'Remove the files that failed to send your message' : uploading ? 'Uploading…' : null);

  return (
    <form className="composer-wrap" onSubmit={submit}>
      {items.length > 0 && (
        <ul className="tray">
          {items.map((item) => (
            <TrayItem key={item.key} item={item} onRemove={removeItem} />
          ))}
        </ul>
      )}
      {hint && <div className={`composer-hint ${failed || notice ? 'error' : ''}`}>{hint}</div>}
      <div className="composer">
        <button
          type="button"
          className="attach-btn"
          onClick={() => fileInputRef.current.click()}
          aria-label="Attach files"
          title="Attach files (images, video, audio, documents — up to 25 MB)"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              fill="currentColor"
              d="M16.5 6.5v10.6a4.5 4.5 0 0 1-9 0V5.8a3 3 0 0 1 6 0v10.3a1.5 1.5 0 0 1-3 0V6.5H9v9.6a3 3 0 0 0 6 0V5.8a4.5 4.5 0 0 0-9 0v11.3a6 6 0 0 0 12 0V6.5z"
            />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          aria-label={placeholder}
          enterKeyHint="send"
        />
        {remaining < 200 && <span className={`char-count ${remaining < 50 ? 'warn' : ''}`}>{remaining}</span>}
        <button className="send-btn" disabled={!canSend} aria-label="Send message">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
          </svg>
        </button>
      </div>
    </form>
  );
});

export default Composer;
