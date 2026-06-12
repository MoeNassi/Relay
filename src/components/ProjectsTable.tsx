import type { Project } from '../types';
import { StageBadge, TeamBadge, SlaCell } from './badges';
import { totalElapsed, formatDuration } from '../store';

interface Props {
  projects: Project[];
  onOpen: (p: Project) => void;
}

export function ProjectsTable({ projects, onOpen }: Props) {
  if (!projects.length) {
    return <div className="empty">No projects here yet — create one with “New project”.</div>;
  }
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Application</th>
          <th>Owner</th>
          <th>Envs</th>
          <th>Stage</th>
          <th>Ball at</th>
          <th>Stage SLA</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {projects.map(p => (
          <tr key={p.id} onClick={() => onOpen(p)}>
            <td>
              <div className="name">{p.name}</div>
              <div className="sub mono">{p.dns || 'no DNS yet'}</div>
            </td>
            <td>
              <div>{p.owner.name}</div>
              <div className="sub">{p.owner.title}</div>
            </td>
            <td className="mono">{p.environments.map(e => e.name).join(', ') || '—'}</td>
            <td><StageBadge stage={p.stage} /></td>
            <td><TeamBadge team={p.team} /></td>
            <td><SlaCell project={p} /></td>
            <td className="mono">{formatDuration(totalElapsed(p))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
