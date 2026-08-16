# Agent-facing security invariants

The root `SECURITY.md` is the public policy. This file describes engineering
constraints for changes.

## Authentication and sessions

- Local users use scrypt password hashes. OIDC uses authorization code, state,
  nonce, and PKCE S256.
- Sessions are random Bearer tokens, SHA-256 hashed in `userSessions`, with the
  browser token stored in localStorage. This avoids ambient-cookie CSRF but makes
  CSP/XSS controls especially important.
- Do not migrate transport/storage or weaken expiry/invalidation without a
  separately reviewed product/security change.

## Authorization

- Global roles are admin/editor/viewer; non-admin access is scoped by
  `userLabAccess` editor/viewer grants.
- Authentication is global in `server/app.ts`; authorization is per handler via
  `server/lib/lab-access.ts` and admin helpers.
- Client permissions are never sufficient. New routes require negative tests.
- Changes to `publicPaths`, bootstrap, lab guards, user/grant restore, or audit
  lab resolution are high risk.

## Trust boundaries and egress

- Browser/API, API/SQLite, API/LAN/Internet, UDP trap ingest, and container/host
  are distinct trust boundaries.
- User-influenced HTTP/S uses `requestPinnedUrl`; retain DNS pinning, range checks,
  per-redirect validation, credential rejection, TLS behavior, and timeouts.
- Private and unique-local network access is deliberate for inventory/monitoring.
  Loopback, link-local, metadata, multicast, and reserved access stays blocked.
- Discovery subprocesses use validated targets and argument arrays, never shell
  interpolation.

## Secrets and key loss

- Never commit or print credentials, `.env`, databases, backups, keys, or local
  AI context.
- `RACKPAD_SECRET_KEY` protects supported stored integration secrets. Losing or
  rotating it makes existing encrypted values unreadable; re-entry is required.
- Backups remain sensitive because they contain password hashes and infrastructure
  data even when selected notification secrets are redacted.

## High-risk files

- `server/app.ts`, `server/lib/auth.ts`, `server/lib/oidc.ts`,
  `server/lib/lab-access.ts`, `server/lib/net-guard.ts`,
  `server/lib/secret-crypto.ts`, `server/lib/snmp-v3.ts`,
  `server/routes/admin.ts`, `server/db.ts`, and `server/security-headers.ts`.

## Control weakening and suppressions

Weakening includes broadening public paths/CORS/CSP/egress, lowering auth or
authorization, disabling rate limits or TLS checks by default, publishing a new
port, adding privilege, accepting plaintext secrets, disabling a gate, or hiding
a scanner result. These require explicit authority and independent review.

Suppressions must be finding-specific, narrowly located, justified, and time
bounded where supported. SNMPv3 MD5/SHA1 interoperability exceptions are inline
only in `server/lib/snmp-v3.ts`; they do not justify weak hashes elsewhere.
