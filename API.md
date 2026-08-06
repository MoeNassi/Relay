# Relay API — for agents

Base URL: `http://localhost:5181` (or through the Vite dev server at `http://localhost:5180`).

## Authentication

All write operations require an API key, sent as `X-API-Key: <key>` or `Authorization: Bearer <key>`.

Keys are managed in **Settings → API keys** in the web UI: create one named key per
agent/integration, copy the secret at creation time (it is shown only once), and revoke
it there when the agent is retired. Revoking deletes the key: it is refused immediately
and disappears from the list. "Last used" updates on every authenticated call. The key
store lives in `server/data/api-keys.json`.

In dev mode (`RELAY_DEV` unset), `GET /api/key` returns the web UI's own session key —
that's how the browser app authenticates itself. Disable in production (`RELAY_DEV=0`)
and put the UI behind SSO.

Key management endpoints (require any active key):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/keys` | list keys (masked) |
| POST | `/api/keys` | create — body `{ "name": "scan-bot" }`, returns the secret once |
| DELETE | `/api/keys/:id` | revoke |

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/projects` | none | list projects |
| GET | `/api/projects/:id` | none | one project |
| POST | `/api/projects` | key | create a project |
| PUT | `/api/projects/:id` | key | replace a project |
| PATCH | `/api/projects/:id/status` | key | change ONE environment's pipeline status |
| PATCH | `/api/projects/:id/scan` | key | mark ONE sub-scan (agent/pentest/cloud) done |
| DELETE | `/api/projects/:id` | key | delete |

**Each environment runs its own pipeline.** A project has `environments[]`, and
status changes target one environment by `envId`.

Stages (per environment): `arch` → `vms` → `gitlab` → `pipeline` → `deploy` →
`publication` → `scan` → `live` (`deploy` = development/deployment, no SLA clock).
SLA targets: `arch` 48h, `vms` 48h, `gitlab` 48h, `pipeline` 48h, `publication` 48h,
`scan` 120h (5 days).

**One-time tasks.** `arch` (architecture & spec check), `vms` (VM creation),
`gitlab` (GitLab access) and `pipeline` (CI/CD pipeline check) run once per
project, on the FIRST environment in promotion order only. Later environments
start directly at `deploy`; setting them to a one-time stage returns `409`.
The terminal `live` stage means "Live in production" only for `prod` — for every
other environment it simply marks the pipeline completed (the UI shows "Completed").

**Security scans.** The `scan` stage runs three sub-scans — `agent`, `pentest`, `cloud`
— tracked in each environment's `scans` object. All three must pass before an
environment can leave `scan` for `live`, EXCEPT `dev`, which is exempt.
Marking one done:

```bash
curl -s -X PATCH http://localhost:5181/api/projects/<id>/scan \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{ "envId": "<envId>", "scanType": "pentest", "done": true }'
```

Advancing a non-`dev` env past `scan` with any sub-scan outstanding returns `409`.
Every scan check/uncheck is appended to the environment's `history` as an entry with
`kind: "scan"` (informational — excluded from SLA math) so the activity log keeps a
trace. Moving an environment BACK from beyond `scan` (e.g. `live` → `scan`) resets
all sub-scans to outstanding — they must be re-validated — while the log entries remain.
Teams (ball holder): `infra`, `network`, `cybersec`, `owner` — defaults to the stage's usual team if omitted.
Promotion order is `dev → rec → preprod → prod` (custom names last); an environment can only
change status once the previous one is `live` (otherwise `409`). Each change is appended to
that environment's `history`, driving its per-stage SLA clocks.

**DNS is per environment** — each entry in `environments[]` takes its own `dns`
(e.g. `app-dev.um6p.ma` vs `app.um6p.ma`). The project-level `dns` field is legacy:
on load it is folded onto the `prod` environment when no env has a DNS yet.

## Examples

Create a project with two environments (`name` and `owner.name` required):

```bash
curl -s -X POST http://localhost:5181/api/projects \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{
    "name": "Billing Service",
    "owner": { "name": "M. Idrissi", "title": "Finance IT Lead" },
    "environments": [
      { "name": "rec", "dns": "billing-rec.um6p.ma", "vms": [
        { "role": "app server", "count": 1, "vcpu": 4, "ramGb": 8, "diskGb": 80, "os": "Ubuntu 24.04" } ] },
      { "name": "prod", "dns": "billing.um6p.ma", "vms": [
        { "role": "app server", "count": 2, "vcpu": 8, "ramGb": 16, "diskGb": 120, "os": "Ubuntu 24.04" } ] }
    ],
    "flows": [{ "source": "app server", "destination": "db", "port": "5432",
                "protocol": "TCP", "direction": "outbound", "note": "PostgreSQL" }]
  }'
```

The response includes each environment's `id`. Move ONE environment to a stage
(`envId` required). An optional `note` is recorded on the activity log and `by`
is set to the API key's name (or signed-in user):

```bash
curl -s -X PATCH http://localhost:5181/api/projects/<id>/status \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{ "envId": "<envId>", "stage": "vms", "note": "VMs provisioned, awaiting OS hardening" }'
```

Hand the scan stage of an environment explicitly to cybersec:

```bash
curl -s -X PATCH http://localhost:5181/api/projects/<id>/status \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{ "envId": "<envId>", "stage": "scan", "team": "cybersec" }'
```

Connected browsers update instantly — changes are broadcast over the WebSocket (`/ws`),
which also carries the presence list shown as avatars in the top bar.
