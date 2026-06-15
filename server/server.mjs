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

const STAGES = ['arch', 'vms', 'deploy', 'scan', 'publication', 'live'];
const FIRST_STAGE = STAGES[0];
const TEAMS = ['infra', 'network', 'cybersec', 'owner'];
const DEFAULT_TEAM = { arch: 'infra', vms: 'infra', deploy: 'owner', scan: 'cybersec', publication: 'network', live: 'owner' };
const ENV_ORDER = ['dev', 'preprod', 'prod'];
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
      dns: 'cartographie.um6p.ma',
      owner: { name: 'C. Ibnsina', title: 'IT Project Manager' },
      environments: [
        {
          id: uid(),
          name: 'dev',
          vms: [{ id: uid(), role: 'all-in-one', count: 1, vcpu: 2, ramGb: 4, diskGb: 60, os: 'Ubuntu 24.04' }],
          stage: 'live',
          team: 'owner',
          history: [
            { stage: 'arch', team: 'infra', enteredAt: h(20) },
            { stage: 'vms', team: 'infra', enteredAt: h(19) },
            { stage: 'deploy', team: 'owner', enteredAt: h(18) },
            { stage: 'scan', team: 'cybersec', enteredAt: h(12) },
            { stage: 'publication', team: 'network', enteredAt: h(11) },
            { stage: 'live', team: 'owner', enteredAt: h(10) },
          ],
        },
        {
          id: uid(),
          name: 'prod',
          vms: [
            { id: uid(), role: 'app server', count: 2, vcpu: 4, ramGb: 8, diskGb: 80, os: 'Ubuntu 24.04' },
            { id: uid(), role: 'db', count: 1, vcpu: 4, ramGb: 16, diskGb: 200, os: 'Ubuntu 24.04' },
          ],
          stage: 'scan',
          team: 'cybersec',
          history: [
            { stage: 'arch', team: 'infra', enteredAt: h(9) },
            { stage: 'vms', team: 'infra', enteredAt: h(8) },
            { stage: 'deploy', team: 'owner', enteredAt: h(7) },
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
      dns: 'hr.um6p.ma',
      owner: { name: 'S. Alaoui', title: 'HR Director' },
      environments: [
        {
          id: uid(),
          name: 'preprod',
          vms: [{ id: uid(), role: 'app server', count: 1, vcpu: 8, ramGb: 16, diskGb: 120, os: 'RHEL 9' }],
          stage: 'vms',
          team: 'infra',
          history: [
            { stage: 'arch', team: 'infra', enteredAt: h(9) },
            { stage: 'vms', team: 'infra', enteredAt: h(7) },
          ],
        },
        {
          id: uid(),
          name: 'prod',
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
  }
  return list;
}

let projects;
try {
  projects = migrate(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  persist();
} catch {
  projects = seed();
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

function normalizeEnv(e) {
  return {
    id: e?.id ?? uid(),
    name: String(e?.name ?? 'env'),
    vms: Array.isArray(e?.vms) ? e.vms : [],
    stage: STAGES.includes(e?.stage) ? e.stage : null,
    team: TEAMS.includes(e?.team) ? e.team : null,
    history: Array.isArray(e?.history) ? e.history : [],
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
  projects[i] = { ...req.body, id: req.params.id };
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
  const t = TEAMS.includes(team) ? team : DEFAULT_TEAM[stage];
  const by = req.user?.name ?? req.keyInfo?.name ?? null;
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
