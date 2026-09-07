import { useState } from 'react';
import type { Project, Environment, StageKey, Team, ScanType, VmProvision, VmProvisionStatus } from '../types';
import {
  TEAM_LABELS, stageDef, stageIndex,
  SCAN_TYPES, SCAN_LABELS, scanRequired, scansDone, scansSatisfied,
  orderedEnvs, envUnlocked, envStarted, envLive, activeEnv,
  envStages, envFirstStage, isProdEnv, envDns,
} from '../types';
import {
  stageBreakdown, totalElapsed, activeHandlingTime, formatDuration, slaStatus, nextStage,
} from '../store';
import { StageBadge, TeamBadge } from './badges';
import { TopBar } from './TopBar';
import { StatusChangeModal } from './StatusChangeModal';
import { ArrowLeftIcon } from './icons';

interface Props {
  project: Project;
  presence?: React.ReactNode;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetStatus: (envId: string, stage: StageKey, team: Team, note: string) => void;
  onSetScan: (envId: string, scanType: ScanType, done: boolean) => void;
}

export function ProjectDetail({ project: p, presence, onBack, onEdit, onDelete, onSetStatus, onSetScan }: Props) {
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
        <button className="back-link" onClick={onBack}>
          <ArrowLeftIcon size={15} /> Back to projects
        </button>
        <div className="page-title-block">
          <div className="title-icon">{p.name.charAt(0).toUpperCase()}</div>
          <h1 className="page-title">{p.name}</h1>
          <div className="title-meta">
            <span className="meta-text">
              {p.owner.name}{p.owner.title ? ` · ${p.owner.title}` : ''}
            </span>
            {env && envDns(p, env) && <span className="meta-text mono">{envDns(p, env)}</span>}
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
                  {status === 'live' ? (isProdEnv(e) ? '✓ live' : '✓ done')
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
          onStart={() => setStatusStage(envFirstStage(p, env))}
          onAdvance={() => {
            const n = nextStage(env, envStages(p, env));
            if (n) onSetStatus(env.id, n, stageDef(n).defaultTeam, '');
          }}
          onChangeStatus={() => setStatusStage(env.stage ?? envFirstStage(p, env))}
          onSetScan={(scanType, done) => onSetScan(env.id, scanType, done)}
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
          stages={envStages(p, env)}
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
  project: p, env, onStart, onAdvance, onChangeStatus, onSetScan,
}: {
  project: Project;
  env: Environment;
  onStart: () => void;
  onAdvance: () => void;
  onChangeStatus: () => void;
  onSetScan: (scanType: ScanType, done: boolean) => void;
}) {
  const ordered = orderedEnvs(p);
  const idx = ordered.findIndex(e => e.id === env.id);
  const locked = !envUnlocked(p, env);
  const started = envStarted(env);
  // Stages THIS env runs: arch/vms only on the first env, "Completed" instead
  // of "Live in production" everywhere but prod.
  const envStageList = envStages(p, env);
  const defFor = (k: StageKey) => envStageList.find(s => s.key === k) ?? stageDef(k);

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
          <div className="gate-sub">
            {envStageList[0].key === 'arch'
              ? <>Begin the pipeline with the architecture &amp; spec check.</>
              : <>Begin the pipeline with {envStageList[0].label.toLowerCase()} — architecture &amp; VM creation are one-time tasks already handled on the first environment.</>}
          </div>
        </div>
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={onStart}>
          Start {env.name}
        </button>
      </div>
    );
  }

  const stages = stageBreakdown(env, envStageList);
  const next = nextStage(env, envStageList);
  // At the scan stage, going live is blocked until every required sub-scan
  // passes (dev is exempt). Mirrors the server-side 409 guard.
  const scanGate = env.stage === 'scan' && !scansSatisfied(env);
  const sla = slaStatus(env);
  const total = totalElapsed(env);
  const active = activeHandlingTime(env);
  const breachedCount = stages.filter(s => s.breached).length;
  const slaClass = sla ? (sla.ratio >= 1 ? 'over' : sla.ratio >= 0.7 ? 'warn' : 'ok') : 'ok';

  return (
    <>
      <div className="env-actions">
        <StageBadge stage={env.stage} label={env.stage ? defFor(env.stage).shortLabel : undefined} />
        <TeamBadge team={env.team} />
        <div style={{ flex: 1 }} />
        {next && (
          <button
            className="btn primary sm"
            onClick={onAdvance}
            disabled={scanGate}
            title={scanGate ? 'Complete all security scans before advancing' : undefined}
          >
            Advance → {defFor(next).shortLabel}
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
          <div className="sla-stat-value">{defFor(env.stage!).shortLabel}</div>
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

      {stageIndex(env.stage!) >= stageIndex('scan') && (
        <div className="card">
          <h2>
            Security scans
            <span className="hint">
              {scanRequired(env)
                ? `${scansDone(env)}/${SCAN_TYPES.length} passed — all required before go-live`
                : `${env.name} is exempt — scans optional`}
            </span>
          </h2>
          <div className="scan-rows">
            {SCAN_TYPES.map(t => {
              const done = env.scans?.[t] ?? null;
              return (
                <label className={`scan-row ${done ? 'done' : 'pending'}`} key={t}>
                  <input
                    type="checkbox"
                    checked={!!done}
                    onChange={e => onSetScan(t, e.target.checked)}
                  />
                  <span className="scan-name">{SCAN_LABELS[t]}</span>
                  {done ? (
                    <span className="scan-meta">
                      passed {new Date(done.at).toLocaleString()}{done.by ? ` · ${done.by}` : ''}
                    </span>
                  ) : (
                    <span className="scan-meta pending">outstanding</span>
                  )}
                </label>
              );
            })}
          </div>
          {scanGate && (
            <div className="scan-gate-note">
              🔒 Going live is blocked until all three scans pass.
            </div>
          )}
        </div>
      )}

      {env.vmProvision && <VmProvisionCard vp={env.vmProvision} />}

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
              <li className={`activity-item ${h.kind === 'scan' ? 'scan-log' : ''}`} key={env.history.length - i}>
                <span className={`stage-dot d-${h.stage}`} />
                <div className="activity-body">
                  <div className="activity-head">
                    <strong>{h.kind === 'scan' ? 'Security scan' : defFor(h.stage).shortLabel}</strong>
                    <span className="activity-meta">
                      {TEAM_LABELS[h.team]}{h.by ? ` · ${h.by}` : ''}
                    </span>
                    <span className="activity-time">{new Date(h.enteredAt).toLocaleString()}</span>
                  </div>
                  {h.note && <div className="activity-note">{h.kind === 'scan' ? h.note : `“${h.note}”`}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}

/* ---------- VMProv provisioning + credentials ---------- */

const PROV_LABELS: Record<VmProvisionStatus, string> = {
  submitting: 'Submitting…',
  submitted: 'Pending acceptance',
  created: 'Created',
  failed: 'Failed',
  error: 'Error',
};

function copyText(t: string) {
  navigator.clipboard?.writeText(t).catch(() => { /* clipboard blocked */ });
}

function VmProvisionCard({ vp }: { vp: VmProvision }) {
  const creds = vp.credentials ?? [];
  const status = vp.status;
  return (
    <div className="card prov-card">
      <h2>VM provisioning<span className="hint">VMProv{vp.jobId ? ` · ${vp.jobId}` : ''}</span></h2>
      <div className="prov-head">
        <span className={`prov-badge prov-${status ?? 'unknown'}`}>
          {status ? (PROV_LABELS[status] ?? status) : 'Unknown'}
        </span>
        {vp.result && (
          <span className="prov-summary mono">
            {vp.result.successful ?? '?'}/{vp.result.total ?? '?'} VM(s) created
          </span>
        )}
        {vp.attempts ? <span className="sub">attempt {vp.attempts}</span> : null}
      </div>
      {vp.lastError && <div className="prov-error">{vp.lastError}</div>}

      {creds.length > 0 ? (
        <div className="prov-creds">
          <div className="prov-creds-warn">
            ⚠ Initial credentials — held in memory only, never stored. Copy them now; they vanish on server restart.
          </div>
          {creds.map((vm, i) => <CredBlock key={i} vm={vm} />)}
        </div>
      ) : status === 'created' ? (
        <div className="empty">No credentials returned by VMProv.</div>
      ) : null}
    </div>
  );
}

function CredBlock({ vm }: { vm: Record<string, unknown> }) {
  const title = (vm.name as string) || (vm.hostname as string) || (vm.ip as string) || 'VM';
  const entries = Object.entries(vm).filter(([, v]) => v != null);
  return (
    <div className="cred-block">
      <div className="cred-title mono">{title}</div>
      <table className="table">
        <tbody>
          {entries.map(([k, v]) => {
            const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
            return (
              <tr key={k}>
                <td className="cred-key">{k}</td>
                <td className="cred-val mono">
                  <span>{val}</span>
                  <button className="btn sm" type="button" onClick={() => copyText(val)}>copy</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
