import { useEffect, useMemo, useState } from 'react';
import type { Project } from './types';
import { loadProjects, saveProjects, advanceStage, nextStage } from './store';
import { DEV_MODE } from './config';
import { Landing } from './components/Landing';
import { Sidebar, type Filter } from './components/Sidebar';
import { PanelIcon } from './components/icons';
import { ProjectsTable } from './components/ProjectsTable';
import { ProjectForm } from './components/ProjectForm';
import { ProjectDetail } from './components/ProjectDetail';
import './theme.css';
import './app.css';

type Theme = 'light' | 'dark';

export default function App() {
  const [signedIn, setSignedIn] = useState(DEV_MODE);
  const [projects, setProjects] = useState<Project[]>(loadProjects);
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

  const update = (next: Project[]) => {
    setProjects(next);
    saveProjects(next);
  };

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

  if (!signedIn) return <Landing onSignIn={() => setSignedIn(true)} />;

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
            onBack={() => setOpenId(null)}
            onEdit={() => { setEditing(open); setFormOpen(true); }}
            onDelete={() => {
              if (confirm(`Delete project “${open.name}”?`)) {
                update(projects.filter(p => p.id !== open.id));
                setOpenId(null);
              }
            }}
            onAdvance={() => {
              const to = nextStage(open);
              if (to) update(projects.map(p => (p.id === open.id ? advanceStage(p, to) : p)));
            }}
          />
        ) : (
          <div className="page">
            <div className="page-head">
              <h1>Projects</h1>
              <div className="spacer" />
              <button className="btn primary" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
                + New project
              </button>
            </div>
            <ProjectsTable projects={visible} onOpen={p => setOpenId(p.id)} />
          </div>
        )}
      </main>

      {formOpen && (
        <ProjectForm
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSave={p => {
            update(editing ? projects.map(x => (x.id === p.id ? p : x)) : [...projects, p]);
            setFormOpen(false);
            setOpenId(p.id);
          }}
        />
      )}
    </div>
  );
}
