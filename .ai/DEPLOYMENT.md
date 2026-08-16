# Deployment and operations

## Supported shapes

- `docker-compose.yml` — source-build/default GHCR path, hardened and non-root.
- `docker-compose.release.yml` — downloadable published-image deployment.
- `docker-compose.host-discovery.yml` — explicit privileged discovery mode using
  root, host networking, and network capabilities.

Default Compose uses a read-only root filesystem, `/tmp` tmpfs,
`no-new-privileges`, init, a healthcheck, and the `rackpad_data:/data` volume.
The internal HTTP port is 3000 and the host mapping uses `RACKPAD_PORT`.

The process enables the SNMP trap listener according to `SNMP_TRAP_*`, but normal
Compose deliberately does not publish UDP 1162. Operators must add an explicit
UDP mapping or choose host discovery when external traps are required. Do not
change that safer default without a product decision.

## Environment contract

`.env.example` documents operator-facing variables. All supported runtime values,
including `RACKPAD_SECRET_KEY`, SNMP, OIDC, rate limits, queue limits, and
background intervals, pass through every Compose variant. `npm run check:config`
derives runtime names from server source and fails on example/manifest drift.

Secrets belong in `.env` or an external secret manager, never committed docs or
AI context. Back up `RACKPAD_SECRET_KEY`; changing or losing it invalidates stored
encrypted integration secrets.

## State, upgrade, and rollback

SQLite at `/data/rackpad.db` is the primary durable state. Download a logical
backup and, for important installations, snapshot the volume before upgrade.
Migrations are forward-only: do not attach an older image to a database after a
schema upgrade. Rollback requires the pre-upgrade database/volume snapshot plus
the matching older image. A logical backup from a newer schema is rejected by an
older Rackpad version that does not understand it.

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
