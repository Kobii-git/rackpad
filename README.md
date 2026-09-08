# Rackpad

[![Latest tag](https://img.shields.io/github/v/tag/Kobii-git/rackpad?sort=semver&label=latest%20tag&color=2f81f7)](https://github.com/Kobii-git/rackpad/tags)
[![Build](https://img.shields.io/github/actions/workflow/status/Kobii-git/rackpad/docker-publish.yml?branch=main&label=build)](https://github.com/Kobii-git/rackpad/actions/workflows/docker-publish.yml)
[![Container](https://img.shields.io/badge/ghcr.io-rackpad-2496ed?logo=docker&logoColor=white)](https://github.com/Kobii-git/rackpad/pkgs/container/rackpad)
[![License](https://img.shields.io/github/license/Kobii-git/rackpad?color=success)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/Kobii-git/rackpad?style=flat)](https://github.com/Kobii-git/rackpad/stargazers)
[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/g25tEafYDX)

> [!IMPORTANT]
> **Help shape Rackpad’s next phase**
>
> We have published a proposed automation roadmap covering the public API,
> optional agents, deeper infrastructure integrations, network and IPAM
> automation, major provider support, and carefully controlled infrastructure
> management.
>
> These are proposed directions rather than shipped features or fixed delivery
> dates. We would like community feedback before implementation begins.
>
> **[Read the roadmap and share your feedback →](https://github.com/Kobii-git/rackpad/discussions/132)**
>
> [View the detailed engineering roadmap](./docs/AUTOMATION_ROADMAP.md)

Rackpad is a self-hosted infrastructure inventory and operations workspace for
homelabs, small racks, network rooms, and lab environments. It brings racks,
devices, ports, cables, Networks/IPAM, storage, Wi-Fi, compute, discovery,
monitoring, documentation, images, integrations, reports, labs, and
administration into one clean app.

Stable: **v1.8.0**.
This branch prepares **v1.8.3-beta.1** for experimental testing.
Use [GitHub Releases](https://github.com/Kobii-git/rackpad/releases) to confirm published artifacts.
See the [combined candidate notes and acceptance checklist](docs/releases/v1.8.3-beta.1.md).
See the [changelog](./CHANGELOG.md); the latest-tag badge may show a prerelease.

Built with:

- React + Vite frontend
- Fastify API
- SQLite persistence through `better-sqlite3`
- session-based authentication with admin/editor/viewer roles
- per-device health checks with ICMP, TCP, HTTP/HTTPS, and SNMP (v1/v2c/v3) monitor targets; optional trap receiver and VLAN/subnet sync (see [SNMP guide](./docs/SNMP.md))
- Docker support for a single-container deployment; first-party native Proxmox
  LXC support is in staged validation

> **Development:** [Stacked switches](docs/STACKED_SWITCHES.md) add ordered members, labelled MACs, and member port assignments in the combined schema-51 candidate.

## Highlights

- **Visual topology** — a movable React Flow network map with cable routes, health overlays, and rack/pyramid layouts
- **Racks, devices, ports & cables** — dense rack elevations, switch-panel port maps, and full cable patching
- **Networks and IPAM** — VLANs, subnets, DHCP zones and reservations, gateway/DNS protection, and multi-IP device records
- **Storage topology** — drive inventory, physical bays and enclosures, cross-device pools, missing members, and reusable templates
- **Monitoring** — per-device ICMP, TCP, HTTP/HTTPS, and SNMP health checks with email/Discord/Telegram alerting
- **Discovery** — IPAM-subnet, all-subnet, and manual-CIDR scanning with import reconciliation
- **Wi-Fi, compute & docs** — controller/SSID/AP/radio/client inventory, virtualization hosts, and markdown docs with images
- **Light & dark themes**, self-hosted fonts (works offline / air-gapped), and multilingual support across 24 interface languages
- **Self-hosted** — single Docker container, SQLite persistence, session auth with admin/editor/viewer roles, optional OIDC

See the [changelog](./CHANGELOG.md) for what landed in each release.

## Quick links

Rackpad's public website is [rackpad.net](https://rackpad.net). The repo also
contains the core material you need:

- [Installation guide](./INSTALL.md)
- [Proxmox install notes](./docs/PROXMOX.md)
- [Proxmox native LXC operations (pre-release)](./docs/PROXMOX_NATIVE_LXC.md)
- [Hyper-V import guide](./docs/HYPERV_IMPORT.md)
- [Proxmox import guide](./docs/PROXMOX_IMPORT.md)
- [Networks, VLANs, DHCP, and IPAM guide](./docs/NETWORKS_IPAM.md)
- [Controller integrations guide (Proxmox/UniFi/Omada/OPNsense/Dockhand)](./docs/INTEGRATIONS.md)
- [Discovery guide](./docs/DISCOVERY.md)
- [Reports guide](./docs/REPORTS.md)
- [Storage topology guide](./docs/STORAGE.md)
- [Visualizer guide](./docs/VISUALIZER.md)
- [OIDC login guide](./docs/OIDC.md)
- [SNMP monitoring, traps & sync guide](./docs/SNMP.md)
- [Discovery deployment (Proxmox/LXC/host networking)](./docs/DISCOVERY_DEPLOYMENT.md)
- [Documentation and images guide](./docs/DOCUMENTATION.md)
- [Automation roadmap (proposed)](./docs/AUTOMATION_ROADMAP.md)
- [Proxmox native LXC roadmap (proposed)](./docs/PROXMOX_LXC_ROADMAP.md)
- [Security policy](./SECURITY.md)
- [Community Discord](https://discord.gg/g25tEafYDX)
- [Changelog](./CHANGELOG.md)
- [MIT license](./LICENSE)
- [Support notes](./SUPPORT.md)

## Preview

Rackpad ships **light and dark themes**. This preview is generated from a safe, opt-in demo database at 1920x1200; the lossless source captures live in [`docs/screenshots`](./docs/screenshots).

### Dashboard — inventory, health, and activity

<img src="./docs/screenshots/dashboard-dark.png" alt="Rackpad dark operations dashboard showing inventory totals, health status, capacity, and recent activity" width="100%">

### Storage — drives, bays, and pool health

<img src="./docs/screenshots/storage-dark.png" alt="Rackpad dark Storage pool editor showing degraded cross-device membership, capacity, and a pulled drive" width="100%">

### Visualizer — physical and logical topology

<img src="./docs/screenshots/visualizer-dark.png" alt="Rackpad dark Visualizer diagram connecting racks, devices, workloads, WiFi, and documented cables" width="100%">

### Networks — VLANs, subnets, DHCP, and IPAM

<img src="./docs/screenshots/networks.png" alt="Rackpad Networks workspace consolidating VLAN, subnet, gateway, DNS, DHCP scope, zone, and assignment context" width="100%">

### Integrations — controllers and UTC schedules

<img src="./docs/screenshots/integrations.png" alt="Rackpad Integrations workspace showing provider tiles, a disabled UniFi example, sync scope, and an expanded UTC schedule" width="100%">

### WiFi — controllers, SSIDs, radios, and clients

<img src="./docs/screenshots/wifi.png" alt="Rackpad WiFi workspace showing controllers, SSIDs, access points, radios, associated clients, and signal context" width="100%">

<details>
<summary>Inventory and physical infrastructure workspaces</summary>

### Labs and locations

<img src="./docs/screenshots/labs.png" alt="Rackpad Labs workspace showing the Home Lab and Studio inventory boundaries" width="100%">

### Racks, rooms, and half-width placement

<img src="./docs/screenshots/racks.png" alt="Rackpad Racks workspace showing room-grouped rack elevations, mounted equipment, and paired half-width appliances" width="100%">

### Device inventory

<img src="./docs/screenshots/devices.png" alt="Rackpad Devices workspace with searchable physical, wireless, virtual, unmanaged, and custom-type inventory" width="100%">

### Compute hosts and workloads

<img src="./docs/screenshots/compute.png" alt="Rackpad Compute workspace summarizing inherited hypervisor appliances, virtual machines, containers, and capacity" width="100%">

### Storage drive inventory in light theme

<img src="./docs/screenshots/storage.png" alt="Rackpad light Storage drive inventory showing installed, unassigned, and pulled media across devices" width="100%">

### Aggregate ports and member links

<img src="./docs/screenshots/ports.png" alt="Rackpad Ports workspace with the pve-01 aggregate-port inspector and physical member relationships" width="100%">

### Cable inventory and bulk editing

<img src="./docs/screenshots/cables.png" alt="Rackpad Cables workspace with two links selected in the bulk metadata editor" width="100%">

</details>

<details>
<summary>Operations, review, and administration workspaces</summary>

### Operations dashboard (light theme)

<img src="./docs/screenshots/dashboard.png" alt="Rackpad light operations dashboard showing inventory, health, capacity, and recent activity" width="100%">

### Discovery inbox and scheduled scans

<img src="./docs/screenshots/discovery.png" alt="Rackpad Discovery workspace with staged network findings, reconciliation context, and a disabled sample scan schedule" width="100%">

### Review-first Proxmox import

<img src="./docs/screenshots/imports.png" alt="Rackpad Imports workspace staging a sample Proxmox host, bridges, virtual machines, containers, MACs, and IPs for review" width="100%">

### Monitoring targets

<img src="./docs/screenshots/monitoring.png" alt="Rackpad Monitoring workspace summarizing disabled ICMP, TCP, HTTP, HTTPS, and SNMP demo targets" width="100%">

### Reports and exports

<img src="./docs/screenshots/reports.png" alt="Rackpad Reports workspace with printable, spreadsheet-compatible, and CSV inventory exports" width="100%">

### Audit history

<img src="./docs/screenshots/audit-log.png" alt="Rackpad Audit Log showing storage, device-type, integration, network-review, and inventory history" width="100%">

### Administration

<img src="./docs/screenshots/admin.png" alt="Rackpad Administration workspace for users, settings, integrity review, snapshots, and operational controls" width="100%">

</details>

<details>
<summary>Documentation, customization, and alternate topology workspace views</summary>

### Diagram visualizer (light theme)

<img src="./docs/screenshots/visualizer.png" alt="Rackpad light Visualizer diagram showing physical and logical inventory relationships" width="100%">

### Documentation and linked runbooks

<img src="./docs/screenshots/documentation.png" alt="Rackpad Documentation workspace with Markdown runbooks, inline reference images, and linked devices" width="100%">

### Managed custom device types

<img src="./docs/screenshots/device-types.png" alt="Rackpad Device Types workspace with Disk shelf selected, storage-enclosure inheritance, and live usage counts" width="100%">

</details>

HTTP/HTTPS checks may target public hosts, RFC1918 LAN addresses, and IPv6 ULA
addresses. Rackpad pins each DNS resolution and blocks loopback, link-local,
metadata-service, multicast, and reserved destinations, including redirects.

## What you can see before install

From the GitHub repo alone, you can already preview the major Rackpad workspaces:

- Dashboard for inventory, health, capacity, and recent activity
- Storage for drives, bays, custom enclosure layouts, cross-device pools, and missing-member review
- Racks for physical placement, mounted gear, and room-tech context
- Devices for searchable inventory and placement-aware records
- Device Types for managed custom types, built-in inheritance, and usage counts
- Ports for switch, host, AP, VM, and patch-panel connectivity
- Compute for hosts, VMs, and virtual switch / bridge membership
- WiFi for controllers, SSIDs, radios, clients, and signal context
- Discovery for staged imports, MAC/vendor hints, and duplicate detection
- Monitoring for multi-target ICMP, TCP, HTTP, and HTTPS checks
- Networks for consolidated VLANs, subnets, DHCP scopes, reservations, IP zones, assignments, and mismatch review
- Documentation for Markdown notes, runbooks, and inline pictures
- Imports for review-first Hyper-V and Proxmox host, VM, and container onboarding
- Integrations for Proxmox, UniFi, Omada, OPNsense, and Dockhand previews plus opt-in UTC schedules
- Reports for printable/PDF, Excel-compatible, and CSV exports
- Audit Log for accountable inventory, storage, integration, and review history
- Administration for users, settings, integrity checks, JSON export, and native SQLite snapshots
- Visualizer for rack, pyramid, diagram, loose-room, port, WiFi, and cable relationship maps

## Feature guides

Use these when you want the workflow steps rather than just the overview:

- [Hyper-V import](./docs/HYPERV_IMPORT.md): download the collector, collect inventory on a Hyper-V host, map or create the host record, review VMs, and import selected categories.
- [Proxmox import](./docs/PROXMOX_IMPORT.md): download the collector, collect inventory on a Proxmox node, map or create the node record, review QEMU VMs and LXC containers, and import selected categories.
- [Reports](./docs/REPORTS.md): generate a clean inventory report, print/save to PDF, and export CSV or Excel-compatible files.
- [Storage topology](./docs/STORAGE.md): document physical drive bays, lab-wide drive inventory, cross-device pools, and missing members.
- [Networks/IPAM](./docs/NETWORKS_IPAM.md): create tagged or untagged networks, document DHCP scopes, zones, reservations, and VLAN planning ranges.
- [Controller integrations](./docs/INTEGRATIONS.md): connect Proxmox VE, UniFi, Omada, OPNsense, and Dockhand APIs, store credentials encrypted, pull live inventory, and apply reviewed VLAN/subnet changes.
- [Discovery](./docs/DISCOVERY.md): run manual or scheduled scans, keep results review-first, and understand Docker/LXC visibility limits.
- [Visualizer](./docs/VISUALIZER.md): inspect rack, loose-room, port, and cable relationships from existing Rackpad data.
- [OIDC login](./docs/OIDC.md): configure Authentik or another IdP, map roles, and debug issuer/discovery URL problems.
- [Documentation and images](./docs/DOCUMENTATION.md): create Markdown runbooks, insert pictures, attach device reference images, and include them in backups.

## Versioning

Rackpad uses semantic versioning and Git tags in the form `vX.Y.Z`.

- The app version lives in [package.json](./package.json).
- Release notes live in [CHANGELOG.md](./CHANGELOG.md).
- The proposed long-term automation direction lives in
  [docs/AUTOMATION_ROADMAP.md](./docs/AUTOMATION_ROADMAP.md).
- The completed pre-1.0 rollout plan remains in
  [V1_CHECKLIST.md](./V1_CHECKLIST.md) as a historical record.
- Install and deploy examples should pin a version instead of assuming `main`.

Every shipped change should update the version and add a matching changelog entry describing what changed.

## Release channels

Rackpad uses three ordered release branches:

- `main`: stable release branch intended for production and tagged releases
- `beta`: pre-release testing branch for changes that should be validated before they land on `main`
- `dev`: integration branch for work that is not yet ready for beta testing

Recommended workflow:

- integrate new work into `dev`
- promote validated development changes from `dev` to `beta`
- promote validated beta changes from `beta` to `main`
- create version tags like `vX.Y.Z` from `main`

The promotion order is `dev` → `beta` → `main`.

Branch image tags such as `dev`, `beta`, and `latest` move as their branches are
published. Immutable semantic-version image tags such as `1.8.0` are created
only from an explicitly approved Git release tag.

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

The authoritative environment-variable contract and defaults are documented in
[`.env.example`](./.env.example). CI checks that every supported runtime variable
is represented there and passed through all intended Compose manifests. See
[INSTALL.md](./INSTALL.md) for deployment, secret, OIDC, discovery, and
reverse-proxy configuration.

For provider setup, use the [OIDC guide](./docs/OIDC.md). For layer-2 visibility,
permissions, and optional host discovery, use the [discovery deployment guide](./docs/DISCOVERY_DEPLOYMENT.md).

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

Use the [installation guide](./INSTALL.md) for the canonical Linux, Windows,
Proxmox, source-build, backup, update, and recovery procedures. Stable installations
can pin `RACKPAD_TAG=1.8.0`; `latest` follows stable and `beta` follows testing.
The normal deployment uses one hardened container and a persistent SQLite volume.

## Linux test deploy

See [native Node deployment](./INSTALL.md#native-node-deploy) for source-build
requirements and the generic service example. Docker remains the recommended path.

## Reverse proxy / TLS

Follow the [version-specific proxy instructions](./INSTALL.md#reverse-proxy-and-tls).
Stable 1.8.0 uses controlled hop counts; 1.8.2 beta.4 and later require explicit
proxy IPs/CIDRs. Terminate TLS at the proxy and restrict direct application access.
Before upgrading, read the [1.8.3 upgrade precautions](./INSTALL.md#before-upgrading-to-183-beta)
for encryption-key retention, OIDC re-login, trap opt-in, and paired rollback.

## Native development note

Native development on Windows, Linux, and macOS requires Node 22. Docker
remains the recommended deployment method.

## Quality checks

Run the standard non-browser completion gate:

```bash
npm run check
```

`npm run check:full` adds Playwright browser and accessibility tests and is the
full CI/release application gate. The canonical validation ladder is in
[`.ai/COMMANDS.md`](./.ai/COMMANDS.md); `package.json` owns the command bodies.

Server tests require Node 22 on a platform where `better-sqlite3` can load.

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
