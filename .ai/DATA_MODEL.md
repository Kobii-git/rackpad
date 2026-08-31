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
- controller integration connections, encrypted credentials, scopes, and sync
  schedules;
- monitors, SNMP credentials/traps, WiFi topology, and alert settings;
- storage drives, slots, pools/membership, documentation, images, and audit rows;
- immutable hardware-template definitions, per-device physical-layout snapshots,
  stable port bindings, and extended rack geometry.

Images and attachment-like data are stored as bounded base64 data URLs in SQLite.
The database is therefore the complete durable state. The logical JSON backup is
portable. Alert-delivery secrets are redacted, while controller integration
credentials are preserved only as encrypted ciphertext so connections survive
restore when the same `RACKPAD_SECRET_KEY` is retained.

## Invariants

- A non-admin user reads/writes only labs named by `userLabAccess`; admin bypasses
  lab scope. Grants reference both users and labs with cascading deletion.
- IPAM must prevent duplicate/conflicting ownership and keep assignments, DHCP
  scopes, zones, gateways, VLANs, ports, VMs, and containers in the same lab.
- Storage slots and pool membership cannot cross labs or install one drive twice.
- Devices, ports, and `portLinks` remain canonical inventory. A physical layout
  binds existing stable port IDs to snapshot-owned slot IDs; applying a template
  cannot silently replace, reorder, disconnect, or delete canonical ports.
- Built-in hardware templates are code-owned and immutable. Custom templates are
  global administrator data, while device snapshots remain valid if their source
  template is later changed or deleted.
- Multi-row mutations and restore operations should be atomic.
- Direct SQL is parameterized. Dynamic identifiers/fragments must be selected
  from code-controlled allowlists.

## Migration rule

Append a new entry to `SCHEMA_MIGRATIONS` in `server/db.ts` and increment
`CURRENT_SCHEMA_VERSION` in `server/schema-version.ts`; never edit an applied
entry. Test supported legacy upgrade paths and failure atomicity. A new table or
restorable field also requires backup/export, restore ordering, integrity, and
schema-coverage decisions.

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

Integration connections and schedules are restorable application data.
Credential ciphertext is preserved without decrypting or exposing it; restore
compatibility depends on retaining the same `RACKPAD_SECRET_KEY`.

Hardware templates, device-type defaults, device physical-layout snapshots,
extended device geometry, and nullable shared room-canvas rack coordinates
participate in logical and native backup coverage. Restoring an older logical
backup without this data generates deterministic `legacy-auto-v1` snapshots and
automatic rack positions without changing restored port or link identities.

Rack Studio placement writes use a single lab-authorized action endpoint. Each
action supplies its expected canonical before-state; stale browser-session undo,
redo, and placement attempts are rejected instead of overwriting newer changes.

`portLinks` stores optional inspection metadata (`label`, `visible`) plus a
bounded JSON list of uniquely identified room/face canvas waypoints. Existing
rows migrate to visible with no manual points. Restore rejects duplicate or
occupied cable endpoints and waypoint rooms outside either endpoint lab.
Physical Patch mode still writes the canonical link row;
the metadata does not create a second cabling model. Link create, edit, bulk
edit, and delete authorize both endpoint labs, update endpoint state, and write
their audit entry in the same transaction. Logical backups parse waypoint JSON
and older backups default missing metadata safely.
