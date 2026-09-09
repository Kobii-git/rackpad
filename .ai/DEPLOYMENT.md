# Deployment and operations

## Supported shapes

- `docker-compose.yml` — source-build/default GHCR path, hardened and non-root.
- `docker-compose.release.yml` — downloadable published-image deployment.
- `docker-compose.host-discovery.yml` — explicit privileged discovery mode using
  root, host networking, and network capabilities.

The version-aligned first-party native Proxmox LXC assets live under
`deploy/proxmox/`. Their target is Proxmox VE 9.x `amd64`, Debian 13 by default,
and Ubuntu 24.04 LTS as an alternative. They remain pre-release until the beta
and stable roadmap gates pass; Docker is still the supported general path.

Default Compose uses a read-only root filesystem, `/tmp` tmpfs,
`no-new-privileges`, init, a healthcheck, and the `rackpad_data:/data` volume.
The internal HTTP port is 3000 and the host mapping uses `RACKPAD_PORT`.

The process enables the SNMP trap listener only when explicitly configured through
`SNMP_TRAP_ENABLED=1` (the default is off), but normal
Compose deliberately does not publish UDP 1162. Operators must add an explicit
UDP mapping or choose host discovery when external traps are required. Do not
change that safer default without a product decision.

## Environment contract

`.env.example` documents operator-facing variables. All supported runtime values,
including `RACKPAD_SECRET_KEY`, SNMP, OIDC, rate limits, queue limits, and
background intervals, pass through every Compose variant. `npm run check:config`
derives runtime names from server source and fails on example/manifest drift.
It also runs the installer against isolated download/daemon stubs with real
Compose rendering. The installer preserves operator configuration and keys,
recognizes generated manifests, and proposes custom-manifest updates for review.

`TRUST_PROXY` is disabled at `0` and otherwise names explicit controlled proxy
IPs/CIDRs. Legacy hop counts, truthy aliases, and invalid values disable trust with
a warning. Replace old settings before upgrade. The public edge must overwrite
forwarding headers, and direct access to the app port should remain restricted.

Secrets belong in `.env` or an external secret manager, never committed docs or
AI context. Back up `RACKPAD_SECRET_KEY`; changing or losing it invalidates stored
encrypted integration secrets.

## State, upgrade, and rollback

SQLite at `/data/rackpad.db` is the primary durable state. Download a logical
backup and, for important installations, snapshot the volume before upgrade.
Schema 50 needs `RACKPAD_SECRET_KEY` to encrypt existing inline SNMP communities;
a missing key aborts without committing the migration. It revokes OIDC sessions,
requires a one-time OIDC role check, and clears historical trap-source credential
links. Configure a trusted OIDC admin mapping and retain existing encryption keys
before upgrade; reconfigure source-level trap credentials afterward.
After upgrade, verify administrator access, lab isolation, monitoring, and any
explicitly enabled traps. Rotate communities previously exposed through API
responses or backups on both Rackpad and the affected devices.
Migrations are forward-only: do not attach an older image to a database after a
schema upgrade. Rollback requires the pre-upgrade database/volume snapshot plus
the matching older image. A logical backup from a newer schema is rejected by an
older Rackpad version that does not understand it.

Native LXC uses immutable `/opt/rackpad_releases/<tag>` directories, the atomic
`/opt/rackpad` symlink, `/opt/rackpad_data` for the database/backups/recovery
points, and `/etc/rackpad/rackpad.env` for configuration. `/usr/bin/update` is a
manual stable-only transaction: build before downtime, snapshot and validate
SQLite, back up code/config/systemd/origins, activate and wait up to 60 seconds
for valid health, complete endpoint verification, then restore the paired state
on failure. The current release plus three paired rollback points are retained.

Native activation waits up to 60 seconds for systemd and HTTP health readiness,
retrying at one-second intervals. HTTP requests are capped at 15 seconds and
connects at 5 seconds, both bounded by positive remaining time. Systemd queries
share that deadline and are killed when it expires. Health must parse as JSON
with top-level boolean `ok: true`. Terminal service failure aborts early. Install,
update, rollback, and snapshot-failure recovery share this verifier. Authentication,
SPA, and collector checks still run after health succeeds.

Native discovery defaults to neighbor-only safe mode and empty service
capabilities. Root-only `rackpad-discovery-mode advanced` must prove the outer
LXC and raw socket allow `CAP_NET_RAW` and `CAP_NET_ADMIN` before applying them;
it never changes outer Proxmox privilege. SNMP traps remain independent and off
by default.

## Release channels

- `dev` publishes active development builds and uses distinct `-dev.N` versions.
- `beta` publishes prerelease testing builds using `-beta.N`.
- `main` and stable tags publish stable/latest images after beta smoke testing.

Release preparation includes version and lockfile, changelog Added/Fixed/Changed
sections as applicable, full validation, test notes, tag/channel review, and smoke
testing. Push/tag/publish/deploy always requires explicit user authority.

## Known limits

One process and one SQLite volume imply single-instance operation. The public
health endpoint is primarily liveness and currently includes trap receiver detail.
No automatic volume backup, downgrade migration, readiness split, or metrics/APM
is provided.
