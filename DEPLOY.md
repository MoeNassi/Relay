# Deploying Relay to production

Relay is a single Node process that serves the built UI **and** the API/WebSocket
on **port 5181**. `git push` only stores the code — these steps run it live.

## Option A — Docker (recommended)

On the prod host (needs Docker + Docker Compose):

```bash
git clone git@github.com:MoeNassi/Relay.git && cd Relay
# optional: enable SSO — otherwise it runs without sign-in
cp .env.example .env && $EDITOR .env
docker compose up -d --build
```

The app is now on `http://<host>:5181`. Project data persists in the
`relay-data` volume across restarts and rebuilds.

## Option B — bare VM (no Docker)

Needs Node 20+:

```bash
git clone git@github.com:MoeNassi/Relay.git && cd Relay
npm ci
npm run build
# optional SSO:
export RELAY_SSO_TENANT_ID=... RELAY_SSO_CLIENT_ID=... RELAY_SSO_CLIENT_SECRET=... \
       RELAY_SSO_REDIRECT_URI=https://relay.um6p.ma/auth/callback RELAY_SSO_SECURE=1
NODE_ENV=production node server/server.mjs
```

Run it under a process manager so it survives reboots — e.g. a systemd unit:

```ini
# /etc/systemd/system/relay.service
[Unit]
Description=Relay
After=network.target
[Service]
WorkingDirectory=/opt/Relay
Environment=NODE_ENV=production
EnvironmentFile=/opt/Relay/.env
ExecStart=/usr/bin/node server/server.mjs
Restart=always
User=relay
[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now relay`

## TLS / reverse proxy (required for SSO)

Terminate HTTPS in front and proxy to 5181. **The `/ws` location must allow the
WebSocket upgrade** or presence + live updates break:

```nginx
server {
  listen 443 ssl;
  server_name relay.um6p.ma;
  ssl_certificate     /etc/ssl/relay.crt;
  ssl_certificate_key /etc/ssl/relay.key;

  location / {
    proxy_pass http://127.0.0.1:5181;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location /ws {
    proxy_pass http://127.0.0.1:5181;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
  }
}
```

## SSO checklist

- Set all four `RELAY_SSO_*` vars (see `.env.example`); leave them blank to run
  without sign-in.
- `RELAY_SSO_REDIRECT_URI` must **exactly** match a Redirect URI registered on the
  Entra app (e.g. `https://relay.um6p.ma/auth/callback`).
- Set `RELAY_SSO_SECURE=1` when served over HTTPS (sets the Secure cookie flag).
- When SSO is configured, `GET /api/key` is disabled — the browser authenticates
  by session cookie. Agents still use API keys (`X-API-Key`); manage them in
  **Settings**. See `API.md`.

## After deploy

- Create per-agent API keys in **Settings** for CI / automation.
- Sessions are in-memory, so a restart signs everyone out (fine for now; move to
  Redis if that becomes an issue).
