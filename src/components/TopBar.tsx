import type { ReactNode } from 'react';

export interface Crumb {
  label: string;
  onClick?: () => void;
}

/** Notion-style slim header: breadcrumbs left, contextual actions right. */
export function TopBar({ crumbs, right }: { crumbs: Crumb[]; right?: ReactNode }) {
  return (
    <header className="topbar">
      <nav className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i} className="crumb-wrap">
            {i > 0 && <span className="crumb-sep">/</span>}
            {c.onClick ? (
              <button className="crumb link" onClick={c.onClick}>{c.label}</button>
            ) : (
              <span className="crumb">{c.label}</span>
            )}
          </span>
        ))}
      </nav>
      {right && <div className="topbar-right">{right}</div>}
    </header>
  );
}
