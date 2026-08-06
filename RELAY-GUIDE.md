# Relay — Quick Guide

Relay tracks projects as they move through their delivery pipeline. Each project
has one or more **environments** (dev, preprod, prod), and each environment runs
its own pipeline. This guide shows how to create a project and move it through
the stages.

- **Web UI:** http://localhost:5173 (dev) — open this in your browser.
- **API base URL:** http://localhost:5181

---

## 1. Get an API key

Every write operation (create, update, change status) needs an API key.

Open the web UI → **Settings → API keys** → **Create key**. Give it a name (e.g.
`billing-bot`) and **copy the secret immediately** — it is shown only once. Revoke
it from the same screen when the integration is retired.

Send the key on every request as a header:

```
X-API-Key: <your-key>
```

(or `Authorization: Bearer <your-key>`)

---

## 2. The pipeline

Each environment moves through these stages, in order:

```
arch  →  vms  →  deploy  →  scan  →  publication  →  live
```

Each stage has a team that owns it (the "ball holder") and an SLA target:

| Stage         | Owning team | SLA target        |
| ------------- | ----------- | ----------------- |
| arch          | devops      | 48h               |
| vms           | infra       | 48h (2 days)      |
| deploy        | owner       | — (no clock)      |
| scan          | cybersec    | 120h (5 days)     |
| publication   | network     | 48h               |
| live          | owner       | — (terminal)      |

**Promotion order across environments:** `dev → preprod → prod`. An environment
can only start advancing once the previous one has reached `live` — otherwise the
API returns `409 Conflict`.

### Security scans

The `scan` stage runs **three sub-scans** — **agent**, **pentest**, and **cloud**.
All three must pass before an environment can move from `scan` to `publication`.
The one exception is **`dev`, which is exempt** and can advance without scans.

Mark a sub-scan complete:

```bash
curl -s -X PATCH http://localhost:5181/api/projects/<projectId>/scan \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{ "envId": "<envId>", "scanType": "pentest", "done": true }'
```

In the web UI, tick them off in the **Security scans** panel on the project page.
Trying to advance a non-`dev` environment past `scan` with any scan still
outstanding returns `409 Conflict`.

---

## 3. Create a project

`name` and `owner.name` are required. The response includes an `id` for the
project and an `id` for each environment — you'll need the environment `id`
(`envId`) to change status later.

```bash
KEY="<your-key>"

curl -s -X POST http://localhost:5181/api/projects \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{
    "name": "Billing Service",
    "dns": "billing.um6p.ma",
    "owner": { "name": "M. Idrissi", "title": "Finance IT Lead" },
    "environments": [
      { "name": "preprod", "vms": [
        { "role": "app server", "count": 1, "vcpu": 4, "ramGb": 8, "diskGb": 80, "os": "Ubuntu 24.04" } ] },
      { "name": "prod", "vms": [
        { "role": "app server", "count": 2, "vcpu": 8, "ramGb": 16, "diskGb": 120, "os": "Ubuntu 24.04" } ] }
    ]
  }'
```

---

## 4. Change an environment's status

Move **one** environment to a stage. `envId` and `stage` are required. An optional
`note` is recorded on the activity log; `by` is set automatically to the key's name.

```bash
curl -s -X PATCH http://localhost:5181/api/projects/<projectId>/status \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{ "envId": "<envId>", "stage": "vms", "note": "VMs provisioned, awaiting OS hardening" }'
```

You can also hand a stage to a specific team explicitly:

```bash
curl -s -X PATCH http://localhost:5181/api/projects/<projectId>/status \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{ "envId": "<envId>", "stage": "scan", "team": "cybersec" }'
```

Connected browsers update instantly — every change is broadcast live over the
WebSocket, so the board reflects it without a refresh.

---

## Endpoint reference

| Method | Path                          | Auth | Purpose                          |
| ------ | ----------------------------- | ---- | -------------------------------- |
| GET    | `/api/projects`               | none | list projects                    |
| GET    | `/api/projects/:id`           | none | one project                      |
| POST   | `/api/projects`               | key  | create a project                 |
| PUT    | `/api/projects/:id`           | key  | replace a project                |
| PATCH  | `/api/projects/:id/status`    | key  | change ONE environment's status  |
| PATCH  | `/api/projects/:id/scan`      | key  | mark ONE sub-scan done/undone    |
| DELETE | `/api/projects/:id`           | key  | delete a project                 |

Questions? Ping the platform team.
</content>
</invoke>
