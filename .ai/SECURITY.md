# Agent-facing security invariants

The root `SECURITY.md` is the public policy. This file describes engineering
constraints for changes.

## Authentication and sessions

- Local users use scrypt password hashes. OIDC uses authorization code, state,
  nonce, and PKCE S256.
- OIDC domain/email role decisions require boolean `email_verified: true`;
  subjects are case-sensitive. A short-lived HttpOnly SameSite=Lax browser verifier
  binds callback and completion. It is Secure for trusted/canonical HTTPS, and
  application bearer transport remains unchanged. Schema 50 revokes old OIDC
  sessions and requires a one-time role check on the next login.
- Sessions are random Bearer tokens, SHA-256 hashed in `userSessions`, with the
  browser token stored in localStorage. This avoids ambient-cookie CSRF but makes
  CSP/XSS controls especially important.
- Do not migrate transport/storage or weaken expiry/invalidation without a
  separately reviewed product/security change.

## Authorization

- Global roles are admin/editor/viewer; non-admin access is scoped by
  `userLabAccess` editor/viewer grants.
- Authentication plus public/admin classification is enforced centrally from
  `server/app.ts`; lab and conditional authorization remains per handler via
  `server/lib/lab-access.ts` and admin helpers.
- Client permissions are never sufficient. New routes require negative tests.
- Changes to public/admin route metadata, bootstrap, lab guards, user/grant
  restore, or audit lab resolution are high risk. Every API route is inventoried;
  lab-read/lab-write resolution remains handler-specific.

## Trust boundaries and egress

- Browser/API, API/SQLite, API/LAN/Internet, UDP trap ingest, and container/host
  are distinct trust boundaries.
- User-influenced HTTP/S uses `requestPinnedUrl`; retain DNS pinning, range checks,
  per-redirect validation, credential rejection, TLS behavior, and timeouts.
- Private and unique-local network access is deliberate for inventory/monitoring.
  Loopback, link-local, metadata, multicast, and reserved access stays blocked.
- TCP, ICMP, and all SNMP requests also resolve/validate and pin numeric targets
  at execution time with bounded DNS and transport timeouts.
- Discovery subprocesses use validated targets and argument arrays, never shell
  interpolation.
- Native LXC starts with neighbor-cache discovery and no service capabilities.
  Its root-only advanced control must verify `CAP_NET_RAW`, `CAP_NET_ADMIN`, and
  raw-socket access before applying the matching systemd drop-in; refusal must
  leave configuration unchanged and never mutate outer Proxmox privilege.
- SNMP traps remain independent of discovery mode, disabled by default, and
  require an explicit UDP 1162 firewall decision when enabled.

## Rate limits and proxy identity

- `@fastify/rate-limit` is registered once in `server/app.ts` and keys its
  process-local global limit by Fastify's resulting `request.ip`.
- `TRUST_PROXY` defaults off and accepts only explicit proxy IPs/CIDRs. Legacy
  hop counts, truthy aliases, invalid values, and universal CIDRs disable trust
  with a startup warning. Use Fastify's trusted request IP/host/protocol; never
  read forwarded host/protocol directly. The public edge must overwrite forwarded
  headers, and application-port access should be restricted to controlled proxies.
- CodeQL does not model the global Fastify plugin, so its per-route
  `js/missing-rate-limiting` reports are excluded until 2026-11-30. Runtime
  cross-route/proxy tests and the ESLint single-app-factory rule plus
  `lint:proof` are mandatory compensating controls.

## Secrets and key loss

- Never commit or print credentials, `.env`, databases, backups, keys, or local
  AI context.
- Inline SNMP communities and credential records are encrypted. Public monitor
  responses are redacted; trap observations never change configured trust. Legacy
  trap-source credentials are cleared on schema 50 migration and old-backup restore.
- `RACKPAD_SECRET_KEY` protects supported stored integration and SNMP secrets. Losing or
  rotating it makes existing encrypted values unreadable; re-entry is required.
- Backups remain sensitive because they contain password hashes, infrastructure
  data, and encrypted controller credentials even when selected notification
  secrets are redacted.

## High-risk files

- `server/app.ts`, `server/lib/auth.ts`, `server/lib/oidc.ts`,
  `server/lib/lab-access.ts`, `server/lib/net-guard.ts`,
  `server/lib/secret-crypto.ts`, `server/lib/integrations/`,
  `server/lib/snmp-v3.ts`, `server/routes/admin.ts`,
  `server/routes/integrations.ts`, `server/db.ts`, and
  `server/security-headers.ts`. Credential-, backup-, process-, and
  release-sensitive files under `scripts/` are high risk as well.

## Control weakening and suppressions

Weakening includes broadening public paths/CORS/CSP/egress, lowering auth or
authorization, disabling rate limits or TLS checks by default, publishing a new
port, adding privilege, accepting plaintext secrets, disabling a gate, or hiding
a scanner result. These require explicit authority and independent review.

Suppressions must be finding-specific, narrowly located, justified, and time
bounded where supported. SNMPv3 MD5/SHA1 interoperability exceptions are inline
only in `server/lib/snmp-v3.ts`; they do not justify weak hashes elsewhere.
