import type { Project, StageKey, Team } from '../types';
import { stageDef, TEAM_LABELS } from '../types';
import { slaStatus, formatDuration } from '../store';

export function StageBadge({ stage }: { stage: StageKey }) {
  return (
    <span className={`badge b-${stage}`}>
      <span className="dot" />
      {stageDef(stage).shortLabel}
    </span>
  );
}

export function TeamBadge({ team }: { team: Team }) {
  return <span className="badge b-team">🏐 {TEAM_LABELS[team]}</span>;
}

/** Elapsed time in the current stage vs its SLA target. */
export function SlaCell({ project }: { project: Project }) {
  const s = slaStatus(project);
  if (!s) return <span className="sla ok">—</span>;
  const cls = s.ratio >= 1 ? 'over' : s.ratio >= 0.7 ? 'warn' : 'ok';
  return (
    <span className={`sla ${cls}`} title={`Target: ${formatDuration(s.target)}`}>
      {formatDuration(s.elapsed)} / {formatDuration(s.target)}
    </span>
  );
}
