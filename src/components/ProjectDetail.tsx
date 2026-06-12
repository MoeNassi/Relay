import type { Project } from '../types';
import { STAGES, TEAM_LABELS, stageIndex, stageDef } from '../types';
import { stageDurations, totalElapsed, formatDuration, nextStage } from '../store';
import { StageBadge, TeamBadge, SlaCell } from './badges';

interface Props {
  project: Project;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAdvance: () => void;
}

export function ProjectDetail({ project: p, onBack, onEdit, onDelete, onAdvance }: Props) {
  const durations = stageDurations(p);
  const curIdx = stageIndex(p.stage);
  const next = nextStage(p);

  return (
    <div className="page">
      <button className="back" onClick={onBack}>← All projects</button>

      <div className="page-head">
        <h1>{p.name}</h1>
        <StageBadge stage={p.stage} />
        <TeamBadge team={p.team} />
        <div className="spacer" />
        {next && (
          <button className="btn primary" onClick={onAdvance}>
            Advance → {stageDef(next).shortLabel}
          </button>
        )}
        <button className="btn" onClick={onEdit}>Edit</button>
        <button className="btn danger" onClick={onDelete}>Delete</button>
      </div>

      <div className="card">
        <h2>
          Pipeline &amp; SLA
          <span className="hint">total: {formatDuration(totalElapsed(p))} — current stage: <SlaCell project={p} /></span>
        </h2>
        <div className="pipeline">
          {STAGES.map((s, i) => {
            const cls = i < curIdx ? 'done' : i === curIdx ? 'current' : '';
            const d = durations[s.key];
            return (
              <div className={`step ${cls}`} key={s.key}>
                <div className="bar" />
                <div className="s-label">{s.shortLabel}</div>
                <div className="s-time">
                  {d != null ? formatDuration(d) : '—'}
                  {s.slaHours != null && ` / ${formatDuration(s.slaHours * 3600_000)}`}
                </div>
              </div>
            );
          })}
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
          <h2>History</h2>
          <dl className="kv">
            {p.history.map((h, i) => (
              <FragmentRow key={i} label={stageDef(h.stage).shortLabel}
                value={`${new Date(h.enteredAt).toLocaleString()} · ${TEAM_LABELS[h.team]}`} />
            ))}
          </dl>
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
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
