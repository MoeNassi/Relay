import type { PresenceUser } from '../store';

const COLORS = ['#1e96eb', '#10ab70', '#8054ff', '#d8a000', '#eb4335', '#0d9488', '#c2410c'];

const colorFor = (name: string) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};

const initials = (name: string) =>
  name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

/** Notion-style stack of connected-user avatars (live via WebSocket). */
export function Presence({ users, connected }: { users: PresenceUser[]; connected: boolean }) {
  if (!connected) {
    return <span className="presence-off" title="Live connection lost — reconnecting">offline</span>;
  }
  const shown = users.slice(0, 5);
  const extra = users.length - shown.length;
  return (
    <div className="presence" title={users.map(u => u.name).join(', ')}>
      {shown.map(u => (
        <span key={u.id} className="presence-avatar" style={{ background: colorFor(u.name) }}>
          {initials(u.name)}
        </span>
      ))}
      {extra > 0 && <span className="presence-avatar more">+{extra}</span>}
    </div>
  );
}
