import { Fragment, useState } from 'react';
import type { Project } from '../types';
import { activeEnv, orderedEnvs, envStageDef, envDns, TEAM_LABELS } from '../types';
import { StageBadge, TeamBadge, SlaCell } from './badges';
import { totalElapsed, formatDuration, projectTeamSla } from '../store';

interface Props {
  projects: Project[];
  onOpen: (p: Project) => void;
}

export function ProjectsTable({ projects, onOpen }: Props) {
  // project id whose per-team SLA breakdown is expanded
  const [slaOpen, setSlaOpen] = useState<string | null>(null);

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
          <th>Team SLA</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {projects.map(p => {
          const env = activeEnv(p);
          const envNames = orderedEnvs(p).map(e => e.name).join(' · ') || '—';
          const teamSla = projectTeamSla(p);
          const delayed = teamSla.filter(t => t.over);
          const open = slaOpen === p.id;
          return (
            <Fragment key={p.id}>
            <tr onClick={() => onOpen(p)}>
              <td>
                <div className="name">{p.name}</div>
                <div className="sub mono">{(env && envDns(p, env)) || 'no DNS yet'}</div>
              </td>
              <td>
                <div>{p.owner.name}</div>
                <div className="sub">{p.owner.title}</div>
              </td>
              <td>
                <div className="mono">{env ? env.name : '—'}</div>
                <div className="sub">{envNames}</div>
              </td>
              <td>
                <StageBadge
                  stage={env?.stage ?? null}
                  label={env?.stage ? envStageDef(p, env, env.stage).shortLabel : undefined}
                />
              </td>
              <td><TeamBadge team={env?.team ?? null} /></td>
              <td>{env ? <SlaCell env={env} /> : <span className="sla ok">—</span>}</td>
              <td onClick={e => e.stopPropagation()}>
                {teamSla.length ? (
                  <button
                    className={`team-sla-toggle ${delayed.length ? 'late' : 'ok'} ${open ? 'open' : ''}`}
                    title="Show each team's time vs its SLA target"
                    onClick={() => setSlaOpen(open ? null : p.id)}
                  >
                    {delayed.length
                      ? `${delayed.length} team${delayed.length === 1 ? '' : 's'} late`
                      : 'on track'}
                    <span className="chev">{open ? '▴' : '▾'}</span>
                  </button>
                ) : <span className="sla ok">—</span>}
              </td>
              <td className="mono">{env ? formatDuration(totalElapsed(env)) : '—'}</td>
            </tr>
            {open && (
              <tr className="team-sla-detail" onClick={e => e.stopPropagation()}>
                <td colSpan={8}>
                  <div className="team-sla-grid">
                    {teamSla.map(t => (
                      <div className={`team-sla-item ${t.over ? 'over' : 'ok'}`} key={t.team}>
                        <span className="t-name">{TEAM_LABELS[t.team]}</span>
                        <span className="t-time mono">
                          {formatDuration(t.ms)} / {formatDuration(t.slaMs)} SLA
                        </span>
                        {t.over
                          ? <span className="t-flag over">delayed the project · over by {formatDuration(t.overBy)}</span>
                          : <span className="t-flag ok">within SLA</span>}
                      </div>
                    ))}
                  </div>
                  <div className="team-sla-note">
                    Time each team held the ball across this project’s environments (SLA-bearing stages only).
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
