import type { Project } from '../types';
import { activeEnv, orderedEnvs } from '../types';
import { StageBadge, TeamBadge, SlaCell } from './badges';
import { totalElapsed, formatDuration } from '../store';

interface Props {
  projects: Project[];
  onOpen: (p: Project) => void;
}

export function ProjectsTable({ projects, onOpen }: Props) {
  if (!projects.length) {
    return (
      <div className="empty">
        <div className="baton-track">
          <span className="runner a" />
          <span className="baton" />
          <span className="runner b" />
        </div>
        No projects here yet — create one with “New project”.
      </div>
    );
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Application</th>
          <th>Owner</th>
          <th>Active env</th>
          <th>Stage</th>
          <th>Ball at</th>
          <th>Stage SLA</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {projects.map(p => {
          const env = activeEnv(p);
          const envNames = orderedEnvs(p).map(e => e.name).join(' · ') || '—';
          return (
            <tr key={p.id} onClick={() => onOpen(p)}>
              <td>
                <div className="name">{p.name}</div>
                <div className="sub mono">{p.dns || 'no DNS yet'}</div>
              </td>
              <td>
                <div>{p.owner.name}</div>
                <div className="sub">{p.owner.title}</div>
              </td>
              <td>
                <div className="mono">{env ? env.name : '—'}</div>
                <div className="sub">{envNames}</div>
              </td>
              <td><StageBadge stage={env?.stage ?? null} /></td>
              <td><TeamBadge team={env?.team ?? null} /></td>
              <td>{env ? <SlaCell env={env} /> : <span className="sla ok">—</span>}</td>
              <td className="mono">{env ? formatDuration(totalElapsed(env)) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
