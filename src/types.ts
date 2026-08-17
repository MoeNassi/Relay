export type StageKey = 'arch' | 'vms' | 'gitlab' | 'pipeline' | 'deploy' | 'scan' | 'publication' | 'live';

export type Team = 'devops' | 'infra' | 'network' | 'cybersec' | 'owner';

/** The three security scans that run under the `scan` stage. */
export type ScanType = 'agent' | 'pentest' | 'cloud';

export const SCAN_TYPES: ScanType[] = ['agent', 'pentest', 'cloud'];

export const SCAN_LABELS: Record<ScanType, string> = {
  agent: 'Agent scan',
  pentest: 'Penetration test',
  cloud: 'Cloud scan',
};

/** A completed sub-scan; null/absent means still outstanding. */
export interface ScanResult {
  at: string;      // ISO completion time
  by?: string;     // who marked it done
  note?: string;
}

export type ScanState = Record<ScanType, ScanResult | null>;

export const emptyScans = (): ScanState => ({ agent: null, pentest: null, cloud: null });

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
  { key: 'arch',        label: 'Architecture & spec check', shortLabel: 'Arch',    defaultTeam: 'devops',   slaHours: 48 },
  { key: 'vms',         label: 'VM creation',               shortLabel: 'VMs',     defaultTeam: 'infra',    slaHours: 48 },
  { key: 'gitlab',      label: 'GitLab access',             shortLabel: 'GitLab',  defaultTeam: 'devops',   slaHours: 48 },
  { key: 'pipeline',    label: 'CI/CD pipeline check',      shortLabel: 'Pipeline', defaultTeam: 'devops',  slaHours: 48 },
  { key: 'deploy',      label: 'Development & deployment',   shortLabel: 'Deploy',  defaultTeam: 'owner',    slaHours: null },
  { key: 'publication', label: 'URL publication',           shortLabel: 'Publish', defaultTeam: 'network',  slaHours: 48 },
  { key: 'scan',        label: 'Security scan',             shortLabel: 'Scan',    defaultTeam: 'cybersec', slaHours: 120 },
  { key: 'live',        label: 'Live in production',        shortLabel: 'Live',    defaultTeam: 'owner',    slaHours: null },
];

export const FIRST_STAGE = STAGES[0].key;

export const TEAM_LABELS: Record<Team, string> = {
  devops: 'IT-Prod (DevOps)',
  infra: 'Infrastructure',
  network: 'Network',
  cybersec: 'Cybersecurity',
  owner: 'Project owner',
};

/** Promotion order. Known envs rank first in this order; unknowns fall to the end. */
export const ENV_ORDER = ['dev', 'rec', 'preprod', 'prod'];
export function envRank(name: string): number {
  const i = ENV_ORDER.indexOf(name.trim().toLowerCase());
  return i < 0 ? ENV_ORDER.length : i;
}

/** OS choices that map cleanly to VMProv `vm_type` (UBUNTU / WINDOWS-FR / WINDOWS-EN). */
export const OS_OPTIONS = ['Ubuntu', 'Windows-FR', 'Windows-EN'] as const;

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
  /**
   * 'scan' entries are informational logs (scan passed/unchecked/reset) kept
   * for traceability — they are excluded from SLA/duration math. Absent or
   * 'status' means a real stage transition.
   */
  kind?: 'status' | 'scan';
}

export interface Environment {
  id: string;
  name: string; // dev | rec | preprod | prod | custom
  /** DNS published for THIS environment (e.g. app-dev.um6p.ma vs app.um6p.ma). */
  dns?: string;
  vms: VmSpec[];
  /** Pipeline state for THIS environment. null/empty = not started yet. */
  stage: StageKey | null;
  team: Team | null;
  history: HistoryEntry[];
  /** Per-type security scans tracked under the `scan` stage. */
  scans: ScanState;
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
  /** Legacy project-wide DNS — superseded by per-environment `dns`; kept for old data. */
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
/** DNS to show for an env — its own, falling back to the legacy project-wide one. */
export const envDns = (p: Project, e: Environment) => (e.dns?.trim() || p.dns || '').trim();
export const envLive = (e: Environment) => e.stage === 'live';
export const isProdEnv = (e: Environment) => e.name.trim().toLowerCase() === 'prod';

/** One-time tasks: run once for the whole project, on the first environment only. */
export const ONE_TIME_STAGES: StageKey[] = ['arch', 'vms', 'gitlab', 'pipeline'];

/**
 * The stages THIS environment actually runs. Architecture & spec check and VM
 * creation are one-time tasks carried only by the first environment (promotion
 * order). The terminal stage reads "Live in production" only on prod — every
 * other environment simply completes.
 */
export function envStages(p: Project, env: Environment): StageDef[] {
  const first = orderedEnvs(p)[0];
  const isFirst = !!first && first.id === env.id;
  return STAGES
    .filter(s => isFirst || !ONE_TIME_STAGES.includes(s.key))
    .map(s => s.key === 'live' && !isProdEnv(env)
      ? { ...s, label: 'Completed', shortLabel: 'Done' }
      : s);
}

/** First stage this environment starts at ('arch' for the first env, 'deploy' after). */
export const envFirstStage = (p: Project, env: Environment): StageKey =>
  envStages(p, env)[0].key;

/** Stage def as it applies to this env (label overrides), falling back to the global def. */
export const envStageDef = (p: Project, env: Environment, key: StageKey): StageDef =>
  envStages(p, env).find(s => s.key === key) ?? stageDef(key);

/**
 * Whether the three security scans are mandatory for this environment. Every
 * environment must be scanned before going live EXCEPT `dev`, which is exempt.
 */
export const scanRequired = (e: Environment) => e.name.trim().toLowerCase() !== 'dev';

/** How many of the three sub-scans are complete. */
export const scansDone = (e: Environment) =>
  SCAN_TYPES.filter(t => e.scans?.[t]).length;

/** True once every required sub-scan is complete (always true when not required). */
export const scansSatisfied = (e: Environment) =>
  !scanRequired(e) || scansDone(e) === SCAN_TYPES.length;

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
