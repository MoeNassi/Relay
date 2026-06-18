import { useState } from 'react';
import type { Project, Team } from '../types';
import { STAGES, TEAM_LABELS, activeEnv } from '../types';
import {
  PanelIcon, SearchIcon, PlusIcon, LayersIcon, ServerIcon, ShieldIcon,
  NetworkIcon, CodeIcon, UserIcon, MoonIcon, SunIcon, ChevronIcon, GearIcon,
} from './icons';

export type Filter = 'all' | (typeof STAGES)[number]['key'] | `team:${Team}`;

interface Props {
  projects: Project[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  search: string;
  onSearch: (q: string) => void;
  onNewProject: () => void;
  onCollapse: () => void;
  settingsOpen: boolean;
  onSettings: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  userName: string;
  devMode: boolean;
  onSignOut: () => void;
}

const SECTIONS_KEY = 'relay-sidebar-sections';

function loadSections(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function Sidebar({
  projects, filter, onFilter, search, onSearch, onNewProject, onCollapse,
  settingsOpen, onSettings, theme, onToggleTheme, userName, devMode, onSignOut,
}: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(loadSections);
  const isOpen = (k: string) => open[k] ?? true;
  const toggle = (k: string) => {
    const next = { ...open, [k]: !isOpen(k) };
    setOpen(next);
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
  };

  const teamIcon = (t: Team) =>
    t === 'cybersec' ? <ShieldIcon /> : t === 'network' ? <NetworkIcon /> : t === 'devops' ? <CodeIcon /> : <ServerIcon />;

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button className="icon-btn" title="Collapse sidebar" onClick={onCollapse}>
          <PanelIcon />
        </button>
      </div>

      <div className="workspace">
        <span className="logo">R</span>
        <span className="ws-name">Relay Workspace</span>
        {devMode && <span className="dev-chip">DEV</span>}
        <span className="ws-avatar" title={`Signed in as ${userName}`}><UserIcon /></span>
      </div>

      <div className="search-row">
        <SearchIcon />
        <input
          placeholder="Search"
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
        <button className="icon-btn boxed" title="New project" onClick={onNewProject}>
          <PlusIcon />
        </button>
      </div>

      <nav className="nav">
        <button className={`nav-item ${filter === 'all' ? 'active' : ''}`} onClick={() => onFilter('all')}>
          <span className="nav-ico"><LayersIcon /></span>
          All projects
          <span className="count">{projects.length}</span>
        </button>

        <button className="section-head" onClick={() => toggle('pipeline')}>
          Pipeline <ChevronIcon open={isOpen('pipeline')} />
        </button>
        {isOpen('pipeline') && STAGES.map(s => {
          const n = projects.filter(p => activeEnv(p)?.stage === s.key).length;
          return (
            <button
              key={s.key}
              className={`nav-item ${filter === s.key ? 'active' : ''}`}
              onClick={() => onFilter(s.key)}
            >
              <span className="nav-ico"><span className={`stage-dot d-${s.key}`} /></span>
              {s.shortLabel}
              <span className="count">{n}</span>
            </button>
          );
        })}

        <button className="section-head" onClick={() => toggle('teams')}>
          Ball at <ChevronIcon open={isOpen('teams')} />
        </button>
        {isOpen('teams') && (['devops', 'infra', 'network', 'cybersec'] as Team[]).map(t => {
          const n = projects.filter(p => activeEnv(p)?.team === t).length;
          const key: Filter = `team:${t}`;
          return (
            <button
              key={t}
              className={`nav-item ${filter === key ? 'active' : ''}`}
              onClick={() => onFilter(key)}
            >
              <span className="nav-ico">{teamIcon(t)}</span>
              {TEAM_LABELS[t]}
              <span className="count">{n}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button className={`nav-item ${settingsOpen ? 'active' : ''}`} onClick={onSettings}>
          <span className="nav-ico"><GearIcon /></span>
          Settings
        </button>
        <button className="nav-item" onClick={onToggleTheme}>
          <span className="nav-ico">{theme === 'light' ? <MoonIcon /> : <SunIcon />}</span>
          {theme === 'light' ? 'Dark mode' : 'Light mode'}
        </button>
        <div className="sidebar-account">
          <span className="nav-ico"><UserIcon /></span>
          <span className="account-name" title={userName}>{userName}</span>
          <button className="signout-btn" title="Sign out" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </aside>
  );
}
