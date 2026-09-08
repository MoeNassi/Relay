import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAuthRoutes, currentUser, SSO_ENABLED } from './auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.RELAY_DATA_DIR ?? path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'projects.json');
const KEY_FILE = path.join(DATA_DIR, 'api-key');
const PORT = process.env.RELAY_PORT ?? 5181;
// Dev mode exposes GET /api/key so the browser app can authenticate itself.
// In production, disable and put the UI behind SSO instead.
const DEV_MODE = process.env.RELAY_DEV !== '0';

const STAGES = ['arch', 'vms', 'gitlab', 'pipeline', 'deploy', 'publication', 'scan', 'live'];
const FIRST_STAGE = STAGES[0];
const TEAMS = ['devops', 'infra', 'network', 'cybersec', 'owner'];
// Security scans that run under the `scan` stage. Every env must pass all three
// before going live EXCEPT `dev`, which is exempt.
const SCAN_TYPES = ['agent', 'pentest', 'cloud'];
const SCAN_LABELS = { agent: 'Agent scan', pentest: 'Penetration test', cloud: 'Cloud scan' };
// One-time tasks: run once per project, on the first environment (promotion order) only.
const ONE_TIME_STAGES = ['arch', 'vms', 'gitlab', 'pipeline'];
const emptyScans = () => ({ agent: null, pentest: null, cloud: null });
const scanRequired = env => String(env.name).trim().toLowerCase() !== 'dev';
const allScansDone = env => SCAN_TYPES.every(t => env.scans?.[t]);
const DEFAULT_TEAM = { arch: 'devops', vms: 'infra', gitlab: 'devops', pipeline: 'devops', deploy: 'owner', scan: 'cybersec', publication: 'network', live: 'owner' };
const ENV_ORDER = ['dev', 'rec', 'preprod', 'prod'];
const envRank = name => {
  const i = ENV_ORDER.indexOf(String(name).trim().toLowerCase());
  return i < 0 ? ENV_ORDER.length : i;
};

const uid = () => crypto.randomBytes(4).toString('hex');

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- API keys (managed via Settings UI) ---------- */
const KEYS_FILE = path.join(DATA_DIR, 'api-keys.json');
const newSecret = () => 'relay_sk_' + crypto.randomBytes(24).toString('base64url');

let keys;
try {
  // revoked keys are deleted outright; drop any left over from older versions
  keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')).filter(k => !k.revoked);
} catch {
  keys = [];
  // migrate the old single-key file if present
  if (fs.existsSync(KEY_FILE)) {
    keys.push({
      id: uid(),
      name: 'Default agent key',
      key: fs.readFileSync(KEY_FILE, 'utf8').trim(),
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revoked: false,
    });
  }
}

function persistKeys() {
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
}

// the browser app's own key, handed out by GET /api/key in dev mode
let uiKey = keys.find(k => k.internal && !k.revoked);
if (!uiKey) {
  uiKey = {
    id: uid(),
    name: 'Web UI (dev session)',
    key: newSecret(),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revoked: false,
    internal: true,
  };
  keys.push(uiKey);
}
persistKeys();

const maskKey = k => k.key.slice(0, 12) + '…' + k.key.slice(-4);
const publicKeyInfo = k => ({
  id: k.id,
  name: k.name,
  prefix: maskKey(k),
  createdAt: k.createdAt,
  lastUsedAt: k.lastUsedAt,
  revoked: !!k.revoked,
  internal: !!k.internal,
});

/* ---------- store ---------- */
function seed() {
  const h = days => new Date(Date.now() - days * 86400_000).toISOString();
  return [
    {
      id: uid(),
      name: 'Cartographie Apps',
      dns: '',
      owner: { name: 'C. Ibnsina', title: 'IT Project Manager' },
      environments: [
        {
          id: uid(),
          name: 'dev',
          dns: 'cartographie-dev.um6p.ma',
          vms: [{ id: uid(), role: 'all-in-one', count: 1, vcpu: 2, ramGb: 4, diskGb: 60, os: 'Ubuntu 24.04' }],
          stage: 'live',
          team: 'owner',
          history: [
            { stage: 'arch', team: 'devops', enteredAt: h(20) },
            { stage: 'vms', team: 'infra', enteredAt: h(19) },
            { stage: 'gitlab', team: 'devops', enteredAt: h(18.6) },
            { stage: 'pipeline', team: 'devops', enteredAt: h(18.3) },
            { stage: 'deploy', team: 'owner', enteredAt: h(18) },
            { stage: 'publication', team: 'network', enteredAt: h(12) },
            { stage: 'scan', team: 'cybersec', enteredAt: h(11) },
            { stage: 'live', team: 'owner', enteredAt: h(10) },
          ],
        },
        {
          id: uid(),
          name: 'prod',
          dns: 'cartographie.um6p.ma',
          vms: [
            { id: uid(), role: 'app server', count: 2, vcpu: 4, ramGb: 8, diskGb: 80, os: 'Ubuntu 24.04' },
            { id: uid(), role: 'db', count: 1, vcpu: 4, ramGb: 16, diskGb: 200, os: 'Ubuntu 24.04' },
          ],
          stage: 'scan',
          team: 'cybersec',
          // arch & vms are one-time tasks — they ran on dev, so prod starts at deploy
          history: [
            { stage: 'deploy', team: 'owner', enteredAt: h(7) },
            { stage: 'publication', team: 'network', enteredAt: h(4) },
            { stage: 'scan', team: 'cybersec', enteredAt: h(3) },
          ],
        },
      ],
      flows: [
        { id: uid(), source: 'app server', destination: 'db', port: '5432', protocol: 'TCP', direction: 'outbound', note: 'PostgreSQL' },
        { id: uid(), source: 'app server', destination: 'smtp.um6p.ma', port: '587', protocol: 'TCP', direction: 'outbound', note: 'Mail relay' },
      ],
      createdAt: h(20),
    },
    {
      id: uid(),
      name: 'HR Portal',
      dns: '',
      owner: { name: 'S. Alaoui', title: 'HR Director' },
      environments: [
        {
          id: uid(),
          name: 'preprod',
          dns: 'hr-preprod.um6p.ma',
          vms: [{ id: uid(), role: 'app server', count: 1, vcpu: 8, ramGb: 16, diskGb: 120, os: 'RHEL 9' }],
          stage: 'vms',
          team: 'infra',
          history: [
            { stage: 'arch', team: 'devops', enteredAt: h(9) },
            { stage: 'vms', team: 'infra', enteredAt: h(7) },
          ],
        },
        {
          id: uid(),
          name: 'prod',
          dns: 'hr.um6p.ma',
          vms: [{ id: uid(), role: 'app server', count: 2, vcpu: 8, ramGb: 16, diskGb: 120, os: 'RHEL 9' }],
          stage: null,
          team: null,
          history: [],
        },
      ],
      flows: [
        { id: uid(), source: 'app server', destination: 'ad.um6p.ma', port: '636', protocol: 'TCP', direction: 'outbound', note: 'LDAPS' },
      ],
      createdAt: h(9),
    },
  ];
}

/** Bring older single-pipeline projects up to the per-environment shape. */
function migrate(list) {
  for (const p of list) {
    const envs = Array.isArray(p.environments) ? p.environments : [];
    // ensure each env has pipeline fields
    for (const e of envs) {
      if (!('history' in e)) e.history = [];
      if (!('stage' in e)) e.stage = null;
      if (!('team' in e)) e.team = null;
      if (typeof e.dns !== 'string') e.dns = '';
      if (!e.scans || typeof e.scans !== 'object') e.scans = emptyScans();
      else for (const t of SCAN_TYPES) if (!(t in e.scans)) e.scans[t] = null;
    }
    // DNS is per-environment now — fold a legacy project-wide dns onto the prod
    // env (else the last env in promotion order) when no env has one yet.
    if (p.dns && envs.length && !envs.some(e => e.dns)) {
      const ordered = [...envs].sort((a, b) => envRank(a.name) - envRank(b.name));
      const target = ordered.find(e => String(e.name).trim().toLowerCase() === 'prod') ?? ordered[ordered.length - 1];
      target.dns = String(p.dns).trim();
    }
    // fold a legacy project-level pipeline into the first env (by promotion order)
    if ('stage' in p || 'history' in p) {
      const ordered = [...envs].sort((a, b) => envRank(a.name) - envRank(b.name));
      const target = ordered[0];
      if (target && !target.history.length && Array.isArray(p.history) && p.history.length) {
        // remap retired stage keys: 'new' -> 'arch'
        target.history = p.history.map(x => ({ ...x, stage: x.stage === 'new' ? 'arch' : x.stage }));
        target.stage = p.stage === 'new' ? 'arch' : (p.stage ?? null);
        target.team = p.team ?? null;
      }
      delete p.stage; delete p.team; delete p.history;
    }
    // architecture review now belongs to IT-Prod (DevOps), not Infra
    for (const e of envs) {
      for (const x of e.history) {
        if (x.stage === 'arch' && x.team === 'infra') x.team = 'devops';
      }
      if (e.stage === 'arch' && e.team === 'infra') e.team = 'devops';
    }
  }
  return list;
}

let projects;
try {
  projects = migrate(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  persist();
} catch {
  projects = migrate(seed());
  persist();
}

function persist() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(projects, null, 2));
}

/* ---------- http api ---------- */
const app = express();
app.use(express.json({ limit: '1mb' }));

// SSO endpoints (/auth/login, /auth/callback, /auth/me, /auth/logout). When SSO
// isn't configured, dev mode lets the browser straight in as a local dev user.
installAuthRoutes(app, {
  devFallback: DEV_MODE && !SSO_ENABLED,
  devUser: { name: 'Local Dev', email: '', oid: 'dev' },
});

// Accept EITHER an SSO session (browser users) OR an API key (agents/CI).
function requireKey(req, res, next) {
  const user = currentUser(req);
  if (user) { req.user = user; return next(); }

  const got = req.headers['x-api-key'] ?? (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const match = keys.find(k => k.key === got && !k.revoked);
  if (!match) return res.status(401).json({ error: 'invalid or missing API key' });
  match.lastUsedAt = new Date().toISOString();
  persistKeys();
  req.keyInfo = match;
  next();
}

app.get('/api/projects', requireKey, (_req, res) => res.json(projects));

app.get('/api/projects/:id', requireKey, (req, res) => {
  const p = projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
});

// Dev convenience only: hand the browser its key so it can call the API without
// a login. Disabled once SSO is configured — browsers authenticate by session.
if (DEV_MODE && !SSO_ENABLED) {
  app.get('/api/key', (_req, res) => res.json({ key: uiKey.key, devMode: true }));
}

/* ---------- key management ---------- */
app.get('/api/keys', requireKey, (_req, res) => res.json(keys.map(publicKeyInfo)));

app.post('/api/keys', requireKey, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const k = {
    id: uid(),
    name: name.slice(0, 60),
    key: newSecret(),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revoked: false,
  };
  keys.push(k);
  persistKeys();
  // the secret is returned ONCE, at creation
  res.status(201).json({ ...publicKeyInfo(k), key: k.key });
});

app.delete('/api/keys/:id', requireKey, (req, res) => {
  const i = keys.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  if (keys[i].internal) return res.status(400).json({ error: 'the Web UI key cannot be revoked' });
  keys.splice(i, 1);
  persistKeys();
  res.status(204).end();
});

function normalizeScans(s) {
  const out = emptyScans();
  for (const t of SCAN_TYPES) {
    const v = s?.[t];
    if (v && typeof v === 'object' && v.at) {
      out[t] = { at: String(v.at), ...(v.by ? { by: String(v.by) } : {}), ...(v.note ? { note: String(v.note) } : {}) };
    }
  }
  return out;
}

function normalizeEnv(e) {
  return {
    id: e?.id ?? uid(),
    name: String(e?.name ?? 'env'),
    dns: typeof e?.dns === 'string' ? e.dns.trim() : '',
    vms: Array.isArray(e?.vms) ? e.vms : [],
    stage: STAGES.includes(e?.stage) ? e.stage : null,
    team: TEAMS.includes(e?.team) ? e.team : null,
    history: Array.isArray(e?.history) ? e.history : [],
    scans: normalizeScans(e?.scans),
  };
}

app.post('/api/projects', requireKey, (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.owner?.name) {
    return res.status(400).json({ error: 'name and owner.name are required' });
  }
  const now = new Date().toISOString();
  const project = {
    id: uid(),
    name: String(b.name),
    dns: b.dns ?? '',
    owner: { name: b.owner.name, title: b.owner.title ?? '' },
    environments: (Array.isArray(b.environments) ? b.environments : []).map(normalizeEnv),
    flows: Array.isArray(b.flows) ? b.flows : [],
    createdAt: now,
  };
  projects.push(project);
  persist();
  broadcastProjects();
  res.status(201).json(project);
});

app.put('/api/projects/:id', requireKey, (req, res) => {
  const i = projects.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  const b = req.body ?? {};
  // `vmProvision` is server-owned VMProv job bookkeeping: always carried over
  // from the stored env (never from the client), else an edit mid-provision
  // drops the job_id — the completion callback no longer matches and a retrigger
  // double-provisions the VMs.
  const prevEnvs = projects[i].environments;
  const envs = (Array.isArray(b.environments) ? b.environments.map(normalizeEnv) : prevEnvs)
    .map(e => {
      const old = prevEnvs.find(x => x.id === e.id);
      return old?.vmProvision ? { ...e, vmProvision: old.vmProvision } : e;
    });
  projects[i] = { ...b, id: req.params.id, environments: envs };
  persist();
  broadcastProjects();
  res.json(projects[i]);
});

function orderedEnvsSrv(p) {
  return [...p.environments]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => envRank(a.e.name) - envRank(b.e.name) || a.i - b.i)
    .map(x => x.e);
}
// An env is unlocked once the previous env (promotion order) is live; first is open.
function envUnlockedSrv(p, env) {
  const o = orderedEnvsSrv(p);
  const idx = o.findIndex(e => e.id === env.id);
  if (idx <= 0) return true;
  return o[idx - 1].stage === 'live';
}

// Agents change the status of ONE environment here; its history (and thus SLA
// clocks) updates automatically. Optional `note` is recorded on the entry.
// Body: { envId, stage, team?, note? }.
app.patch('/api/projects/:id/status', requireKey, (req, res) => {
  const p = projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const { envId, stage, team, note } = req.body ?? {};
  const env = p.environments.find(e => e.id === envId);
  if (!env) {
    return res.status(400).json({ error: 'envId is required and must match an environment' });
  }
  if (!STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of: ${STAGES.join(', ')}` });
  }
  if (!envUnlockedSrv(p, env)) {
    return res.status(409).json({ error: 'previous environment must be live before this one can start' });
  }
  // Architecture & VM creation are one-time tasks — only the first environment
  // (promotion order) runs them.
  const firstEnv = orderedEnvsSrv(p)[0];
  if (ONE_TIME_STAGES.includes(stage) && firstEnv && firstEnv.id !== env.id) {
    return res.status(409).json({ error: `'${stage}' is a one-time task handled on the first environment (${firstEnv.name})` });
  }
  // Gate: can't move past the security scan until all three sub-scans pass
  // (dev is exempt). "Past scan" = leaving scan for a later stage.
  const leavingScan = env.stage === 'scan' && STAGES.indexOf(stage) > STAGES.indexOf('scan');
  if (leavingScan && scanRequired(env) && !allScansDone(env)) {
    const pending = SCAN_TYPES.filter(x => !env.scans?.[x]);
    return res.status(409).json({ error: `security scans incomplete: ${pending.join(', ')} must pass before leaving the scan stage` });
  }
  const t = TEAMS.includes(team) ? team : DEFAULT_TEAM[stage];
  const by = req.user?.name ?? req.keyInfo?.name ?? null;
  // Moving back to the scan stage (or earlier) from beyond it voids the scans:
  // they must be re-validated. The log entry keeps the trace of what had passed.
  const scanIdx = STAGES.indexOf('scan');
  const movedBackPastScan = env.stage != null
    && STAGES.indexOf(env.stage) > scanIdx
    && STAGES.indexOf(stage) <= scanIdx;
  if (movedBackPastScan && SCAN_TYPES.some(x => env.scans?.[x])) {
    const voided = SCAN_TYPES.filter(x => env.scans?.[x]).map(x => SCAN_LABELS[x]);
    env.scans = emptyScans();
    env.history.push({
      kind: 'scan',
      stage: 'scan',
      team: 'cybersec',
      enteredAt: new Date().toISOString(),
      note: `Scans reset (${voided.join(', ')}) — pipeline moved back, all scans must be re-validated`,
      ...(by ? { by } : {}),
    });
  }
  const entry = { stage, team: t, enteredAt: new Date().toISOString() };
  if (typeof note === 'string' && note.trim()) entry.note = note.trim().slice(0, 500);
  if (by) entry.by = by;
  env.stage = stage;
  env.team = t;
  env.history.push(entry);
  persist();
  broadcastProjects();
  // Entering `vms` is what triggers the VMProv submit (also re-entering it:
  // that's the manual retry/reconcile path for errored or stuck envs).
  if (stage === 'vms') setImmediate(vmTick);
  res.json(p);
});

// Mark one of an environment's sub-scans (agent | pentest | cloud) done or not.
// Body: { envId, scanType, done, note? }.
app.patch('/api/projects/:id/scan', requireKey, (req, res) => {
  const p = projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const { envId, scanType, done, note } = req.body ?? {};
  const env = p.environments.find(e => e.id === envId);
  if (!env) {
    return res.status(400).json({ error: 'envId is required and must match an environment' });
  }
  if (!SCAN_TYPES.includes(scanType)) {
    return res.status(400).json({ error: `scanType must be one of: ${SCAN_TYPES.join(', ')}` });
  }
  if (!env.scans) env.scans = emptyScans();
  const by = req.user?.name ?? req.keyInfo?.name ?? null;
  const userNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;
  // Every actual toggle is logged to the env history (kind: 'scan') so the
  // activity tab keeps a trace even after scans are reset. No-ops don't log.
  const logScan = text => env.history.push({
    kind: 'scan',
    stage: 'scan',
    team: 'cybersec',
    enteredAt: new Date().toISOString(),
    note: userNote ? `${text} — “${userNote}”` : text,
    ...(by ? { by } : {}),
  });
  if (done === false) {
    if (env.scans[scanType]) {
      env.scans[scanType] = null;
      logScan(`${SCAN_LABELS[scanType]} unchecked — to be re-validated`);
    }
  } else if (!env.scans[scanType]) {
    env.scans[scanType] = {
      at: new Date().toISOString(),
      ...(by ? { by } : {}),
      ...(userNote ? { note: userNote } : {}),
    };
    logScan(`${SCAN_LABELS[scanType]} marked as passed`);
  }
  persist();
  broadcastProjects();
  res.json(p);
});

app.delete('/api/projects/:id', requireKey, (req, res) => {
  const i = projects.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  projects.splice(i, 1);
  persist();
  broadcastProjects();
  res.status(204).end();
});

// Serve the built app ONLY in production. In dev, Vite (port 5180) serves the UI
// with hot-reload, so this server stays backend-only — it must NOT serve a stale
// dist/ build. Set NODE_ENV=production (e.g. via `npm start`) to enable this.
const PROD = process.env.NODE_ENV === 'production';
const dist = path.join(__dirname, '..', 'dist');
if (PROD && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/ws|\/auth).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  // dev: make it obvious this port is the API, not the app
  app.get('/', (_req, res) =>
    res.type('text/plain').send('Relay API server (dev). The UI runs on http://localhost:5180'));
}

/* ---------- websocket: presence + live updates ---------- */
const server = createServer(app);
// Registered BEFORE the WebSocketServer attaches: ws re-emits http server
// errors on itself (unhandled → crash), so this must be the first listener
// for the friendly message to win.
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — another Relay server is probably running.`);
    console.error(`Stop it first (pkill -f server/server.mjs) or start this one on another port: RELAY_PORT=5182 npm start`);
    process.exit(1);
  }
  throw err;
});
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Map(); // ws -> {id, name}

function presenceList() {
  return [...clients.values()];
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

const broadcastPresence = () => broadcast({ type: 'presence', users: presenceList() });

// Projects as sent to browsers: a shallow copy with in-memory VMProv credentials
// overlaid onto the matching env's vmProvision. The persisted `projects` array
// (what persist() writes) never carries credentials — this overlay is wire-only.
function projectsForWire() {
  if (!vmCredsById.size) return projects;
  return projects.map(p => {
    if (!p.environments?.some(e => vmCredsById.has(e.id))) return p;
    return {
      ...p,
      environments: p.environments.map(e => {
        const creds = vmCredsById.get(e.id);
        return creds && e.vmProvision
          ? { ...e, vmProvision: { ...e.vmProvision, credentials: creds } }
          : e;
      }),
    };
  });
}
const broadcastProjects = () => broadcast({ type: 'projects', projects: projectsForWire() });

wss.on('connection', (ws, req) => {
  // When SSO is on, the live channel (which streams every project) is for
  // authenticated browser sessions only — reject anonymous sockets.
  const user = SSO_ENABLED ? currentUser(req) : null;
  if (SSO_ENABLED && !user) {
    ws.close(1008, 'authentication required');
    return;
  }

  clients.set(ws, { id: uid(), name: user?.name || 'Guest', picture: user?.picture || null });
  ws.send(JSON.stringify({ type: 'projects', projects: projectsForWire() }));
  broadcastPresence();

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'hello' && typeof msg.name === 'string') {
        clients.get(ws).name = msg.name.slice(0, 40) || 'Guest';
        broadcastPresence();
      }
    } catch { /* ignore malformed frames */ }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastPresence();
  });
});

/* ---------- VMProv auto-provision worker (optional) ----------
 * Integrates with the UM6P VMProv agent (see vmprov-agent-integration.md).
 *
 * VMProv is ASYNCHRONOUS: when an env reaches `vms`, Relay POSTs a batch to
 * `${VM_AGENT_URL}` (default https://vmprov.um6p.ma/api/agent/jobs) with a Bearer
 * token. VMProv answers 202 ("accepted") — NOT "created" — provisions in the
 * background, and later POSTs a single completion callback to VM_CALLBACK_URL.
 * Relay advances the env only when that callback (or a status GET) reports the
 * job Completed.
 *
 * Flow per env:            submit ──202──▶ [submitted] ──callback:Completed──▶ advance
 *                                │409 (already submitted) ─▶ [submitted]
 *                                └─error──▶ [error] ─(backoff)─▶ resubmit (same job_id)
 * Fully event-driven — no background polling at Relay's volume (~3 projects/wk):
 * a submit fires when an env is moved to `vms` (PATCH /status), plus one sweep
 * at boot for anything a restart left pending. An errored env resubmits, and a
 * stuck [submitted] env is reconciled with GET /api/agent/jobs/{id} (missed
 * callback), when a human moves it to `vms` again — failures are meant to be
 * seen and re-triggered, not silently self-healed. Every request is
 * concurrency-capped, timed out, and fully wrapped so a failing agent can
 * never crash or freeze the server.
 *
 * Disabled unless VM_AGENT_URL, VM_AGENT_TOKEN and VM_CALLBACK_URL are all set.
 */
const VM_AGENT_URL = process.env.RELAY_VM_AGENT_URL || 'https://vmprov.um6p.ma/api/agent/jobs';
const VM_AGENT_TOKEN = process.env.RELAY_VM_AGENT_TOKEN ?? '';          // VMProv Bearer token
const VM_CALLBACK_URL = process.env.RELAY_VM_CALLBACK_URL ?? '';        // must be a *.um6p.ma https URL
const VM_CALLBACK_TOKEN = process.env.RELAY_VM_CALLBACK_TOKEN ?? '';    // shared secret echoed back on the callback
const VM_SITE = process.env.RELAY_VM_SITE ?? '';                        // default vm_site (RABAT | BG | BGOLD | F2 | NRO1)
const VM_REQUESTER = process.env.RELAY_VM_REQUESTER || 'IT-PRODUCTIONAPP@um6p.ma'; // requester email on every VM
const VM_SUBMITTER = process.env.RELAY_VM_SUBMITTER || 'relay';
const VM_NEXT_STAGE = STAGES.includes(process.env.RELAY_VM_NEXT_STAGE) ? process.env.RELAY_VM_NEXT_STAGE : 'gitlab';
const VM_TIMEOUT_MS = Number(process.env.RELAY_VM_TIMEOUT_MS) || 30000;
const VM_MAX_CONCURRENT = Number(process.env.RELAY_VM_MAX_CONCURRENT) || 4;
const VM_RETRY_MS = Number(process.env.RELAY_VM_RETRY_MS) || 60000;     // backoff before resubmitting an errored env
const VM_RECONCILE_MS = Number(process.env.RELAY_VM_RECONCILE_MS) || 300000; // recheck a stuck 'submitted' job

const VM_ON = Boolean(VM_AGENT_URL && VM_AGENT_TOKEN && VM_CALLBACK_URL);

// envIds with a VMProv request (submit or reconcile) in flight right now.
const vmInFlight = new Set();

// Cleartext initial credentials from the completion callback, keyed by env.id.
// IN-MEMORY ONLY: never written to projects.json (vmScrub keeps them out of the
// persisted result) — merged into the outbound `projects` frame so the UI can
// display them, and dropped when the server restarts.
const vmCredsById = new Map();

// Relay env name -> VMProv vm_environment code.
const VM_ENV_CODE = {
  dev: 'DEV', rec: 'RECETTE', recette: 'RECETTE',
  preprod: 'PRE-PROD', 'pre-prod': 'PRE-PROD', prod: 'PROD', poc: 'POC',
};
// Relay os string -> VMProv vm_type. RHEL & friends are unsupported → null.
function vmType(os) {
  const s = String(os ?? '').toLowerCase();
  if (s.includes('ubuntu')) return 'UBUNTU';
  if (s.includes('windows')) return s.includes('fr') ? 'WINDOWS-FR' : 'WINDOWS-EN';
  return null;
}
const shortCode = (s, max) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max);

// Login from the owner's full name: first-name initial + last name, lowercased.
// "Mohammed Nassi" -> "mnassi". Single-word names are used as-is.
function vmLogin(fullName) {
  const parts = String(fullName ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const login = parts.length === 1 ? parts[0] : parts[0][0] + parts[parts.length - 1];
  return login.replace(/[^a-z0-9]/g, '');
}

// Build the VMProv `vms[]` batch from a Relay environment, expanding each spec's
// `count` into that many VMs. Returns {batch, errors}: a non-empty errors array
// means the env can't be provisioned as-is and must not be submitted.
function vmBuildBatch(project, env) {
  const errors = [];
  const environment = VM_ENV_CODE[String(env.name).trim().toLowerCase()];
  if (!environment) errors.push(`env name '${env.name}' is not one of DEV/RECETTE/PRE-PROD/PROD/POC`);
  const projectCode = shortCode(project.name, 8);
  if (!projectCode) errors.push('cannot derive a project code (1-8 alnum) from the project name');
  // Every VM gets the owner as its account (Ubuntu → linux_users, Windows → win_user).
  const login = vmLogin(project.owner?.name);

  const list = Array.isArray(env.vms) ? env.vms : [];
  if (!list.length) errors.push('environment has no VMs defined');

  const batch = [];
  for (const v of list) {
    const type = vmType(v.os);
    if (!type) errors.push(`os '${v.os ?? ''}' is unsupported by VMProv (need Ubuntu or Windows)`);
    const site = v.site ?? env.site ?? VM_SITE;
    if (!site) errors.push(`no site for VM '${v.role ?? '?'}' (set RELAY_VM_SITE or a per-VM site)`);
    const role = shortCode(v.role, 3);
    if (!role) errors.push(`cannot derive a role code (1-3 alnum) from '${v.role ?? ''}'`);
    const cpu = Number(v.vcpu);
    const memory = Number(v.ramGb);
    if (!cpu) errors.push(`vcpu missing/invalid for VM '${v.role ?? '?'}'`);
    if (!memory) errors.push(`ramGb missing/invalid for VM '${v.role ?? '?'}'`);
    if (errors.length) continue; // don't build partial specs once something's wrong

    const count = Math.max(1, Number(v.count) || 1);
    for (let i = 0; i < count; i++) {
      const spec = {
        site, type, environment, cpu, memory,
        // Required server-side despite the doc's "recommended". Sent under both
        // spellings: VMProv builds have flapped between accepting `project_label`
        // and `vm_project_label`, and unknown keys are dropped harmlessly.
        project: projectCode, role,
        project_label: project.name, vm_project_label: project.name,
        description: `${project.name} ${v.role ?? ''}`.trim().slice(0, 120),
      };
      if (v.diskGb) spec.partitions = type === 'UBUNTU' ? `/,${Number(v.diskGb)}` : `C,${Number(v.diskGb)}`;
      if (VM_REQUESTER) spec.requester = VM_REQUESTER;
      // Owner account: sudo on Linux, admin on Windows.
      if (login) {
        if (type === 'UBUNTU') spec.linux_users = `${login},1`;
        else spec.win_user = `${login},1`;
      }
      batch.push(spec);
    }
  }
  return { batch, errors };
}

// Advance an env one stage forward, mirroring the PATCH /status bookkeeping.
function vmAdvance(env, stage, note) {
  const team = DEFAULT_TEAM[stage] ?? null;
  const entry = { stage, team, enteredAt: new Date().toISOString(), by: 'vmprov' };
  if (note) entry.note = String(note).slice(0, 500);
  env.stage = stage;
  env.team = team;
  env.history.push(entry);
}

// Keep only non-sensitive fields from a callback VM entry. The callback carries
// CLEARTEXT initial passwords (linux_accounts) and Windows user config — those
// MUST NOT be persisted to projects.json or broadcast to browsers.
function vmScrub(v) {
  return {
    name: v?.name ?? v?.hostname ?? null,
    status: v?.status ?? null,
    vm_id: v?.vm_id ?? v?.vm_moref ?? null,
    ip: v?.ip ?? null,
    site: v?.site ?? null,
    environment: v?.environment ?? null,
    type: v?.type ?? null,
    ...(v?.error ? { error: String(v.error).slice(0, 300) } : {}),
  };
}

function vmFindByJobId(jobId) {
  for (const p of projects) {
    for (const env of p.environments) {
      if (env.vmProvision?.jobId === jobId) return { project: p, env };
    }
  }
  return null;
}

// Apply a VMProv job status (from the callback or a reconcile GET) to an env.
function vmApplyStatus(project, env, data) {
  const status = data?.status;
  env.vmProvision.result = {
    total: data?.total_requested ?? null,
    successful: data?.successful ?? null,
    failed: data?.failed ?? null,
    vms: Array.isArray(data?.vms) ? data.vms.map(vmScrub) : [],
  };
  if (status === 'Completed') {
    // Keep the raw VM entries (they carry cleartext initial passwords / Windows
    // user config) in memory only, keyed by env id — surfaced to the UI via
    // projectsForWire(), never persisted to projects.json.
    if (Array.isArray(data?.vms) && data.vms.length) vmCredsById.set(env.id, data.vms);
    if (env.stage === 'vms') {
      env.vmProvision.status = 'created';
      vmAdvance(env, VM_NEXT_STAGE, `VMProv job ${data.job_id} completed — ${data.successful ?? '?'} VM(s) created`);
      console.log(`[vmprov] ${project.name}/${env.name}: job ${data.job_id} Completed → advanced to ${VM_NEXT_STAGE}`);
    } else {
      env.vmProvision.status = 'created';
    }
  } else if (status === 'Failed' || status === 'PartiallyCompleted') {
    env.vmProvision.status = 'failed';
    env.vmProvision.lastError = `VMProv ${status}: ${data.failed ?? '?'}/${data.total_requested ?? '?'} VM(s) failed`;
    console.error(`[vmprov] ${project.name}/${env.name}: job ${data.job_id} ${status} — left at 'vms'`);
  }
  // pending / InProgress / WaitingForAcceptance → leave as 'submitted'.
}

// Submit one env's batch to VMProv. Reuses the env's job_id across retries so a
// lost 202 response doesn't double-provision (VMProv dedupes by job_id → 409,
// which we treat as "already accepted"). Never throws; always frees its slot.
async function vmSubmit(project, env) {
  vmInFlight.add(env.id);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VM_TIMEOUT_MS);
  try {
    const { batch, errors } = vmBuildBatch(project, env);
    if (errors.length) {
      env.vmProvision = {
        ...(env.vmProvision ?? {}),
        status: 'error',
        attempts: (env.vmProvision?.attempts ?? 0) + 1,
        lastAttemptAt: new Date().toISOString(),
        lastError: `cannot build VM spec: ${errors.join('; ')}`.slice(0, 300),
      };
      persist();
      broadcastProjects();
      console.error(`[vmprov] ${project.name}/${env.name}: ${env.vmProvision.lastError}`);
      return;
    }

    const jobId = env.vmProvision?.jobId ?? `relay-${env.id}-${uid()}`;
    env.vmProvision = {
      ...(env.vmProvision ?? {}),
      jobId,
      status: 'submitting',
      attempts: (env.vmProvision?.attempts ?? 0) + 1,
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
    };
    persist();
    broadcastProjects();

    const res = await fetch(VM_AGENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VM_AGENT_TOKEN}`,
      },
      body: JSON.stringify({
        job_id: jobId,
        callback_url: VM_CALLBACK_URL,
        ...(VM_CALLBACK_TOKEN ? { callback_auth_token: VM_CALLBACK_TOKEN } : {}),
        submitter: VM_SUBMITTER,
        vms: batch,
      }),
      signal: ac.signal,
    });

    // 202 = accepted; 409 = a batch with this job_id already exists (a prior
    // submit landed) — both mean "it's queued, wait for the callback".
    if (res.status === 202 || res.status === 409) {
      env.vmProvision.status = 'submitted';
      env.vmProvision.lastReconcileAt = new Date().toISOString();
      console.log(`[vmprov] ${project.name}/${env.name}: job ${jobId} ${res.status === 409 ? 'already submitted' : 'accepted'} (${batch.length} VM[s]) — awaiting callback`);
    } else {
      const body = await res.text().catch(() => '');
      throw new Error(`submit ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    persist();
    broadcastProjects();
  } catch (e) {
    const msg = e?.name === 'AbortError' ? `timed out after ${VM_TIMEOUT_MS}ms` : String(e?.message ?? e);
    if (env.vmProvision) {
      env.vmProvision.status = 'error';
      env.vmProvision.lastError = msg.slice(0, 300);
    }
    persist();
    broadcastProjects();
    console.error(`[vmprov] ${project.name}/${env.name}: submit failed — ${msg}`);
  } finally {
    clearTimeout(timer);
    vmInFlight.delete(env.id);
  }
}

// Safety net for a missed callback: GET the job status and apply it.
async function vmReconcile(project, env) {
  vmInFlight.add(env.id);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), VM_TIMEOUT_MS);
  try {
    env.vmProvision.lastReconcileAt = new Date().toISOString();
    const jobId = env.vmProvision.jobId;
    const url = `${VM_AGENT_URL.replace(/\/+$/, '')}/${encodeURIComponent(jobId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${VM_AGENT_TOKEN}` },
      signal: ac.signal,
    });
    if (res.status === 404) {
      // VMProv has no record — our submit never really landed. Drop the job_id
      // so the next tick resubmits with a fresh one.
      env.vmProvision.status = 'error';
      env.vmProvision.jobId = undefined;
      env.vmProvision.lastError = 'VMProv has no record of the job — will resubmit';
    } else if (res.ok) {
      vmApplyStatus(project, env, await res.json());
    }
    persist();
    broadcastProjects();
  } catch {
    // transient — leave as 'submitted' and try again next reconcile window
  } finally {
    clearTimeout(timer);
    vmInFlight.delete(env.id);
  }
}

const vmAge = ts => Date.now() - Date.parse(ts ?? 0);
// Errored (or a submit left mid-flight by a restart) and past the backoff.
function vmResubmitDue(vp) {
  if (!vp) return true;
  if (vp.status === 'error' || vp.status === 'submitting') {
    const age = vmAge(vp.lastAttemptAt);
    return Number.isNaN(age) ? true : age >= VM_RETRY_MS;
  }
  return false;
}
// A 'submitted' job we haven't heard back on within the reconcile window.
function vmReconcileDue(vp) {
  if (vp?.status !== 'submitted' || !vp.jobId) return false;
  const age = vmAge(vp.lastReconcileAt ?? vp.lastAttemptAt);
  return Number.isNaN(age) ? true : age >= VM_RECONCILE_MS;
}

// One sweep (boot, or an env moved to `vms`): submit fresh/errored envs and
// reconcile stuck ones, up to the remaining concurrency budget. Cheap
// synchronous scan; work runs detached.
function vmTick() {
  try {
    if (!VM_ON) return;
    let slots = VM_MAX_CONCURRENT - vmInFlight.size;
    if (slots <= 0) return;
    for (const p of projects) {
      for (const env of p.environments) {
        if (slots <= 0) return;
        if (env.stage !== 'vms' || vmInFlight.has(env.id)) continue;
        const vp = env.vmProvision;
        if (!vp || vmResubmitDue(vp)) { slots--; vmSubmit(p, env); }
        else if (vmReconcileDue(vp)) { slots--; vmReconcile(p, env); }
      }
    }
  } catch (e) {
    console.error('[vmprov] tick error:', e);
  }
}

// Completion callback from VMProv. Authenticated by the shared callback token
// (NOT a Relay API key), so it is registered outside requireKey. Must answer
// 2xx quickly, else VMProv retries with exponential backoff.
app.post('/vmprov/callback', (req, res) => {
  if (VM_CALLBACK_TOKEN) {
    const got = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (got !== VM_CALLBACK_TOKEN) return res.status(401).json({ error: 'invalid callback token' });
  }
  const data = req.body ?? {};
  if (!data.job_id) return res.status(400).json({ error: 'job_id is required' });
  const found = vmFindByJobId(data.job_id);
  // Ack unknown jobs with 200 so VMProv stops retrying a job we no longer track.
  if (!found) return res.status(200).json({ ok: true, note: 'no matching env' });
  vmApplyStatus(found.project, found.env, data);
  persist();
  broadcastProjects();
  res.status(200).json({ ok: true });
});

// Long-running service: log stray rejections instead of letting them crash it.
process.on('unhandledRejection', err => console.error('[relay] unhandled rejection:', err));

server.listen(PORT, () => {
  console.log(`Relay server on http://localhost:${PORT}`);
  console.log(`${keys.filter(k => !k.revoked).length} active API key(s) — manage them in Settings or server/data/api-keys.json`);
  if (VM_ON) {
    // Boot sweep: pick up envs left at `vms` (or mid-submit) by a restart.
    // After this, submits are purely event-driven from the /status PATCH.
    vmTick();
    console.log(`[vmprov] ON → POST ${VM_AGENT_URL} when an env moves to 'vms'; callback ${VM_CALLBACK_URL}; advance to '${VM_NEXT_STAGE}' on Completed (max ${VM_MAX_CONCURRENT} concurrent)`);
  } else {
    const missing = [
      !VM_AGENT_URL && 'RELAY_VM_AGENT_URL',
      !VM_AGENT_TOKEN && 'RELAY_VM_AGENT_TOKEN',
      !VM_CALLBACK_URL && 'RELAY_VM_CALLBACK_URL',
    ].filter(Boolean).join(', ');
    console.log(`[vmprov] OFF — set ${missing} to enable`);
  }
});
