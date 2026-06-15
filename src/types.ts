export type StageKey = 'arch' | 'vms' | 'deploy' | 'scan' | 'publication' | 'live';

export type Team = 'infra' | 'network' | 'cybersec' | 'owner';

export interface StageDef {
  key: StageKey;
  label: string;
  shortLabel: string;
  /** Team that holds the ball by default at this stage */
  defaultTeam: Team;
  /** SLA target in hours; null = no clock (development/terminal stages) */
  slaHours: number | null;
}

/** The procedure every environment runs through, in order. */
export const STAGES: StageDef[] = [
  { key: 'arch',        label: 'Architecture & spec check', shortLabel: 'Arch',    defaultTeam: 'infra',    slaHours: 48 },
  { key: 'vms',         label: 'VM creation',               shortLabel: 'VMs',     defaultTeam: 'infra',    slaHours: 120 },
  { key: 'deploy',      label: 'Development & deployment',   shortLabel: 'Deploy',  defaultTeam: 'owner',    slaHours: null },
  { key: 'scan',        label: 'Security scan',             shortLabel: 'Scan',    defaultTeam: 'cybersec', slaHours: 168 },
  { key: 'publication', label: 'URL publication',           shortLabel: 'Publish', defaultTeam: 'network',  slaHours: 48 },
  { key: 'live',        label: 'Live in production',        shortLabel: 'Live',    defaultTeam: 'owner',    slaHours: null },
];

export const FIRST_STAGE = STAGES[0].key;

export const TEAM_LABELS: Record<Team, string> = {
  infra: 'Infrastructure',
  network: 'Network',
  cybersec: 'Cybersecurity',
  owner: 'Project owner',
};

/** Promotion order. Known envs rank first in this order; unknowns fall to the end. */
export const ENV_ORDER = ['dev', 'preprod', 'prod'];
export function envRank(name: string): number {
  const i = ENV_ORDER.indexOf(name.trim().toLowerCase());
  return i < 0 ? ENV_ORDER.length : i;
}

export interface VmSpec {
  id: string;
  role: string; // e.g. "app server", "db"
  count: number;
  vcpu: number;
  ramGb: number;
  diskGb: number;
  os: string;
}

export interface HistoryEntry {
  stage: StageKey;
  team: Team;
  enteredAt: string; // ISO
  note?: string;     // optional comment captured at the status change
  by?: string;       // who made the change (user name or agent key name)
}

export interface Environment {
  id: string;
  name: string; // dev | preprod | prod | custom
  vms: VmSpec[];
  /** Pipeline state for THIS environment. null/empty = not started yet. */
  stage: StageKey | null;
  team: Team | null;
  history: HistoryEntry[];
}

export interface FlowRule {
  id: string;
  source: string;
  destination: string;
  port: string; // "443" or "8000-8010"
  protocol: 'TCP' | 'UDP';
  direction: 'outbound' | 'inbound';
  note: string;
}

export interface Project {
  id: string;
  name: string;
  dns: string;
  owner: { name: string; title: string };
  environments: Environment[];
  flows: FlowRule[];
  createdAt: string;
}

export const stageIndex = (key: StageKey) => STAGES.findIndex(s => s.key === key);
export const stageDef = (key: StageKey) => STAGES[stageIndex(key)];

/* ---------- environment helpers ---------- */

/** Environments sorted by promotion order (dev → preprod → prod → customs). */
export function orderedEnvs(p: Project): Environment[] {
  return [...p.environments]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => envRank(a.e.name) - envRank(b.e.name) || a.i - b.i)
    .map(x => x.e);
}

export const envStarted = (e: Environment) => e.history.length > 0;
export const envLive = (e: Environment) => e.stage === 'live';

/** An env can be started once the previous env in order is Live (first one is always open). */
export function envUnlocked(p: Project, env: Environment): boolean {
  const ordered = orderedEnvs(p);
  const idx = ordered.findIndex(e => e.id === env.id);
  if (idx <= 0) return true;
  return envLive(ordered[idx - 1]);
}

/** The environment to surface in lists: the in-progress one, else last live, else first. */
export function activeEnv(p: Project): Environment | null {
  const ordered = orderedEnvs(p);
  if (!ordered.length) return null;
  const inProgress = ordered.find(e => envStarted(e) && !envLive(e));
  if (inProgress) return inProgress;
  const lastLive = [...ordered].reverse().find(e => envLive(e));
  return lastLive ?? ordered[0];
}
