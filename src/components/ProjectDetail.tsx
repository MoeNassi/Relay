import { useState } from 'react';
import type { Project, Environment, StageKey, Team } from '../types';
import {
  TEAM_LABELS, FIRST_STAGE, stageDef,
  orderedEnvs, envUnlocked, envStarted, envLive, activeEnv,
} from '../types';
import {
  stageBreakdown, totalElapsed, activeHandlingTime, formatDuration, slaStatus, nextStage,
} from '../store';
import { StageBadge, TeamBadge } from './badges';
import { TopBar } from './TopBar';
import { StatusChangeModal } from './StatusChangeModal';

interface Props {
  project: Project;
  presence?: React.ReactNode;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetStatus: (envId: string, stage: StageKey, team: Team, note: string) => void;
}

export function ProjectDetail({ project: p, presence, onBack, onEdit, onDelete, onSetStatus }: Props) {
  const envs = orderedEnvs(p);
  const [selId, setSelId] = useState<string>(() => activeEnv(p)?.id ?? envs[0]?.id ?? '');
  const [statusStage, setStatusStage] = useState<StageKey | null>(null);

  const env = envs.find(e => e.id === selId) ?? envs[0] ?? null;

  return (
    <>
      <TopBar
        crumbs={[
          { label: 'Relay Workspace' },
          { label: 'Projects', onClick: onBack },
          { label: p.name },
        ]}
        right={
          <>
            {presence}
            <button className="btn sm" onClick={onEdit}>Edit</button>
            <button className="btn sm danger" onClick={onDelete}>Delete</button>
          </>
        }
      />
      <div className="page">
        <div className="page-title-block">
          <div className="title-icon">{p.name.charAt(0).toUpperCase()}</div>
          <h1 className="page-title">{p.name}</h1>
          <div className="title-meta">
            <span className="meta-text">
              {p.owner.name}{p.owner.title ? ` · ${p.owner.title}` : ''}
            </span>
            {p.dns && <span className="meta-text mono">{p.dns}</span>}
            <span className="meta-text">{envs.length} environment{envs.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {/* ---- environment switcher ---- */}
        <div className="env-tabs">
          {envs.map(e => {
            const locked = !envUnlocked(p, e);
            const status = envLive(e) ? 'live' : envStarted(e) ? 'wip' : locked ? 'locked' : 'open';
            return (
              <button
                key={e.id}
                className={`env-tab ${e.id === selId ? 'active' : ''} st-${status}`}
                onClick={() => setSelId(e.id)}
              >
                <span className="env-tab-name">{e.name}</span>
                <span className="env-tab-status">
                  {status === 'live' ? '✓ live'
                    : status === 'wip' ? stageDef(e.stage!).shortLabel
                    : status === 'locked' ? '🔒 locked'
                    : 'ready'}
                </span>
              </button>
            );
          })}
        </div>

        {env && <EnvPanel
          project={p}
          env={env}
          onStart={() => setStatusStage(FIRST_STAGE)}
          onAdvance={() => { const n = nextStage(env); if (n) onSetStatus(env.id, n, stageDef(n).defaultTeam, ''); }}
          onChangeStatus={() => setStatusStage(env.stage ?? FIRST_STAGE)}
        />}

        {/* project-wide flows */}
        <div className="card">
          <h2>Matrice de flux<span className="hint">outgoing ports — shared across environments</span></h2>
          {p.flows.length ? (
            <table className="table">
              <thead>
                <tr><th>Source</th><th>Destination</th><th>Port</th><th>Proto</th><th>Direction</th><th>Note</th></tr>
              </thead>
              <tbody>
                {p.flows.map(f => (
                  <tr key={f.id} style={{ cursor: 'default' }}>
                    <td>{f.source}</td>
                    <td className="mono">{f.destination}</td>
                    <td className="mono">{f.port}</td>
                    <td className="mono">{f.protocol}</td>
                    <td>{f.direction}</td>
                    <td className="sub">{f.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">No flow rules declared.</div>
          )}
        </div>
      </div>

      {statusStage && env && (
        <StatusChangeModal
          projectName={p.name}
          envName={env.name}
          initialStage={statusStage}
          onClose={() => setStatusStage(null)}
          onSubmit={(stage, team, note) => { onSetStatus(env.id, stage, team, note); setStatusStage(null); }}
        />
      )}
    </>
  );
}

/* ---- the selected environment's pipeline + SLA ---- */
function EnvPanel({
  project: p, env, onStart, onAdvance, onChangeStatus,
}: {
  project: Project;
  env: Environment;
  onStart: () => void;
  onAdvance: () => void;
  onChangeStatus: () => void;
}) {
  const ordered = orderedEnvs(p);
  const idx = ordered.findIndex(e => e.id === env.id);
  const locked = !envUnlocked(p, env);
  const started = envStarted(env);

  if (locked) {
    const prev = ordered[idx - 1];
    return (
      <div className="card env-gate">
        <div className="gate-lock">🔒</div>
        <div>
          <div className="gate-title">“{env.name}” is locked</div>
          <div className="gate-sub">It unlocks once <strong>{prev?.name}</strong> reaches Live.</div>
        </div>
      </div>
    );
  }

  if (!started) {
    return (
      <div className="card env-gate">
        <div className="gate-lock">▶</div>
        <div>
          <div className="gate-title">“{env.name}” hasn’t started</div>
          <div className="gate-sub">Begin the pipeline with the architecture &amp; spec check.</div>
        </div>
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={onStart}>
          Start {env.name}
        </button>
      </div>
    );
  }

  const stages = stageBreakdown(env);
  const next = nextStage(env);
  const sla = slaStatus(env);
  const total = totalElapsed(env);
  const active = activeHandlingTime(env);
  const breachedCount = stages.filter(s => s.breached).length;
  const slaClass = sla ? (sla.ratio >= 1 ? 'over' : sla.ratio >= 0.7 ? 'warn' : 'ok') : 'ok';

  return (
    <>
      <div className="env-actions">
        <StageBadge stage={env.stage} />
        <TeamBadge team={env.team} />
        <div style={{ flex: 1 }} />
        {next && (
          <button className="btn primary sm" onClick={onAdvance}>
            Advance → {stageDef(next).shortLabel}
          </button>
        )}
        <button className="btn sm" onClick={onChangeStatus}>Change status</button>
      </div>

      <div className="sla-hero">
        <div className="sla-stat">
          <div className="sla-stat-label">Active handling time</div>
          <div className="sla-stat-value">{formatDuration(active)}</div>
          <div className="sla-stat-sub">team stages only (excl. development)</div>
        </div>
        <div className="sla-stat">
          <div className="sla-stat-label">Current stage</div>
          <div className="sla-stat-value">{stageDef(env.stage!).shortLabel}</div>
          <div className={`sla-stat-sub sla ${slaClass}`}>
            {sla ? `${formatDuration(sla.elapsed)} / ${formatDuration(sla.target)} SLA` : 'no SLA clock'}
          </div>
        </div>
        <div className="sla-stat">
          <div className="sla-stat-label">SLA breaches</div>
          <div className={`sla-stat-value ${breachedCount ? 'danger' : 'good'}`}>{breachedCount}</div>
          <div className="sla-stat-sub">{breachedCount ? 'stage(s) over target' : 'all within target'}</div>
        </div>
      </div>

      <div className="card">
        <h2>Time per stage<span className="hint">{env.name} — total wall-clock {formatDuration(total)}</span></h2>
        <div className="stage-rows">
          {stages.map(s => (
            <div className={`stage-row ${s.state} ${s.breached ? 'breached' : ''}`} key={s.key}>
              <span className={`stage-dot d-${s.key}`} />
              <span className="stage-name">{s.label}</span>
              {s.state === 'pending' ? (
                <span className="stage-dur pending">not started</span>
              ) : (
                <>
                  <span className={`stage-dur ${s.breached ? 'over' : s.noSla ? 'neutral' : s.state === 'current' ? 'current' : 'ok'}`}>
                    {formatDuration(s.ms ?? 0)}
                  </span>
                  <span className="stage-target">
                    {s.noSla ? 'no SLA' : `/ ${formatDuration(s.slaMs!)} SLA`}
                    {s.state === 'current' && ' · in progress'}
                  </span>
                  {s.breached && (
                    <span className="stage-flag">over by {formatDuration((s.ms ?? 0) - s.slaMs!)}</span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="detail-grid">
        <div className="card">
          <h2>VM specs<span className="hint">{env.name}</span></h2>
          {env.vms.length ? (
            <table className="table">
              <thead>
                <tr><th>Role</th><th>Count</th><th>vCPU</th><th>RAM</th><th>Disk</th><th>OS</th></tr>
              </thead>
              <tbody>
                {env.vms.map(vm => (
                  <tr key={vm.id} style={{ cursor: 'default' }}>
                    <td className="name">{vm.role}</td>
                    <td className="mono">{vm.count}</td>
                    <td className="mono">{vm.vcpu}</td>
                    <td className="mono">{vm.ramGb} GB</td>
                    <td className="mono">{vm.diskGb} GB</td>
                    <td>{vm.os}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="empty">No VMs declared.</div>}
        </div>

        <div className="card">
          <h2>Activity log<span className="hint">{env.name} — status changes &amp; comments</span></h2>
          <ol className="activity">
            {[...env.history].reverse().map((h, i) => (
              <li className="activity-item" key={env.history.length - i}>
                <span className={`stage-dot d-${h.stage}`} />
                <div className="activity-body">
                  <div className="activity-head">
                    <strong>{stageDef(h.stage).shortLabel}</strong>
                    <span className="activity-meta">
                      {TEAM_LABELS[h.team]}{h.by ? ` · ${h.by}` : ''}
                    </span>
                    <span className="activity-time">{new Date(h.enteredAt).toLocaleString()}</span>
                  </div>
                  {h.note && <div className="activity-note">“{h.note}”</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
