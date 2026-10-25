const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export const formatTime = (ts) => timeFmt.format(ts);

export function formatDay(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return dayFmt.format(d);
}

export function formatLastSeen(ts) {
  if (!ts) return 'offline';
  const mins = Math.round((ts - Date.now()) / 60000);
  if (mins > -1) return 'last seen just now';
  if (mins > -60) return `last seen ${rtf.format(mins, 'minute')}`;
  const hours = Math.round(mins / 60);
  if (hours > -24) return `last seen ${rtf.format(hours, 'hour')}`;
  return `last seen ${rtf.format(Math.round(hours / 24), 'day')}`;
}

export const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
