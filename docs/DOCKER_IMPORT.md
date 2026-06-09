# Docker / Portainer Import

Rackpad includes a read-only foundation for previewing Docker containers and importing selected rows as `container` devices.

Open Rackpad → **Imports** → **Docker container import**.

## What Works Today

1. Paste a Docker Engine API base URL (for example `http://127.0.0.1:2375`) or a Portainer proxy URL.
2. Optionally supply an API token for that single preview/import request.
3. Preview containers (name, image, state/status).
4. Choose a compute host device in the lab and import one container as a virtual `container` workload attached to that host.

Imported containers store:

- `specs`: `docker-image: <image:tag>`
- `notes`: `docker-import | image: … | status: … | source: …`
- `parentDeviceId`: selected host device
- `placement`: `virtual`
- `status`: `online` when Docker reports `running`, otherwise `offline`

## Safety Guarantees

- Endpoint URLs and tokens are **not persisted**.
- No background polling or scheduled sync runs in this phase.
- No write-back to Docker (stop/start/remove) is attempted.
- Import only creates a new device record; it does not modify IPAM or VLAN data.

## Deferred Work

- Persisted credentials and Portainer environment selection
- Scheduled status sync and health rollups on the host device
- Automatic port/interface synthesis from exposed container ports
- Bulk import and compose-stack grouping
- TLS client certificate auth for locked-down Docker endpoints

Track follow-up work in issue **#54** before treating this as a live container inventory integration.

## API Endpoints

- `POST /api/imports/docker/preview` — list containers from a provided endpoint
- `POST /api/imports/docker/import` — create one imported `container` device

## Tests

Parser coverage lives in `server/tests/docker-import.test.ts` using a sample Docker Engine JSON payload (no live endpoint calls in CI).
