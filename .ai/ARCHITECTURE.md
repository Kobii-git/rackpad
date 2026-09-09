# Architecture

## Shape

Rackpad is a modular monolith: one Node 22 process serves a Fastify API and the
built React SPA, owns one SQLite database, and runs monitoring, discovery,
Docker synchronization, controller status/auto-sync, native backup schedules,
SNMP sync/traps, and session cleanup in-process. The normal distribution is one
hardened container. There is no ORM, queue, external cache, or separate worker
tier.

## Server map

- `server/index.ts` — process lifecycle, listener, background loops, shutdown.
- `server/app.ts` — Fastify composition, rate/CORS/security/auth gates, routes,
  error mapping, and production SPA hosting.
- `server/routes/*.ts` — HTTP, validation, authorization, transactions, SQL.
- `server/lib/*.ts` — domain rules, auth/OIDC, lab access, egress guard, SNMP,
  monitoring, discovery helpers, imports, crypto, alerts, and integrity logic.
- `server/lib/integrations/` and `server/routes/integrations.ts` — encrypted
  controller connections, previews, inventory apply, and scheduled sync.
- `server/db.ts` — shared `better-sqlite3` handle, bootstrap schema, numbered
  forward migrations, WAL/foreign-key setup, and row parsing.
- `server/tests/` — server/domain/integration tests using temporary databases.

High-blast paths are `server/db.ts`, `server/routes/admin.ts`,
`server/routes/integrations.ts`, `server/app.ts`, `server/lib/lab-access.ts`,
`server/lib/net-guard.ts`, `server/lib/integrations/`,
`server/security-headers.ts`, and `server/index.ts`.

## Repository scripts

`scripts/` contains validation gates, data/demo generators, collectors,
installation helpers, and screenshot tooling. Scripts that handle credentials,
backups, generated data, processes, or release inputs cross the same security and
data boundaries as application code even when they are not shipped at runtime.

## Client map

- `src/main.tsx` and `src/App.tsx` — SPA entry and routing.
- `src/lib/api.ts` — typed API client and Bearer-token transport.
- `src/lib/store.ts` — application state and mutation orchestration.
- `src/pages/` — route-level workspaces, including the visualizer.
- `src/components/` — UI primitives, shared panels, and feature components.
- `src/i18n/` — English source keys and lazy locale dictionaries.
- `e2e/` — Playwright behavior, responsive, CSP, and accessibility checks.

## Lifecycle and data flow

1. `server/db.ts` opens SQLite, enables WAL/FKs, and applies pending migrations.
2. `server/index.ts` creates Fastify and starts background loops.
3. Browser requests pass host/origin and typed route authorization; public and
   admin access is central while lab access is resolved by handlers before SQL.
4. Domain mutations use parameterized SQL and transactions where multi-row
   atomicity matters; audit coverage is mixed server/client and is activity
   history rather than a tamper-evident ledger.
5. Outbound monitor, alert, Docker, and controller HTTP flows pass through the
   DNS-pinned network guard.
6. `/data/rackpad.db` is the normal persistent state; images are stored in SQLite.

## Trust boundaries

- Browser is untrusted. Bearer sessions live in browser localStorage; server
  authorization is authoritative and CSP is the primary XSS compensating control.
- Public API routes are a small typed inventory; changing a route to public is
  restricted.
- Lab-scoped data depends on per-handler guards and `userLabAccess`.
- Network targets and integrations are untrusted; private LAN access is permitted
  by product design but dangerous ranges and redirect rebinding remain blocked.
- Default container is unprivileged. Host-discovery Compose deliberately expands
  trust to root, host networking, and network capabilities.
- SQLite contains topology, accounts, sessions, hashes, encrypted integration
  secrets, audit rows, and embedded images; treat it and all exports as sensitive.
