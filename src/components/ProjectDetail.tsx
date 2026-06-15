import { useState } from 'react';
import type { Project, StageKey, Team } from '../types';
import { TEAM_LABELS, stageDef } from '../types';
import { stageBreakdown, totalElapsed, formatDuration, slaStatus, nextStage } from '../store';
import { StageBadge, TeamBadge } from './badges';
import { TopBar } from './TopBar';
import { StatusChangeModal } from './StatusChangeModal';

interface Props {
  project: Project;
  presence?: React.ReactNode;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetStatus: (stage: StageKey, team: Team, note: string) => void;
}

export function ProjectDetail({ project: p, presence, onBack, onEdit, onDelete, onSetStatus }: Props) {
  const stages = stageBreakdown(p);
  const next = nextStage(p);
  const sla = slaStatus(p);
  const total = totalElapsed(p);
  const breachedCount = stages.filter(s => s.breached).length;

  // status-change modal: holds the stage to pre-select, or null when closed
  const [statusStage, setStatusStage] = useState<StageKey | null>(null);

  const slaClass = sla ? (sla.ratio >= 1 ? 'over' : sla.ratio >= 0.7 ? 'warn' : 'ok') : 'ok';

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
            {next && (
              <button className="btn primary sm" onClick={() => setStatusStage(next)}>
                Advance → {stageDef(next).shortLabel}
              </button>
            )}
            <button className="btn sm" onClick={() => setStatusStage(p.stage)}>Change status</button>
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
            <StageBadge stage={p.stage} />
            <TeamBadge team={p.team} />
            <span className="meta-text">
              {p.owner.name}{p.owner.title ? ` · ${p.owner.title}` : ''}
            </span>
            {p.dns && <span className="meta-text mono">{p.dns}</span>}
          </div>
        </div>

      {/* ---- SLA hero: the headline numbers ---- */}
      <div className="sla-hero">
        <div className="sla-stat">
          <div className="sla-stat-label">Total elapsed</div>
          <div className="sla-stat-value">{formatDuration(total)}</div>
          <div className="sla-stat-sub">{p.stage === 'live' ? 'delivered' : 'in flight'}</div>
        </div>
        <div className="sla-stat">
          <div className="sla-stat-label">Current stage</div>
          <div className="sla-stat-value">{stageDef(p.stage).shortLabel}</div>
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

      {/* ---- per-stage breakdown: how long each task took ---- */}
      <div className="card">
        <h2>Time per stage<span className="hint">how long each task took vs its SLA target</span></h2>
        <div className="stage-rows">
          {stages.map(s => (
            <div className={`stage-row ${s.state} ${s.breached ? 'breached' : ''}`} key={s.key}>
              <span className={`stage-dot d-${s.key}`} />
              <span className="stage-name">{s.label}</span>
              {s.state === 'pending' ? (
                <span className="stage-dur pending">not started</span>
              ) : (
                <>
                  <span className={`stage-dur ${s.breached ? 'over' : s.state === 'current' ? 'current' : 'ok'}`}>
                    {formatDuration(s.ms ?? 0)}
                  </span>
                  <span className="stage-target">
                    {s.slaMs != null ? `/ ${formatDuration(s.slaMs)} SLA` : 'no SLA'}
                    {s.state === 'current' && ' · in progress'}
                  </span>
                  {s.breached && s.slaMs != null && (
                    <span className="stage-flag">over by {formatDuration((s.ms ?? 0) - s.slaMs)}</span>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="detail-grid">
        <div className="card">
          <h2>Identity</h2>
          <dl className="kv">
            <dt>DNS</dt><dd className="mono">{p.dns || '—'}</dd>
            <dt>Owner</dt><dd>{p.owner.name}</dd>
            <dt>Title</dt><dd>{p.owner.title || '—'}</dd>
            <dt>Created</dt><dd>{new Date(p.createdAt).toLocaleDateString()}</dd>
            <dt>Ball at</dt><dd>{TEAM_LABELS[p.team]}</dd>
          </dl>
        </div>

        <div className="card">
          <h2>Activity log<span className="hint">status changes &amp; comments</span></h2>
          <ol className="activity">
            {[...p.history].reverse().map((h, i) => (
              <li className="activity-item" key={p.history.length - i}>
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

      {p.environments.map(env => (
        <div className="card" key={env.id}>
          <h2>Environment: {env.name}</h2>
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
        </div>
      ))}

      <div className="card">
        <h2>Matrice de flux</h2>
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

      {statusStage && (
        <StatusChangeModal
          project={p}
          initialStage={statusStage}
          onClose={() => setStatusStage(null)}
          onSubmit={(stage, team, note) => { onSetStatus(stage, team, note); setStatusStage(null); }}
        />
      )}
    </>
  );
}
