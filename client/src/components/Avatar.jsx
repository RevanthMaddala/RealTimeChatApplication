const PALETTE = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#2563eb'];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export default function Avatar({ user, size = 36, online }) {
  const name = user?.displayName || user?.username || '?';
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: PALETTE[hash(user?.id ?? name) % PALETTE.length] }}
      aria-hidden="true"
    >
      {initials}
      {online !== undefined && <span className={`presence-dot ${online ? 'on' : ''}`} />}
    </span>
  );
}
