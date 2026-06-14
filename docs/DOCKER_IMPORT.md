# Docker / Portainer Import

Rackpad includes a read-only Docker / Portainer import for previewing containers, importing selected rows as `container` devices, and refreshing their status from the Docker API.

Open Rackpad → **Imports** → **Docker container import**.

## What Works Today

1. Choose a local Docker socket or HTTP / Portainer connection.
2. For local socket mode, mount the socket into the Rackpad container and use `/var/run/docker.sock`.
3. For HTTP mode, paste a Docker Engine API base URL or a Portainer proxy URL.
4. Optionally supply an API token for HTTP mode. Preview uses it for the current request; imported containers store the token encrypted so Rackpad can refresh status later.
5. Preview containers (name, image, state/status).
6. Choose a compute host device in the lab and import one container as a virtual `container` workload attached to that host.
7. Use **Refresh Docker statuses** to update imported containers immediately, or let the server background sync do it automatically.

For socket mode, add the Docker socket as a read-only mount in your compose file:

```yaml
services:
  rackpad:
    volumes:
      - rackpad_data:/data
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

Imported containers store:

- `specs`: `docker-image: <image:tag>`
- `notes`: `docker-import | image: … | status: … | source: …`
- `parentDeviceId`: selected host device
- `placement`: `virtual`
- `status`: `online` when Docker reports `running`, otherwise `offline`
- Docker source/link metadata used for later status refresh

## Safety Guarantees

- API tokens are encrypted with `RACKPAD_SECRET_KEY` before they are persisted.
- Background status sync is read-only and only queries Docker/Portainer endpoints already used for imported containers.
- No write-back to Docker (stop/start/remove) is attempted.
- Import only creates a new device record; it does not modify IPAM or VLAN data.
- Mounting the Docker socket gives Rackpad access to the host Docker API. Rackpad only calls read-only container-list endpoints for this feature, but the Docker socket itself is a privileged interface.

## Status Sync

The Rackpad server refreshes Docker import statuses every five minutes by default. Set `DOCKER_STATUS_SYNC_INTERVAL_MS=0` to disable the background sync, or provide another interval in milliseconds.

When a container is still present, Rackpad updates the imported device's `status`, `lastSeen`, image specs, and Docker link metadata. If Docker no longer returns the container, Rackpad marks the imported device offline.

## Deferred Work

- Portainer environment selection UI
- Health rollups on the host device
- Automatic port/interface synthesis from exposed container ports
- Bulk import and compose-stack grouping
- TLS client certificate auth for locked-down Docker endpoints

## API Endpoints

- `POST /api/imports/docker/preview` — list containers from a provided endpoint
- `POST /api/imports/docker/import` — create one imported `container` device
- `POST /api/imports/docker/sync` — refresh statuses for Docker imports in a lab

## Tests

Parser and Portainer path coverage lives in `server/tests/docker-import.test.ts`; API import/sync coverage lives in `server/tests/app.test.ts` with mocked Docker responses.
