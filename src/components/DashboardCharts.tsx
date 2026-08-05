import { useMemo } from 'react';
import type { Project, Team } from '../types';
import { TEAM_LABELS } from '../types';
import { projectTeamSla, slaStatus, formatDuration } from '../store';
import { envStarted, envLive } from '../types';

const TEAM_COLOR: Record<Team, string> = {
  devops: '#8054ff',
  infra: '#1e96eb',
  network: '#0d9488',
  cybersec: '#eb4335',
  owner: '#8e8d91',
};

/** Dashboard monitoring: SLA health of in-flight envs + time spent per team. */
export function DashboardCharts({ projects }: { projects: Project[] }) {
  const { teams, worst, health, inFlight } = useMemo(() => {
    // same math as the per-project "Team SLA" breakdown, summed across projects
    const totals: Partial<Record<Team, { ms: number; slaMs: number }>> = {};
    const health = { ok: 0, warn: 0, over: 0 };
    let inFlight = 0;
    for (const p of projects) {
      for (const t of projectTeamSla(p)) {
        const cur = totals[t.team] ?? { ms: 0, slaMs: 0 };
        cur.ms += t.ms;
        cur.slaMs += t.slaMs;
        totals[t.team] = cur;
      }
      for (const env of p.environments) {
        if (envStarted(env) && !envLive(env)) {
          const s = slaStatus(env);
          if (s) {
            inFlight++;
            if (s.ratio >= 1) health.over++;
            else if (s.ratio >= 0.7) health.warn++;
            else health.ok++;
          }
        }
      }
    }
    const teams = (Object.keys(totals) as Team[])
      .map(t => {
        const { ms, slaMs } = totals[t]!;
        return { team: t, ms, slaMs, over: ms > slaMs, overBy: Math.max(0, ms - slaMs) };
      })
      .filter(x => x.ms > 0)
      .sort((a, b) => b.overBy - a.overBy || b.ms - a.ms);
    return { teams, worst: teams.find(t => t.over) ?? null, health, inFlight };
  }, [projects]);

  const maxMs = Math.max(1, ...teams.map(t => t.ms));
  const healthTotal = Math.max(1, health.ok + health.warn + health.over);

  return (
    <div className="dash-charts">
      {/* ---- SLA health of in-flight environments ---- */}
      <div className="card chart-card">
        <h2>SLA health<span className="hint">{inFlight} environment{inFlight === 1 ? '' : 's'} in flight</span></h2>
        {inFlight ? (
          <>
            <div className="health-bar">
              <span className="seg ok" style={{ width: `${(health.ok / healthTotal) * 100}%` }} />
              <span className="seg warn" style={{ width: `${(health.warn / healthTotal) * 100}%` }} />
              <span className="seg over" style={{ width: `${(health.over / healthTotal) * 100}%` }} />
            </div>
            <div className="health-legend">
              <span><i className="dot ok" /> On track <b>{health.ok}</b></span>
              <span><i className="dot warn" /> At risk <b>{health.warn}</b></span>
              <span><i className="dot over" /> Breached <b>{health.over}</b></span>
            </div>
          </>
        ) : (
          <div className="empty">Nothing in flight — every environment is idle or live.</div>
        )}
      </div>

      {/* ---- time spent per team (the bottleneck) ---- */}
      <div className="card chart-card">
        <h2>
          Time by team vs SLA
          <span className="hint">
            {worst
              ? <>most delayed: <b>{TEAM_LABELS[worst.team]}</b> (over by {formatDuration(worst.overBy)})</>
              : teams.length ? 'all teams within their SLA targets' : 'handling time across all projects'}
          </span>
        </h2>
        {teams.length ? (
          <div className="team-bars">
            {teams.map(({ team, ms, slaMs, over, overBy }) => (
              <div className="team-bar-row" key={team}>
                <span className="team-bar-label">{TEAM_LABELS[team]}</span>
                <div className="team-bar-track">
                  <span
                    className={`team-bar-fill ${over ? 'lead' : ''}`}
                    style={{ width: `${(ms / maxMs) * 100}%`, background: TEAM_COLOR[team] }}
                  />
                </div>
                <span className="team-bar-val">
                  {formatDuration(ms)} / {formatDuration(slaMs)}
                  {over && <span className="team-bar-flag">+{formatDuration(overBy)}</span>}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">No handling time recorded yet.</div>
        )}
      </div>
    </div>
  );
}
