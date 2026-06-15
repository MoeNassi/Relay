import type { Project, StageKey } from './types';
import { STAGES, stageIndex, stageDef } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------- API client (server is the source of truth) ---------- */

let apiKey: string | null = null;
let keyTried = false;

// In SSO mode the browser authenticates by session cookie, so /api/key is gone
// (404) — we just rely on the cookie. In dev mode the server hands out a key.
// Try once, cache the result, and never block API calls if it's unavailable.
async function ensureKey(): Promise<string | null> {
  if (keyTried) return apiKey;
  keyTried = true;
  try {
    const res = await fetch('/api/key');
    if (res.ok) apiKey = (await res.json()).key;
  } catch { /* SSO mode or server down — fall back to cookie auth */ }
  return apiKey;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = await ensureKey();
  if (key) headers['X-API-Key'] = key;
  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',   // send the session cookie in SSO mode
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
export const apiSetStatus = (id: string, stage: StageKey, team?: string) =>
  call<Project>('PATCH', `/api/projects/${id}/status`, { stage, team });
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
