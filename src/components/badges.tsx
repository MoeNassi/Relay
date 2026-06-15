import type { Environment, StageKey, Team } from '../types';
import { stageDef, TEAM_LABELS } from '../types';
import { slaStatus, formatDuration } from '../store';
import { ServerIcon, ShieldIcon, UserIcon, NetworkIcon } from './icons';

export function StageBadge({ stage }: { stage: StageKey | null }) {
  if (!stage) return <span className="badge b-none"><span className="dot" />Not started</span>;
  return (
    <span className={`badge b-${stage}`}>
      <span className="dot" />
      {stageDef(stage).shortLabel}
    </span>
  );
}

const TEAM_ICONS: Record<Team, React.ReactNode> = {
  infra: <ServerIcon size={13} />,
  network: <NetworkIcon size={13} />,
  cybersec: <ShieldIcon size={13} />,
  owner: <UserIcon size={13} />,
};

export function TeamBadge({ team }: { team: Team | null }) {
  if (!team) return <span className="badge b-team">—</span>;
  return <span className="badge b-team">{TEAM_ICONS[team]} {TEAM_LABELS[team]}</span>;
}

/** Elapsed time in the environment's current stage vs its SLA target. */
export function SlaCell({ env }: { env: Environment }) {
  const s = slaStatus(env);
  if (!s) return <span className="sla ok">—</span>;
  const cls = s.ratio >= 1 ? 'over' : s.ratio >= 0.7 ? 'warn' : 'ok';
  return (
    <span className={`sla ${cls}`} title={`Target: ${formatDuration(s.target)}`}>
      {formatDuration(s.elapsed)} / {formatDuration(s.target)}
    </span>
  );
}
