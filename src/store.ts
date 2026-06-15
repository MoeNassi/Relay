import type { Project, StageKey } from './types';
import { STAGES, stageIndex, stageDef } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- API client (server is the source of truth) ---------- */

let apiKey: string | null = null;

// In SSO mode the browser authenticates by session cookie, so /api/key is gone
// (404) and we rely on the cookie. In dev mode the server hands out a key here.
// Only a *successful* fetch is cached — a failure is never latched, so toggling
// SSO on/off (or starting the server later) self-heals without a page refresh.
async function ensureKey(force = false): Promise<string | null> {
  if (apiKey && !force) return apiKey;
  try {
    const res = await fetch('/api/key');
    if (res.ok) apiKey = (await res.json()).key;
  } catch { /* SSO mode or server down — fall back to cookie auth */ }
  return apiKey;
}

async function doFetch(method: string, url: string, body: unknown, key: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers['X-API-Key'] = key;
  return fetch(url, {
    method,
    headers,
    credentials: 'same-origin',   // send the session cookie in SSO mode
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res = await doFetch(method, url, body, await ensureKey());
  // A 401 can mean our cached key is stale (e.g. SSO was just toggled, or the
  // server restarted). Re-fetch the key once and retry before giving up.
  if (res.status === 401) {
    const fresh = await ensureKey(true);
    if (fresh) res = await doFetch(method, url, body, fresh);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `${method} ${url}: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/* ---------- auth ---------- */
export interface AuthUser { name: string; email: string; oid: string | null }
export interface AuthState { user: AuthUser; mode: 'sso' | 'dev' }

/** Resolve the current session. Returns null if not authenticated. */
export async function fetchMe(): Promise<AuthState | null> {
  try {
    const res = await fetch('/auth/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as AuthState;
  } catch {
    return null;
  }
}

export function login(): void {
  window.location.href = '/auth/login';
}

export async function logout(): Promise<void> {
  try { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
  window.location.reload();
}

export const apiCreate = (p: Project) => call<Project>('POST', '/api/projects', p);
export const apiReplace = (p: Project) => call<Project>('PUT', `/api/projects/${p.id}`, p);
export const apiSetStatus = (id: string, stage: StageKey, team?: string, note?: string) =>
  call<Project>('PATCH', `/api/projects/${id}/status`, { stage, team, note });
export const apiDelete = (id: string) => call<void>('DELETE', `/api/projects/${id}`);

/* ---------- API key management ---------- */

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
  internal: boolean;
}

export const apiListKeys = () => call<ApiKeyInfo[]>('GET', '/api/keys');
/** The full secret is only present in this response — show it once. */
export const apiCreateKey = (name: string) =>
  call<ApiKeyInfo & { key: string }>('POST', '/api/keys', { name });
/** Revoked keys are deleted outright — they disappear from the list. */
export const apiRevokeKey = (id: string) => call<void>('DELETE', `/api/keys/${id}`);

/* ---------- websocket: projects + presence ---------- */

export interface PresenceUser {
  id: string;
  name: string;
}

interface RelayEvents {
  onProjects: (projects: Project[]) => void;
  onPresence: (users: PresenceUser[]) => void;
  onStatus: (connected: boolean) => void;
}

export function connectRelay(userName: string, events: RelayEvents): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout>;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      events.onStatus(true);
      ws?.send(JSON.stringify({ type: 'hello', name: userName }));
    };
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'projects') events.onProjects(msg.projects);
        if (msg.type === 'presence') events.onPresence(msg.users);
      } catch { /* ignore malformed frames */ }
    };
    ws.onclose = () => {
      events.onStatus(false);
      if (!closed) retry = setTimeout(open, 2000);
    };
  };
  open();

  return () => {
    closed = true;
    clearTimeout(retry);
    ws?.close();
  };
}

/* ---------- SLA / duration math (pure) ---------- */

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
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d < 1) {
    const rm = m % 60;
    return rm ? `${h}h ${rm}min` : `${h}h`;
  }
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

export type StageState = 'done' | 'current' | 'pending';

export interface StageStat {
  key: StageKey;
  label: string;
  shortLabel: string;
  state: StageState;
  ms: number | null;    // time spent in the stage (null if not reached yet)
  slaMs: number | null; // SLA target for the stage
  ratio: number | null; // ms / slaMs
  breached: boolean;    // took longer than the SLA target
}

/**
 * Per-stage SLA breakdown for the project view: how long each task took, with a
 * flag when it blew past its SLA target. Stages ahead of the current one are
 * 'pending' with no time, so a reverted mistaken advance reads clean.
 */
export function stageBreakdown(p: Project): StageStat[] {
  const durations = stageDurations(p);
  const curIdx = stageIndex(p.stage);
  return STAGES.map((s, i) => {
    const state: StageState = i < curIdx ? 'done' : i === curIdx ? 'current' : 'pending';
    const ms = state === 'pending' ? null : durations[s.key] ?? 0;
    const slaMs = s.slaHours != null ? s.slaHours * 3600_000 : null;
    const ratio = ms != null && slaMs != null ? ms / slaMs : null;
    return {
      key: s.key,
      label: s.label,
      shortLabel: s.shortLabel,
      state,
      ms,
      slaMs,
      ratio,
      breached: ratio != null && ratio > 1,
    };
  });
}
