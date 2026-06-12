export type StageKey = 'new' | 'vms' | 'scan' | 'publication' | 'live';

export type Team = 'infra' | 'cybersec' | 'owner';

export interface StageDef {
  key: StageKey;
  label: string;
  shortLabel: string;
  /** Team that holds the ball by default at this stage */
  defaultTeam: Team;
  /** SLA target in hours; null = no clock (terminal stage) */
  slaHours: number | null;
}

export const STAGES: StageDef[] = [
  { key: 'new', label: 'New — Scoping & request', shortLabel: 'New', defaultTeam: 'owner', slaHours: 48 },
  { key: 'vms', label: 'Creating VMs', shortLabel: 'VMs', defaultTeam: 'infra', slaHours: 120 },
  { key: 'scan', label: 'Security scan', shortLabel: 'Scan', defaultTeam: 'cybersec', slaHours: 168 },
  { key: 'publication', label: 'URL publication', shortLabel: 'Publish', defaultTeam: 'infra', slaHours: 48 },
  { key: 'live', label: 'Live in production', shortLabel: 'Live', defaultTeam: 'owner', slaHours: null },
];

export const TEAM_LABELS: Record<Team, string> = {
  infra: 'Network & Infra',
  cybersec: 'Cybersecurity',
  owner: 'Project owner',
};

export interface VmSpec {
  id: string;
  role: string; // e.g. "app server", "db"
  count: number;
  vcpu: number;
  ramGb: number;
  diskGb: number;
  os: string;
}

export interface Environment {
  id: string;
  name: string; // dev | preprod | prod | custom
  vms: VmSpec[];
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

export interface HistoryEntry {
  stage: StageKey;
  team: Team;
  enteredAt: string; // ISO
}

export interface Project {
  id: string;
  name: string;
  dns: string;
  owner: { name: string; title: string };
  environments: Environment[];
  flows: FlowRule[];
  stage: StageKey;
  team: Team;
  history: HistoryEntry[];
  createdAt: string;
}

export const stageIndex = (key: StageKey) => STAGES.findIndex(s => s.key === key);
export const stageDef = (key: StageKey) => STAGES[stageIndex(key)];
