import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAuthRoutes, currentUser, SSO_ENABLED } from './auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
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
  const envs = Array.isArray(b.environments) ? b.environments.map(normalizeEnv) : projects[i].environments;
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
const broadcastProjects = () => broadcast({ type: 'projects', projects });

wss.on('connection', (ws, req) => {
  // When SSO is on, the live channel (which streams every project) is for
  // authenticated browser sessions only — reject anonymous sockets.
  const user = SSO_ENABLED ? currentUser(req) : null;
  if (SSO_ENABLED && !user) {
    ws.close(1008, 'authentication required');
    return;
  }

  clients.set(ws, { id: uid(), name: user?.name || 'Guest' });
  ws.send(JSON.stringify({ type: 'projects', projects }));
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

server.listen(PORT, () => {
  console.log(`Relay server on http://localhost:${PORT}`);
  console.log(`${keys.filter(k => !k.revoked).length} active API key(s) — manage them in Settings or server/data/api-keys.json`);
});
