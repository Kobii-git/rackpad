# Diff-triggered review checklist

Review only rows triggered by the diff, then apply the final row to every change.

| Diff touches | Verify |
| --- | --- |
| `server/routes/**` | Auth status and correct admin/lab guard; negative tests; validation; parameterized SQL; transaction/audit semantics |
| `server/db.ts` | Migration appended and version bumped; newer-schema behavior; backup/export/restore/integrity implications; no real DB touched |
| `server/routes/admin.ts` backup/restore | Table coverage; users/labs before grants; round trip; secrets/redaction; compatibility guard; atomic failure |
| `users`, `userLabAccess`, auth helpers | No cross-lab grant or deny regression; disabled/session behavior; backup survival |
| `server/app.ts` or middleware | Public paths/exposure, host/origin, errors, rate limiting, auth hook, static fallback |
| `server/security-headers.ts` | Fastify and Vite consumers plus E2E/CSP-dependent exports |
| Outbound network code | `requestPinnedUrl`, address policy, DNS/redirect revalidation, timeout, TLS, no shell interpolation |
| IPAM/DHCP/DNS | Duplicate/conflicting ownership, same-lab references, scope/zone bounds, atomic bulk behavior |
| UI-visible text | English key, all locales, placeholders, i18n and build results |
| React hooks/state | Dependency correctness, stable references, cleanup/cancellation, no render-time mutation |
| Docker/Compose/env | Contract parity, safe defaults, privilege/ports, volume/data path, healthcheck, build context |
| `.github/**` | Least permissions, publish consequence, no broad suppression, justification/review date/expiry |
| Package/dependency | Intentional manifest/lock diff, runtime/dev classification, audit/scanner implications |
| Release metadata | Correct dev/beta/stable version, changelog, tag/channel, full gate and smoke plan |
| AI or human docs | Durable truth only, valid paths/scripts, no duplicate command bodies, no private/local data |
| Any diff | Request satisfied; scope minimal; unrelated work preserved; actual diff read; checks actually run; secrets/DB/backups/generated files absent; behavior/deferred risks reported |
