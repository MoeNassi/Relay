import type { Project, StageKey } from '../types';
import { STAGES } from '../types';
import { DEV_MODE } from '../config';

interface Props {
  projects: Project[];
  filter: StageKey | 'all';
  onFilter: (f: StageKey | 'all') => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function Sidebar({ projects, filter, onFilter, theme, onToggleTheme }: Props) {
  return (
    <aside className="sidebar">
      <div className="workspace">
        <span className="logo">R</span>
        Relay
        {DEV_MODE && <span className="dev-chip">DEV</span>}
      </div>

      <nav className="nav">
        <div className="nav-label">Projects</div>
        <button className={`nav-item ${filter === 'all' ? 'active' : ''}`} onClick={() => onFilter('all')}>
          All projects
          <span className="count">{projects.length}</span>
        </button>
        {STAGES.map(s => {
          const n = projects.filter(p => p.stage === s.key).length;
          return (
            <button
              key={s.key}
              className={`nav-item ${filter === s.key ? 'active' : ''}`}
              onClick={() => onFilter(s.key)}
            >
              {s.shortLabel}
              <span className="count">{n}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button className="nav-item" onClick={onToggleTheme}>
          {theme === 'light' ? '🌙 Dark mode' : '☀️ Light mode'}
        </button>
      </div>
    </aside>
  );
}
