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

const STAGES = ['new', 'vms', 'scan', 'publication', 'live'];
const TEAMS = ['infra', 'cybersec', 'owner'];
const DEFAULT_TEAM = { new: 'owner', vms: 'infra', scan: 'cybersec', publication: 'infra', live: 'owner' };

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
          name: 'prod',
          vms: [
            { id: uid(), role: 'app server', count: 2, vcpu: 4, ramGb: 8, diskGb: 80, os: 'Ubuntu 24.04' },
            { id: uid(), role: 'db', count: 1, vcpu: 4, ramGb: 16, diskGb: 200, os: 'Ubuntu 24.04' },
          ],
        },
        { id: uid(), name: 'dev', vms: [{ id: uid(), role: 'all-in-one', count: 1, vcpu: 2, ramGb: 4, diskGb: 60, os: 'Ubuntu 24.04' }] },
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
        { id: uid(), name: 'prod', vms: [{ id: uid(), role: 'app server', count: 1, vcpu: 8, ramGb: 16, diskGb: 120, os: 'RHEL 9' }] },
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

let projects;
try {
  projects = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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

app.post('/api/projects', requireKey, (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.owner?.name) {
    return res.status(400).json({ error: 'name and owner.name are required' });
  }
  const stage = STAGES.includes(b.stage) ? b.stage : 'new';
  const team = TEAMS.includes(b.team) ? b.team : DEFAULT_TEAM[stage];
  const now = new Date().toISOString();
  const project = {
    id: uid(),
    name: String(b.name),
    dns: b.dns ?? '',
    owner: { name: b.owner.name, title: b.owner.title ?? '' },
    environments: Array.isArray(b.environments) ? b.environments : [],
    flows: Array.isArray(b.flows) ? b.flows : [],
    stage,
    team,
    history: Array.isArray(b.history) && b.history.length ? b.history : [{ stage, team, enteredAt: now }],
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

// Agents change pipeline status here; history (and thus SLA clocks) updates automatically.
app.patch('/api/projects/:id/status', requireKey, (req, res) => {
  const p = projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const { stage, team } = req.body ?? {};
  if (!STAGES.includes(stage)) {
    return res.status(400).json({ error: `stage must be one of: ${STAGES.join(', ')}` });
  }
  const t = TEAMS.includes(team) ? team : DEFAULT_TEAM[stage];
  p.stage = stage;
  p.team = t;
  p.history.push({ stage, team: t, enteredAt: new Date().toISOString() });
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

// serve the built app in production
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api|\/ws|\/auth).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
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
