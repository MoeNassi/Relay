import { useEffect, useMemo, useState } from 'react';
import type { Project } from './types';
import { activeEnv } from './types';
import {
  connectRelay, apiCreate, apiReplace, apiSetStatus, apiDelete,
  fetchMe, login, logout, type PresenceUser, type AuthState,
} from './store';
import { Landing } from './components/Landing';
import { Splash } from './components/Splash';
import { Sidebar, type Filter } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Presence } from './components/Presence';
import { ProjectsTable } from './components/ProjectsTable';
import { DashboardCharts } from './components/DashboardCharts';
import { ProjectForm } from './components/ProjectForm';
import { ProjectDetail } from './components/ProjectDetail';
import { Settings } from './components/Settings';
import { PanelIcon } from './components/icons';
import './theme.css';
import './app.css';

type Theme = 'light' | 'dark';

function guestName(): string {
  let name = localStorage.getItem('relay-user');
  if (!name) {
    name = `Guest ${Math.floor(Math.random() * 90 + 10)}`;
    localStorage.setItem('relay-user', name);
  }
  return name;
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [minSplash, setMinSplash] = useState(true);   // keep the boot animation up briefly
  const [splashGone, setSplashGone] = useState(false); // removed after the fade-out
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // Resolve the SSO session (or dev fallback) before showing anything.
  useEffect(() => {
    let cancelled = false;
    fetchMe().then(a => { if (!cancelled) { setAuth(a); setAuthLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  // Boot splash: minimum on-screen time so the animation registers, then fade out.
  useEffect(() => {
    const t = setTimeout(() => setMinSplash(false), 2600);
    return () => clearTimeout(t);
  }, []);
  const booting = authLoading || minSplash;
  useEffect(() => {
    if (booting) return;
    const t = setTimeout(() => setSplashGone(true), 450); // matches fade-out
    return () => clearTimeout(t);
  }, [booting]);

  // live link to the server: project list + who's online — only once signed in,
  // tagged with the authenticated user's name (falls back to a guest handle).
  useEffect(() => {
    if (!auth) return;
    const name = auth.mode === 'sso' ? auth.user.name : guestName();
    return connectRelay(name, {
      onProjects: setProjects,
      onPresence: setUsers,
      onStatus: setConnected,
    });
  }, [auth]);

  const setSidebar = (v: boolean) => {
    setSidebarOpen(v);
    localStorage.setItem('relay-sidebar', v ? 'open' : 'closed');
  };

  const visible = useMemo(() => {
    let list = projects;
    if (filter !== 'all') {
      list = filter.startsWith('team:')
        ? list.filter(p => activeEnv(p)?.team === filter.slice(5))
        : list.filter(p => activeEnv(p)?.stage === filter);
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

  const splash = splashGone ? null : <Splash leaving={!booting} />;

  // Show the boot animation until auth resolves AND its minimum time elapses.
  if (authLoading) return <>{splash}</>;
  if (!auth) return <>{splash}<Landing onSignIn={login} /></>;

  const presence = <Presence users={users} connected={connected} />;

  return (
    <>
    {splash}
    <div className={`shell ${sidebarOpen ? '' : 'no-sidebar'}`}>
      {sidebarOpen ? (
        <Sidebar
          projects={projects}
          filter={filter}
          onFilter={f => { setFilter(f); setOpenId(null); setSettingsOpen(false); }}
          search={search}
          onSearch={q => { setSearch(q); setOpenId(null); setSettingsOpen(false); }}
          onNewProject={() => { setEditing(undefined); setFormOpen(true); }}
          onCollapse={() => setSidebar(false)}
          settingsOpen={settingsOpen}
          onSettings={() => { setSettingsOpen(true); setOpenId(null); }}
          theme={theme}
          onToggleTheme={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))}
          userName={auth.mode === 'sso' ? auth.user.name : guestName()}
          devMode={auth.mode === 'dev'}
          onSignOut={logout}
        />
      ) : (
        <button className="icon-btn expand" title="Expand sidebar" onClick={() => setSidebar(true)}>
          <PanelIcon />
        </button>
      )}
      <main className="main">
        {settingsOpen ? (
          <Settings presence={presence} onBack={() => setSettingsOpen(false)} />
        ) : open ? (
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
            onSetStatus={(envId, stage, team, note) => apiSetStatus(open.id, envId, stage, team, note).catch(fail)}
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
              {projects.length > 0 && <DashboardCharts projects={projects} />}
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
    </>
  );
}
