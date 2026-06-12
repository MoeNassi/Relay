# Relay API — for agents

Base URL: `http://localhost:5181` (or through the Vite dev server at `http://localhost:5180`).

## Authentication

All write operations require the API key, sent as `X-API-Key: <key>` or `Authorization: Bearer <key>`.
The key is generated on first server start and stored in `server/data/api-key`.

```bash
KEY=$(cat server/data/api-key)
```

In dev mode (`RELAY_DEV` unset), `GET /api/key` returns the key — that's how the
browser app authenticates itself. Disable in production (`RELAY_DEV=0`) and put
the UI behind SSO.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/projects` | none | list projects |
| GET | `/api/projects/:id` | none | one project |
| POST | `/api/projects` | key | create a project |
| PUT | `/api/projects/:id` | key | replace a project |
| PATCH | `/api/projects/:id/status` | key | change pipeline status |
| DELETE | `/api/projects/:id` | key | delete |

Stages: `new` → `vms` → `scan` → `publication` → `live`.
Teams (ball holder): `infra`, `cybersec`, `owner` — defaults to the stage's usual team if omitted.
Every status change is appended to `history`, which drives the per-stage SLA clocks in the UI.

## Examples

Create a project (minimal — `name` and `owner.name` required):

```bash
curl -s -X POST http://localhost:5181/api/projects \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{
    "name": "Billing Service",
    "dns": "billing.um6p.ma",
    "owner": { "name": "M. Idrissi", "title": "Finance IT Lead" },
    "environments": [{ "id": "e1", "name": "prod", "vms": [
      { "id": "v1", "role": "app server", "count": 2, "vcpu": 4, "ramGb": 8, "diskGb": 80, "os": "Ubuntu 24.04" }
    ]}],
    "flows": [{ "id": "f1", "source": "app server", "destination": "db", "port": "5432",
                "protocol": "TCP", "direction": "outbound", "note": "PostgreSQL" }]
  }'
```

Move it to "Creating VMs" (ball goes to Network & Infra automatically):

```bash
curl -s -X PATCH http://localhost:5181/api/projects/<id>/status \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{ "stage": "vms" }'
```

Hand the scan stage explicitly to cybersec:

```bash
curl -s -X PATCH http://localhost:5181/api/projects/<id>/status \
  -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{ "stage": "scan", "team": "cybersec" }'
```

Connected browsers update instantly — changes are broadcast over the WebSocket (`/ws`),
which also carries the presence list shown as avatars in the top bar.
