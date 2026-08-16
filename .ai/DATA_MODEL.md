# Data model and persistence

## Persistence model

Rackpad owns one SQLite database through `better-sqlite3`. `server/db.ts` enables
WAL and foreign keys, bootstraps `schemaVersion`, and applies numbered migrations
inside a transaction. Migrations are forward-only; old binaries are not guaranteed
to understand a newer database.

Major domains are:

- labs, rooms, racks, devices, ports, links, and templates;
- VLAN ranges/VLANs, subnets, DHCP scopes, IP zones, assignments, and services;
- users, sessions, OIDC identities, and per-lab grants;
- discovery records/schedules and import sources/links;
- monitors, SNMP credentials/traps, WiFi topology, and alert settings;
- storage drives, slots, pools/membership, documentation, images, and audit rows.

Images and attachment-like data are stored as bounded base64 data URLs in SQLite.
The database is therefore the complete durable state. The logical JSON backup is
portable but deliberately redacts selected integration secrets.

## Invariants

- A non-admin user reads/writes only labs named by `userLabAccess`; admin bypasses
  lab scope. Grants reference both users and labs with cascading deletion.
- IPAM must prevent duplicate/conflicting ownership and keep assignments, DHCP
  scopes, zones, gateways, VLANs, ports, VMs, and containers in the same lab.
- Storage slots and pool membership cannot cross labs or install one drive twice.
- Multi-row mutations and restore operations should be atomic.
- Direct SQL is parameterized. Dynamic identifiers/fragments must be selected
  from code-controlled allowlists.

## Migration rule

Append a new entry to `SCHEMA_MIGRATIONS` and increment
`CURRENT_SCHEMA_VERSION`; never edit an applied entry. Test supported legacy
upgrade paths and failure atomicity. A new table or restorable field also requires
backup/export, restore ordering, integrity, and schema-coverage decisions.

## Backup and restore

`server/routes/admin.ts` exports `rackpad-backup-v1` with app and schema versions.
Every application table must appear under `data` or be on the test’s short,
commented exclusion list. Only `schemaVersion` metadata and ephemeral
`userSessions` are excluded. Sessions are deliberately invalidated on restore.

Restore validates format/integrity, rejects snapshots from a newer schema,
deletes and re-inserts inside one transaction, restores `userLabAccess` only
after users/labs exist, and writes a restore audit row. Older v1 backups without
new optional arrays remain accepted. Portable backups remain sensitive because
they include account password hashes and infrastructure data.
