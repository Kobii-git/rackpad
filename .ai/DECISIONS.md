# Decisions

Sparse ADR-lite records for choices likely to be re-litigated.

## D1 — Modular monolith and direct SQL

- Context: Rackpad is a self-hosted single-instance operational tool.
- Decision: keep React/Fastify/SQLite in one process/container; use
  `better-sqlite3`, explicit migrations, and parameterized SQL without an ORM.
- Consequences: simple deployment and transparent data behavior; route modules and
  the shared process can have large blast radius.
- Reconsider when: scale, ownership, test isolation, or recurring change conflict
  proves the boundary inadequate.

## D2 — Bearer session transport

- Context: the SPA and API are normally same-origin and use no auth cookies.
- Decision: random Bearer token in localStorage; store only its hash server-side;
  maintain strict CSP as a compensating control.
- Consequences: no cookie CSRF surface; XSS can expose the token.
- Reconsider when: internet exposure, third-party scripts, session UX, or threat
  modeling justifies a cookie/CSRF migration.

## D3 — Private-network egress policy

- Context: Rackpad’s purpose is monitoring and inventory of LAN devices.
- Decision: allow private/unique-local unicast through the reviewed pinned request
  layer while blocking local/metadata/reserved destinations.
- Consequences: useful LAN reach with a deliberate SSRF trust expansion.
- Reconsider when: tenant model or deployment boundary changes.

## D4 — Logical backup format and completeness

- Context: users need portable state including accounts and embedded images.
- Decision: retain `rackpad-backup-v1`, include schema version and every application
  table except schema metadata/sessions, and enforce schema-driven coverage.
- Consequences: self-contained sensitive backups; restore ordering stays explicit;
  sessions are invalidated and newer schemas are rejected.
- Reconsider when: format evolution, streaming size, encryption, or external media
  storage requires a versioned successor.

## D5 — Privileged discovery mode

- Context: full subnet/MAC discovery may require host network and raw capabilities.
- Decision: keep privilege in a separate opt-in Compose artefact; default remains
  non-root and unprivileged.
- Consequences: capable discovery for trusted operators without normalizing risk.
- Reconsider when: a separate discovery agent can provide least privilege.

## D6 — Release channels

- Context: Docker users need active, beta, and stable update tracks.
- Decision: use `dev → beta → main` with `-dev.N`, `-beta.N`, stable versions,
  branch/tag image channels, and beta smoke testing before main.
- Consequences: clear consumer choice; version/changelog/tag promotion is partly
  manual and can drift.
- Reconsider when: release automation is approved and proven against current flow.
