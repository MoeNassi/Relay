import { useEffect, useMemo, useState } from 'react';
import type { Project } from './types';
import {
  connectRelay, apiCreate, apiReplace, apiSetStatus, apiDelete,
  nextStage, type PresenceUser,
} from './store';
import { DEV_MODE } from './config';
import { Landing } from './components/Landing';
import { Sidebar, type Filter } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Presence } from './components/Presence';
import { ProjectsTable } from './components/ProjectsTable';
import { ProjectForm } from './components/ProjectForm';
import { ProjectDetail } from './components/ProjectDetail';
import { PanelIcon } from './components/icons';
import './theme.css';
import './app.css';

type Theme = 'light' | 'dark';

function userName(): string {
  let name = localStorage.getItem('relay-user');
  if (!name) {
    name = `Guest ${Math.floor(Math.random() * 90 + 10)}`;
    localStorage.setItem('relay-user', name);
  }
  return name;
}

export default function App() {
  const [signedIn, setSignedIn] = useState(DEV_MODE);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Project | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem('relay-sidebar') !== 'closed'
  );
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('relay-theme') as Theme) ?? 'light'
  );
  // re-render every minute so SLA clocks tick
  const [, setTick] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('relay-theme', theme);
  }, [theme]);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // live link to the server: project list + who's online
  useEffect(() => connectRelay(userName(), {
    onProjects: setProjects,
    onPresence: setUsers,
    onStatus: setConnected,
  }), []);

  const setSidebar = (v: boolean) => {
    setSidebarOpen(v);
    localStorage.setItem('relay-sidebar', v ? 'open' : 'closed');
  };

  const visible = useMemo(() => {
    let list = projects;
    if (filter !== 'all') {
      list = filter.startsWith('team:')
        ? list.filter(p => p.team === filter.slice(5))
        : list.filter(p => p.stage === filter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(p =>
        [p.name, p.dns, p.owner.name, p.owner.title].some(s => s.toLowerCase().includes(q))
      );
    }
    return list;
  }, [projects, filter, search]);

  const open = projects.find(p => p.id === openId) ?? null;

  const fail = (e: unknown) => alert(e instanceof Error ? e.message : String(e));

  if (!signedIn) return <Landing onSignIn={() => setSignedIn(true)} />;

  const presence = <Presence users={users} connected={connected} />;

  return (
    <div className="shell">
      {sidebarOpen ? (
        <Sidebar
          projects={projects}
          filter={filter}
          onFilter={f => { setFilter(f); setOpenId(null); }}
          search={search}
          onSearch={q => { setSearch(q); setOpenId(null); }}
          onNewProject={() => { setEditing(undefined); setFormOpen(true); }}
          onCollapse={() => setSidebar(false)}
          theme={theme}
          onToggleTheme={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
        />
      ) : (
        <button className="icon-btn expand" title="Expand sidebar" onClick={() => setSidebar(true)}>
          <PanelIcon />
        </button>
      )}
      <main className="main">
        {open ? (
          <ProjectDetail
            project={open}
            presence={presence}
            onBack={() => setOpenId(null)}
            onEdit={() => { setEditing(open); setFormOpen(true); }}
            onDelete={() => {
              if (confirm(`Delete project “${open.name}”?`)) {
                apiDelete(open.id).then(() => setOpenId(null)).catch(fail);
              }
            }}
            onAdvance={() => {
              const to = nextStage(open);
              if (to) apiSetStatus(open.id, to).catch(fail);
            }}
          />
        ) : (
          <>
            <TopBar
              crumbs={[{ label: 'Relay Workspace' }, { label: 'Projects' }]}
              right={
                <>
                  {presence}
                  <button className="btn primary sm" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
                    + New project
                  </button>
                </>
              }
            />
            <div className="page">
              <div className="page-title-block">
                <h1 className="page-title">Projects</h1>
                <div className="title-meta">
                  <span className="meta-text">
                    {visible.length} project{visible.length === 1 ? '' : 's'}
                    {filter !== 'all' || search ? ' (filtered)' : ''}
                  </span>
                </div>
              </div>
              <ProjectsTable projects={visible} onOpen={p => setOpenId(p.id)} />
            </div>
          </>
        )}
      </main>

      {formOpen && (
        <ProjectForm
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSave={p => {
            const req = editing ? apiReplace(p) : apiCreate(p);
            req.then(saved => { setFormOpen(false); setOpenId(saved.id); }).catch(fail);
          }}
        />
      )}
    </div>
  );
}
