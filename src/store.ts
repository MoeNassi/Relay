import type { Project, StageKey, Team, HistoryEntry } from './types';
import { STAGES, stageIndex, stageDef } from './types';

const KEY = 'relay-projects';

export const uid = () => Math.random().toString(36).slice(2, 10);

function seed(): Project[] {
  const h = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
  return [
    {
      id: uid(),
      name: 'Cartographie Apps',
      dns: 'cartographie.um6p.ma',
      owner: { name: 'C. Ibnsina', title: 'IT Project Manager' },
      environments: [
        {
          id: uid(),
          name: 'prod',
          vms: [
            { id: uid(), role: 'app server', count: 2, vcpu: 4, ramGb: 8, diskGb: 80, os: 'Ubuntu 24.04' },
            { id: uid(), role: 'db', count: 1, vcpu: 4, ramGb: 16, diskGb: 200, os: 'Ubuntu 24.04' },
          ],
        },
        {
          id: uid(),
          name: 'dev',
          vms: [{ id: uid(), role: 'all-in-one', count: 1, vcpu: 2, ramGb: 4, diskGb: 60, os: 'Ubuntu 24.04' }],
        },
      ],
      flows: [
        { id: uid(), source: 'app server', destination: 'db', port: '5432', protocol: 'TCP', direction: 'outbound', note: 'PostgreSQL' },
        { id: uid(), source: 'app server', destination: 'smtp.um6p.ma', port: '587', protocol: 'TCP', direction: 'outbound', note: 'Mail relay' },
      ],
      stage: 'scan',
      team: 'cybersec',
      history: [
        { stage: 'new', team: 'owner', enteredAt: h(14) },
        { stage: 'vms', team: 'infra', enteredAt: h(12) },
        { stage: 'scan', team: 'cybersec', enteredAt: h(4) },
      ],
      createdAt: h(14),
    },
    {
      id: uid(),
      name: 'HR Portal',
      dns: 'hr.um6p.ma',
      owner: { name: 'S. Alaoui', title: 'HR Director' },
      environments: [
        {
          id: uid(),
          name: 'prod',
          vms: [{ id: uid(), role: 'app server', count: 1, vcpu: 8, ramGb: 16, diskGb: 120, os: 'RHEL 9' }],
        },
      ],
      flows: [
        { id: uid(), source: 'app server', destination: 'ad.um6p.ma', port: '636', protocol: 'TCP', direction: 'outbound', note: 'LDAPS' },
      ],
      stage: 'vms',
      team: 'infra',
      history: [
        { stage: 'new', team: 'owner', enteredAt: h(9) },
        { stage: 'vms', team: 'infra', enteredAt: h(7) },
      ],
      createdAt: h(9),
    },
  ];
}

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* corrupted -> reseed */
  }
  const s = seed();
  localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(KEY, JSON.stringify(projects));
}

export function advanceStage(p: Project, to: StageKey, team?: Team): Project {
  const t = team ?? stageDef(to).defaultTeam;
  const entry: HistoryEntry = { stage: to, team: t, enteredAt: new Date().toISOString() };
  return { ...p, stage: to, team: t, history: [...p.history, entry] };
}

/** Time spent in each visited stage, in ms. Current stage counts up to now. */
export function stageDurations(p: Project): Partial<Record<StageKey, number>> {
  const out: Partial<Record<StageKey, number>> = {};
  for (let i = 0; i < p.history.length; i++) {
    const cur = p.history[i];
    const end = i + 1 < p.history.length ? new Date(p.history[i + 1].enteredAt).getTime() : Date.now();
    const start = new Date(cur.enteredAt).getTime();
    out[cur.stage] = (out[cur.stage] ?? 0) + Math.max(0, end - start);
  }
  return out;
}

export function totalElapsed(p: Project): number {
  if (!p.history.length) return 0;
  const start = new Date(p.history[0].enteredAt).getTime();
  const end = p.stage === 'live'
    ? new Date(p.history[p.history.length - 1].enteredAt).getTime()
    : Date.now();
  return Math.max(0, end - start);
}

export function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}min`;
  const d = Math.floor(h / 24);
  if (d < 1) return `${h}h`;
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** SLA status of the CURRENT stage: ratio of elapsed vs target. */
export function slaStatus(p: Project): { ratio: number; elapsed: number; target: number } | null {
  const def = stageDef(p.stage);
  if (def.slaHours == null) return null;
  const last = p.history[p.history.length - 1];
  if (!last) return null;
  const elapsed = Date.now() - new Date(last.enteredAt).getTime();
  const target = def.slaHours * 3600_000;
  return { ratio: elapsed / target, elapsed, target };
}

export function nextStage(p: Project): StageKey | null {
  const i = stageIndex(p.stage);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1].key : null;
}
