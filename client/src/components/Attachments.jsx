import { useEffect } from 'react';
import { fileBadge, formatBytes } from '../attachments.js';

/** Renders a message's attachments: media inline, everything else as a download card. */
export function Attachments({ items, onOpenImage, onMediaLoad }) {
  if (!items?.length) return null;
  const images = items.filter((a) => a.kind === 'image');
  const others = items.filter((a) => a.kind !== 'image');

  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className={`att-images ${images.length > 1 ? 'multi' : ''}`}>
          {images.map((a) => (
            <button key={a.id} type="button" className="att-image" onClick={() => onOpenImage(a)} aria-label={`View ${a.name}`}>
              <img src={a.url} alt={a.name} loading="lazy" onLoad={onMediaLoad} />
            </button>
          ))}
        </div>
      )}
      {others.map((a) => {
        if (a.kind === 'video') {
          return (
            <video key={a.id} className="att-video" src={a.url} controls preload="metadata" playsInline onLoadedMetadata={onMediaLoad} />
          );
        }
        if (a.kind === 'audio') {
          return (
            <div key={a.id} className="att-audio">
              <span className="att-audio-name">{a.name}</span>
              <audio src={a.url} controls preload="metadata" />
            </div>
          );
        }
        return (
          <a key={a.id} className="att-file" href={a.url} download={a.name} title={`Download ${a.name}`}>
            <span className="att-file-badge">{fileBadge(a.name)}</span>
            <span className="att-file-meta">
              <span className="att-file-name">{a.name}</span>
              <span className="att-file-size">{formatBytes(a.size)}</span>
            </span>
            <span className="att-file-dl" aria-hidden="true">
              ↓
            </span>
          </a>
        );
      })}
    </div>
  );
}

export function Lightbox({ attachment, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={attachment.name} onClick={onClose}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-name">{attachment.name}</span>
        <a className="btn btn-sm lightbox-btn" href={attachment.url} download={attachment.name}>
          Download
        </a>
        <button className="btn btn-sm lightbox-btn" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
      <img src={attachment.url} alt={attachment.name} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}
