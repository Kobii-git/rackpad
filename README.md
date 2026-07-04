# Rackpad

[![Release](https://img.shields.io/github/v/tag/Kobii-git/rackpad?sort=semver&label=release&color=2f81f7)](https://github.com/Kobii-git/rackpad/tags)
[![Build](https://img.shields.io/github/actions/workflow/status/Kobii-git/rackpad/docker-publish.yml?branch=main&label=build)](https://github.com/Kobii-git/rackpad/actions/workflows/docker-publish.yml)
[![Container](https://img.shields.io/badge/ghcr.io-rackpad-2496ed?logo=docker&logoColor=white)](https://github.com/Kobii-git/rackpad/pkgs/container/rackpad)
[![License](https://img.shields.io/github/license/Kobii-git/rackpad?color=success)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/Kobii-git/rackpad?style=flat)](https://github.com/Kobii-git/rackpad/stargazers)

Rackpad is a self-hosted infrastructure inventory and operations workspace for homelabs, small racks, network rooms, and lab environments. It brings racks, devices, ports, cables, VLANs, IPAM, WiFi, compute, discovery, monitoring, docs, images, labs, and an admin area into one clean app.

See the [changelog](./CHANGELOG.md) for release history; the badge above tracks the latest tag.

Built with:

- React + Vite frontend
- Fastify API
- SQLite persistence through `better-sqlite3`
- session-based authentication with admin/editor/viewer roles
- per-device health checks with ICMP, TCP, HTTP/HTTPS, and SNMP (v1/v2c/v3) monitor targets; optional trap receiver and VLAN/subnet sync (see [SNMP guide](./docs/SNMP.md))
- Docker support for a single-container deployment

## Highlights

- **Visual topology** — a movable React Flow network map with cable routes, health overlays, and rack/pyramid layouts
- **Racks, devices, ports & cables** — dense rack elevations, switch-panel port maps, and full cable patching
- **IPAM** — subnets, DHCP zones and reservations, gateway/DNS protection, and multi-IP device records (device- and interface-level)
- **Monitoring** — per-device ICMP, TCP, HTTP/HTTPS, and SNMP health checks with email/Discord/Telegram alerting
- **Discovery** — IPAM-subnet, all-subnet, and manual-CIDR scanning with import reconciliation
- **WiFi, compute & docs** — controller/SSID/AP/radio/client inventory, virtualization hosts, and markdown docs with images
- **Light & dark themes**, self-hosted fonts (works offline / air-gapped), and English/French localization
- **Self-hosted** — single Docker container, SQLite persistence, session auth with admin/editor/viewer roles, optional OIDC

See the [changelog](./CHANGELOG.md) for what landed in each release.

## Quick links

If `rackpad.co.za` is unavailable, the repo still contains the core material you need:

- [Installation guide](./INSTALL.md)
- [Proxmox install notes](./docs/PROXMOX.md)
- [Hyper-V import guide](./docs/HYPERV_IMPORT.md)
- [Proxmox import guide](./docs/PROXMOX_IMPORT.md)
- [Networks, VLANs, DHCP, and IPAM guide](./docs/NETWORKS_IPAM.md)
- [Discovery guide](./docs/DISCOVERY.md)
- [Reports guide](./docs/REPORTS.md)
- [Visualizer guide](./docs/VISUALIZER.md)
- [OIDC login guide](./docs/OIDC.md)
- [SNMP monitoring, traps & sync guide](./docs/SNMP.md)
- [Discovery deployment (Proxmox/LXC/host networking)](./docs/DISCOVERY_DEPLOYMENT.md)
- [SNMP implementation plan & outstanding work](./docs/SNMP_IMPLEMENTATION_PLAN.md)
- [Documentation and images guide](./docs/DOCUMENTATION.md)
- [Security policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)
- [MIT license](./LICENSE)
- [Support notes](./SUPPORT.md)

## Preview

Rackpad ships **light and dark themes**. Full-resolution 1920x1200 captures live in [`docs/screenshots`](./docs/screenshots) and are shown full-width here so GitHub keeps them sharp.

### Operations dashboard

<img src="./docs/screenshots/dashboard-dark.png" alt="Rackpad operations dashboard" width="100%">

### Diagram visualizer

<img src="./docs/screenshots/visualizer-dark.png" alt="Rackpad React Flow diagram visualizer" width="100%">

### IPAM, DHCP zones, and reservations

<img src="./docs/screenshots/ipam.png" alt="Rackpad IPAM workspace with zones, scopes, and address utilization" width="100%">

### WiFi inventory

<img src="./docs/screenshots/wifi.png" alt="Rackpad WiFi controller, SSID, AP, radio, and client inventory" width="100%">

<details>
<summary>More workspace screenshots</summary>

### Operations dashboard (light theme)

<img src="./docs/screenshots/dashboard.png" alt="Rackpad operations dashboard in light theme" width="100%">

### Diagram visualizer (light theme)

<img src="./docs/screenshots/visualizer.png" alt="Rackpad React Flow diagram visualizer in light theme" width="100%">

### Racks and rooms

<img src="./docs/screenshots/racks.png" alt="Rackpad racks and rooms workspace" width="100%">

### Devices

<img src="./docs/screenshots/devices.png" alt="Rackpad device inventory" width="100%">

### Ports

<img src="./docs/screenshots/ports.png" alt="Rackpad ports workspace" width="100%">

### Cables

<img src="./docs/screenshots/cables.png" alt="Rackpad cables workspace" width="100%">

### Visualizer rack layout

<img src="./docs/screenshots/visualizer-cables.png" alt="Rackpad grouped visualizer layout" width="100%">

### Visualizer health overlay

<img src="./docs/screenshots/visualizer-health.png" alt="Rackpad visualizer health overlay" width="100%">

### Visualizer pyramid view

<img src="./docs/screenshots/visualizer-trace.png" alt="Rackpad pyramid visualizer view" width="100%">

### Loose device layout

<img src="./docs/screenshots/visualizer-layout.png" alt="Rackpad visualizer loose device layout" width="100%">

### Monitoring

<img src="./docs/screenshots/monitoring.png" alt="Rackpad monitoring workspace" width="100%">

### Compute

<img src="./docs/screenshots/compute.png" alt="Rackpad compute workspace" width="100%">

### Discovery

<img src="./docs/screenshots/discovery.png" alt="Rackpad discovery workspace" width="100%">

### Documentation

<img src="./docs/screenshots/documentation.png" alt="Rackpad documentation workspace" width="100%">

</details>

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
- IPAM for subnets, DHCP scopes, DHCP reservations, IP zones, and linked assignments
- Documentation for Markdown notes, runbooks, and inline pictures
- Imports for review-first Hyper-V and Proxmox host, VM, and container onboarding
- Reports for printable/PDF, Excel-compatible, and CSV exports
- Visualizer for rack, pyramid, diagram, loose-room, port, WiFi, and cable relationship maps

## What works

- Rack inventory and physical placement
- Add, edit, and delete racks
- Add, edit, and delete devices
- Custom device types for inventory, discovery, icons, filters, and port templates
- MAC address fields, search, sort, import, and display beside IP context
- Device placement modes for rack, room, wireless, and virtual inventory
- Parent-child device relationships for hosted VMs and AP-linked wireless clients
- Host-shared networking for VMs and containers that intentionally reuse a parent host IP
- Multiple IP assignments per device, with device-level and port/interface-level context
- Compute workspace for virtualization hosts and VMs
- Capacity tracking for hosts and VMs with CPU, memory, storage, and specs fields
- Port templates for new devices
- Manual port create, edit, and delete
- WiFi port kind across device types, templates, selectors, labels, visualizer views, and reports
- Create, edit, and delete cables
- VLAN allocation and VLAN deletion
- VLAN range create, edit, and delete
- IPAM subnet, DHCP scope, DHCP reservation, and IP zone CRUD
- Gateway, DNS, reserved, infrastructure, and technical IP protection during allocation, discovery, and reconcile
- Controller-aware WiFi workspace for controllers, SSIDs, AP radios, and wireless clients
- Wireless client telemetry with AP, SSID, band, channel, signal, last-seen, and roam context
- WiFi client grouping by AP/SSID in visualizer views when association or VLAN/IPAM context is available
- Discovery inbox with subnet scan, duplicate awareness, review, and import into inventory
- Discovery enrichment with MAC/vendor capture, technical IP preservation, natural IP sorting, and direct linking to existing inventory
- Management IP synchronization between device records and IPAM
- Next-free IP allocation and IP release
- DHCP reservation allocation from IP zones instead of treating the whole DHCP scope as assignable
- Direct links between devices, ports, IPAM assignments, racks, rooms, dashboard cards, reports, and visualizer inspector entries
- Bulk device status edits and bulk delete with dependency cleanup
- Audit log writes for the main workflows
- User bootstrap, login, logout, and user management
- Optional OIDC login with PKCE, role mapping, and Authentik-style issuer/debug guidance
- Admin-only JSON backup export from the users screen
- Backup exports preserve password hashes, documentation pages, device images, MACs, and parent-linked devices for restore, but redact stored alert-delivery secrets before download
- Device health-check configuration, alert destinations, repeat-alert controls, and on-demand monitor runs
- Multiple monitor targets per device so servers, firewalls, and multi-NIC systems can track separate management, service, storage, or VIP endpoints
- Bulk ICMP, TCP, HTTP, and HTTPS monitor creation from selected devices
- Device service inventory for DHCP, DNS, VPN, NTP, SNMP, Syslog, HTTP/S, databases, apps, and custom services
- SMTP/email alert delivery beside Discord and Telegram, plus recent alert activity in the admin area
- Reports workspace with printable/PDF-friendly inventory summaries plus Excel-compatible and CSV exports
- Visualizer workspace for grouped rack layout, pyramid view, and React Flow diagram mapping, with Health mode, Trace mode, multi-select filters, loose-device layout toggles, room-only rack-zone toggles, and saved diagram positions
- Rack shelves with proportional child-device footprints for multi-device and multi-U shelf documentation
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
- [Networks/IPAM](./docs/NETWORKS_IPAM.md): create tagged or untagged networks, document DHCP scopes, zones, reservations, and VLAN planning ranges.
- [Discovery](./docs/DISCOVERY.md): run manual or scheduled scans, keep results review-first, and understand Docker/LXC visibility limits.
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
- create version tags like `v1.5.2` from `main`

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
RACKPAD_SECRET_KEY=
SNMP_TRAP_ENABLED=1
SNMP_TRAP_PORT=1162
SNMP_TRAP_BIND=0.0.0.0
SNMP_INVENTORY_SYNC=1
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

If a local admin password is lost in a Docker install, use the container CLI
recovery command documented in [INSTALL.md](./INSTALL.md#admin-password-recovery).
OIDC users must reset passwords in the identity provider.

## Install With Docker

Recommended no-clone install from the published GHCR image:

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates
curl -fsSL https://raw.githubusercontent.com/Kobii-git/Rackpad/main/scripts/install-docker.sh | bash
```

Use `RACKPAD_TAG=latest` if you want the newest stable GHCR image,
`RACKPAD_TAG=1.5.10` if you want a specific release, or `RACKPAD_TAG=beta` if
you want the newest testing image:

```bash
curl -fsSL https://raw.githubusercontent.com/Kobii-git/Rackpad/main/scripts/install-docker.sh -o /tmp/install-rackpad.sh
RACKPAD_TAG=1.5.10 bash /tmp/install-rackpad.sh
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
RACKPAD_TAG=1.5.10
RACKPAD_PORT=3000
MONITOR_INTERVAL_MS=300000
TRUST_PROXY=0
TRUSTED_HOSTS=
TRUSTED_ORIGINS=
EOF
sudo docker compose pull
sudo docker compose up -d
```

If Rackpad runs in Docker on Linux or inside a Proxmox LXC and **Discovery**
cannot see the local subnet, use the host-network discovery compose variant:

```bash
sudo curl -fsSLo compose.host-discovery.yml https://raw.githubusercontent.com/Kobii-git/Rackpad/main/docker-compose.host-discovery.yml
sudo docker compose -f compose.host-discovery.yml pull
sudo docker compose -f compose.host-discovery.yml up -d
```

That variant runs with host networking plus the raw-network capabilities needed
by ICMP/ARP-style scans. See [Docker network discovery](./docs/DOCKER_DISCOVERY.md)
for the security trade-offs and manual compose snippet.

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

## Special thanks

A special thank you to [@M4v3r1cK87](https://github.com/M4v3r1cK87)
and [@dhop90](https://github.com/dhop90).

Rackpad has benefited hugely from their time, testing, feedback, screenshots,
bug reports, and ideas. Their involvement has helped shape the project in a
very real way, and I am genuinely grateful for the care they have put into
helping improve it.

Thank you both for being such an important part of Rackpad's journey.

## Support the project

Rackpad is free to use. If it helps you and you want to support the work,
there is an optional Ko-fi link here on GitHub: [ko-fi.com/k0bii](https://ko-fi.com/k0bii).
PayPal.me is also available here: [paypal.me/St3wi](https://paypal.me/St3wi).
