# Rackpad

Rackpad is a self-hosted infrastructure inventory and operations app for racks, devices, ports, cables, VLANs, IP address management, WiFi, compute, discovery, monitoring, labs, and users.

Current release: `v1.2.3-beta.6`

It is a full-stack app:

- React + Vite frontend
- Fastify API
- SQLite persistence through `better-sqlite3`
- session-based authentication with admin/editor/viewer roles
- per-device health checks with multi-target ICMP, TCP, HTTP, and HTTPS monitor support
- Docker support for a single-container test deployment

## Quick links

If `rackpad.co.za` is unavailable, the repo still contains the core material you need:

- [Installation guide](./INSTALL.md)
- [Proxmox install notes](./docs/PROXMOX.md)
- [Hyper-V import guide](./docs/HYPERV_IMPORT.md)
- [Proxmox import guide](./docs/PROXMOX_IMPORT.md)
- [Reports guide](./docs/REPORTS.md)
- [Visualizer guide](./docs/VISUALIZER.md)
- [OIDC login guide](./docs/OIDC.md)
- [Documentation and images guide](./docs/DOCUMENTATION.md)
- [Security policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)
- [MIT license](./LICENSE)
- [Support notes](./SUPPORT.md)

## Screenshots

These are 1920x1200 live captures from the working Rackpad demo environment,
embedded directly in the GitHub repo.

### Overview and physical inventory

| Dashboard                                              | Racks                                               |
| ------------------------------------------------------ | --------------------------------------------------- |
| ![Rackpad dashboard](./docs/screenshots/dashboard.png) | ![Rackpad racks view](./docs/screenshots/racks.png) |

| Devices                                                      | Ports                                                            |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| ![Rackpad devices inventory](./docs/screenshots/devices.png) | ![Rackpad ports and patching view](./docs/screenshots/ports.png) |

| Cables                                                   | IPAM                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ |
| ![Rackpad cables workspace](./docs/screenshots/cables.png) | ![Rackpad IPAM workspace](./docs/screenshots/ipam.png) |

### Visualizer cable mapping

| Topology and cable paths                                       | Selected cable inspector                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ![Rackpad visualizer workspace](./docs/screenshots/visualizer.png) | ![Rackpad visualizer selected cable](./docs/screenshots/visualizer-cables.png) |

| Health overlay                                                        | Trace mode                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| ![Rackpad visualizer health overlay](./docs/screenshots/visualizer-health.png) | ![Rackpad visualizer trace mode](./docs/screenshots/visualizer-trace.png) |

| Loose devices below racks                                             |
| --------------------------------------------------------------------- |
| ![Rackpad visualizer loose-device layout](./docs/screenshots/visualizer-layout.png) |

### Operations and documentation

| Monitoring                                                         | Compute                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| ![Rackpad monitoring workspace](./docs/screenshots/monitoring.png) | ![Rackpad compute workspace](./docs/screenshots/compute.png) |

| Documentation                                                      |
| ------------------------------------------------------------------ |
| ![Rackpad documentation workspace](./docs/screenshots/documentation.png) |

### Wireless, discovery, and address management

| WiFi                                                   | Discovery                                                        |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| ![Rackpad WiFi workspace](./docs/screenshots/wifi.png) | ![Rackpad discovery workspace](./docs/screenshots/discovery.png) |

These are enough to see the app before installing it, and the full screenshot set used for GitHub previews lives in [`docs/screenshots`](./docs/screenshots).

## What you can see before install

From the GitHub repo alone, you can already preview the major Rackpad workspaces:

- Dashboard for inventory, health, capacity, and recent activity
- Racks for physical placement, mounted gear, and room-tech context
- Devices for searchable inventory and placement-aware records
- Ports for switch, host, AP, VM, and patch-panel connectivity
- Compute for hosts, VMs, and virtual switch / bridge membership
- WiFi for controllers, SSIDs, radios, clients, and signal context
- Discovery for staged imports, MAC/vendor hints, and duplicate detection
- Monitoring for multi-target ICMP, TCP, HTTP, and HTTPS checks
- IPAM for subnets, DHCP scopes, IP zones, and linked assignments
- Documentation for Markdown notes, runbooks, and inline pictures
- Imports for review-first Hyper-V and Proxmox host, VM, and container onboarding
- Reports for printable/PDF, Excel-compatible, and CSV exports
- Visualizer for rack, loose-room, port, and cable relationship maps

## What works

- Rack inventory and physical placement
- Add, edit, and delete racks
- Add, edit, and delete devices
- Custom device types for inventory, discovery, icons, filters, and port templates
- MAC address fields, search, sort, import, and display beside IP context
- Device placement modes for rack, room, wireless, and virtual inventory
- Parent-child device relationships for hosted VMs and AP-linked wireless clients
- Compute workspace for virtualization hosts and VMs
- Capacity tracking for hosts and VMs with CPU, memory, storage, and specs fields
- Port templates for new devices
- Manual port create, edit, and delete
- Create, edit, and delete cables
- VLAN allocation and VLAN deletion
- VLAN range create, edit, and delete
- IPAM subnet, DHCP scope, and IP zone CRUD
- Controller-aware WiFi workspace for controllers, SSIDs, AP radios, and wireless clients
- Wireless client telemetry with AP, SSID, band, channel, signal, last-seen, and roam context
- Discovery inbox with subnet scan, duplicate awareness, review, and import into inventory
- Discovery enrichment with MAC/vendor capture and direct linking to existing inventory
- Management IP synchronization between device records and IPAM
- Next-free IP allocation and IP release
- Direct links between devices, ports, IPAM assignments, racks, rooms, dashboard cards, reports, and visualizer inspector entries
- Audit log writes for the main workflows
- User bootstrap, login, logout, and user management
- Optional OIDC login with PKCE, role mapping, and Authentik-style issuer/debug guidance
- Admin-only JSON backup export from the users screen
- Backup exports preserve password hashes, documentation pages, device images, MACs, and parent-linked devices for restore, but redact stored alert-delivery secrets before download
- Device health-check configuration, alert destinations, repeat-alert controls, and on-demand monitor runs
- Multiple monitor targets per device so servers, firewalls, and multi-NIC systems can track separate management, service, storage, or VIP endpoints
- SMTP/email alert delivery beside Discord and Telegram, plus recent alert activity in the admin area
- Reports workspace with printable/PDF-friendly inventory summaries plus Excel-compatible and CSV exports
- Visualizer workspace for rack, room-tech, port, and cable relationship mapping, with Health mode, Trace mode, loose-device layout toggles, and room-only rack-zone toggles
- Markdown Documentation workspace for runbooks and notes, including inline image insertion
- Device image attachments with labels and notes on device detail pages
- Hyper-V import wizard for staging hosts, VMs, power state, guest OS, virtual switches, virtual NICs, VLANs, IPs, CPU, memory, and disk data from a local PowerShell export, with editable host mapping before import
- Proxmox import wizard for staging nodes, Linux bridges, QEMU VMs, LXC containers, MACs, VLAN tags/trunks, guest IPs, CPU, RAM, disks, boot flags, and Proxmox metadata from a local node export
- Expanded demo data with multiple labs, MAC addresses, discovery states, custom templates/device types, multi-target monitors, room tech, documentation pages, device image examples, compute, and WiFi examples
- Production build of the frontend and backend
- Docker packaging for the frontend + API together

## Feature guides

Use these when you want the workflow steps rather than just the overview:

- [Hyper-V import](./docs/HYPERV_IMPORT.md): download the collector, collect inventory on a Hyper-V host, map or create the host record, review VMs, and import selected categories.
- [Proxmox import](./docs/PROXMOX_IMPORT.md): download the collector, collect inventory on a Proxmox node, map or create the node record, review QEMU VMs and LXC containers, and import selected categories.
- [Reports](./docs/REPORTS.md): generate a clean inventory report, print/save to PDF, and export CSV or Excel-compatible files.
- [Visualizer](./docs/VISUALIZER.md): inspect rack, loose-room, port, and cable relationships from existing Rackpad data.
- [OIDC login](./docs/OIDC.md): configure Authentik or another IdP, map roles, and debug issuer/discovery URL problems.
- [Documentation and images](./docs/DOCUMENTATION.md): create Markdown runbooks, insert pictures, attach device reference images, and include them in backups.

## Versioning

Rackpad uses semantic versioning and Git tags in the form `vX.Y.Z`.

- The app version lives in [package.json](./package.json).
- Release notes live in [CHANGELOG.md](./CHANGELOG.md).
- The `v1.0` rollout checklist lives in [V1_CHECKLIST.md](./V1_CHECKLIST.md).
- Install and deploy examples should pin a version instead of assuming `main`.

Every shipped change should update the version and add a matching changelog entry describing what changed.

## Release channels

Rackpad now uses two long-lived Git branches:

- `main`: stable release branch intended for production and tagged releases
- `beta`: pre-release testing branch for changes that should be validated before they land on `main`

Recommended workflow:

- test new work from `beta`
- merge validated fixes and features into `main`
- create version tags like `v1.2.3` from `main`

If you want the newest testing build instead of the latest stable tag:

```bash
git checkout beta
git pull origin beta
```

## Legal and support files

The repository now also includes:

- the project [LICENSE](./LICENSE)
- copyright and project notices in [NOTICE.md](./NOTICE.md)
- a basic disclosure policy in [SECURITY.md](./SECURITY.md)
- maintainer/support expectations in [SUPPORT.md](./SUPPORT.md)

## Requirements

- Docker Engine with the Compose plugin for normal installs
- Node 22 LTS and npm for development or native installs

The repo includes `.nvmrc`, so if you use `nvm`:

```bash
nvm use
```

## Development

Install dependencies:

```bash
npm install
```

Run the full dev stack:

```bash
npm run dev:all
```

This starts:

- frontend on `http://localhost:5173`
- API on `http://localhost:3000`

The Vite dev server proxies `/api` to the Fastify backend.

## Production build

Build both the frontend and backend:

```bash
npm run build
```

Start the compiled app:

```bash
npm start
```

Default environment variables:

```bash
HOST=0.0.0.0
PORT=3000
DATABASE_PATH=./rackpad.db
MONITOR_INTERVAL_MS=300000
NODE_ENV=production
TRUST_PROXY=0
TRUSTED_HOSTS=
TRUSTED_ORIGINS=
APP_URL=
OIDC_ENABLED=0
OIDC_ISSUER_URL=
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
OIDC_REDIRECT_URI=
OIDC_LABEL=OIDC
OIDC_DEFAULT_ROLE=viewer
OIDC_DEBUG=0
OIDC_ADMIN_USERS=
OIDC_EDITOR_USERS=
OIDC_VIEWER_USERS=
OIDC_ADMIN_GROUPS=
OIDC_EDITOR_GROUPS=
OIDC_VIEWER_GROUPS=
OUI_AUTO_UPDATE=1
DISCOVERY_MAC_SCAN_MODE=auto
```

OIDC uses the authorization-code flow with PKCE. Configure the provider
redirect URI as `APP_URL/api/auth/oidc/callback`, or set `OIDC_REDIRECT_URI`
explicitly when Rackpad is behind a proxy with a non-standard public URL.
`OIDC_ISSUER_URL` must be the provider issuer, not the authorize URL or client
settings page. Rackpad fetches
`OIDC_ISSUER_URL/.well-known/openid-configuration`; if login returns a 502 with
HTTP 404, test that exact discovery URL in a browser or with `curl`. For
providers with per-application issuers, such as authentik, this usually means
using the application/provider issuer path rather than the IdP root domain.
Set `OIDC_DEBUG=1` temporarily to log the discovery URL, redirect URI, token
endpoint status, and JWKS URL used during sign-in.

Example Authentik configuration:

```bash
OIDC_ENABLED=1
OIDC_ISSUER_URL=https://authentik.example.com/application/o/rackpad
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_REDIRECT_URI=https://rackpad.example.com/api/auth/oidc/callback
OIDC_LABEL=Authentik
OIDC_DEFAULT_ROLE=viewer
OIDC_ADMIN_GROUPS=admin
```

In Authentik, set the redirect URI to
`https://rackpad.example.com/api/auth/oidc/callback` and assign a signing key to
the provider/application. For a single-admin private deployment you can set
`OIDC_DEFAULT_ROLE=admin`; for shared installs, keep the default role at
`viewer` and map admin/editor groups explicitly.

Discovery MAC/vendor enrichment needs layer-2 visibility from the Rackpad
runtime. `DISCOVERY_MAC_SCAN_MODE=auto` tries `arp-scan` and `nmap` when the
runtime can use them, then falls back to the OS neighbor/ARP cache. In Docker,
MACs may remain unavailable on bridge networking, Docker Desktop, routed VLANs,
VPNs, or containers without raw-socket capability; Rackpad will show scan
diagnostics when that happens.

## First run

On the first boot there are no users yet.

1. Open Rackpad in the browser.
2. Create the initial admin account.
3. Sign in.
4. Choose whether to start empty or preload the expanded demo environment.
5. Start documenting racks, devices, VLANs, and IPAM.

## Install With Docker

Recommended no-clone install from the published GHCR image:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates
curl -fsSL https://raw.githubusercontent.com/Kobii-git/Rackpad/main/scripts/install-docker.sh | bash
```

Use `RACKPAD_TAG=latest` if you want the newest stable GHCR image, or
`RACKPAD_TAG=beta` if you want the newest beta image:

```bash
curl -fsSL https://raw.githubusercontent.com/Kobii-git/Rackpad/main/scripts/install-docker.sh -o /tmp/install-rackpad.sh
RACKPAD_TAG=latest bash /tmp/install-rackpad.sh
```

Open:

```text
http://SERVER_IP:3000
```

Manual no-clone compose install:

```bash
sudo mkdir -p /opt/rackpad
cd /opt/rackpad
sudo curl -fsSLo compose.yml https://raw.githubusercontent.com/Kobii-git/Rackpad/main/docker-compose.release.yml
sudo tee .env >/dev/null <<'EOF'
RACKPAD_IMAGE=ghcr.io/kobii-git/rackpad
RACKPAD_TAG=beta
RACKPAD_PORT=3000
MONITOR_INTERVAL_MS=300000
TRUST_PROXY=0
TRUSTED_HOSTS=
TRUSTED_ORIGINS=
EOF
sudo docker compose pull
sudo docker compose up -d
```

Build locally from a cloned repo only if you want to build from source:

```bash
docker compose up --build -d
```

The compose stack:

- exposes Rackpad on `${RACKPAD_PORT:-3000}`
- stores SQLite data in the named volume `rackpad_data`
- serves the compiled frontend and API from the same container
- runs with a read-only root filesystem except for `/data` and `/tmp`
- uses `/api/health` for the container health check

To stop it:

```bash
docker compose down
```

To stop it and remove the database volume:

```bash
docker compose down -v
```

Full Linux, Proxmox, and Windows install details, plus update steps, backups,
git-clone/source-build options, and reverse-proxy settings live in
[INSTALL.md](./INSTALL.md).

## Linux test deploy

For a simple non-Docker Linux test deploy:

```bash
npm install
npm run build
PORT=3000 HOST=0.0.0.0 DATABASE_PATH=./rackpad.db npm start
```

If `better-sqlite3` needs to compile during `npm install`, install build tools first:

```bash
sudo apt-get update
sudo apt-get install -y python3 make g++
```

## Reverse proxy / TLS

For any public-facing or VPN-exposed deployment, put Rackpad behind a TLS reverse proxy and set the trusted proxy/origin environment values.

Recommended environment shape:

```bash
TRUST_PROXY=1
TRUSTED_HOSTS=rackpad.example.com
TRUSTED_ORIGINS=https://rackpad.example.com
```

Example proxy files are included in:

- [deploy/Caddyfile.example](./deploy/Caddyfile.example)
- [deploy/nginx-rackpad.conf](./deploy/nginx-rackpad.conf)

The app already sets:

- `Content-Security-Policy`
- `Strict-Transport-Security` when the request arrives over HTTPS
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`

So the main deployment job is to terminate TLS, forward the correct `X-Forwarded-*` headers, and keep Rackpad reachable only through the hostname you trust.

## Windows note

On this Windows machine, the app builds and lints cleanly, but the local runtime is still blocked under Node 24 because `better-sqlite3` does not have a matching native binding installed.

The intended local fix is:

- switch to Node 22
- rerun `npm install`

Linux and Docker remain the preferred validation paths.

## Quality checks

These are wired into the repo now:

```bash
npm run build
npm run lint
npm run test:server
```

`npm run test:server` is expected to work on Linux/Node 22 or any environment where `better-sqlite3` can load successfully.

## Project layout

```text
rackpad/
|- docs/screenshots/       GitHub-friendly app screenshots
|- server/                 Fastify API, SQLite schema, seed data, routes, tests
|- src/
|  |- components/          UI and feature components
|  |- lib/                 typed API client, store, types, helpers
|  |- pages/               route-level screens
|- dist/                   built frontend
|- dist-server/            built backend
|- Dockerfile              production container build
|- docker-compose.yml      local container orchestration
```

Full step-by-step setup instructions are in [INSTALL.md](./INSTALL.md).
Version-by-version release notes are in [CHANGELOG.md](./CHANGELOG.md).

## Support the project

Rackpad is free to use. If it helps you and you want to support the work,
there is an optional Ko-fi link here on GitHub: [ko-fi.com/k0bii](https://ko-fi.com/k0bii).
