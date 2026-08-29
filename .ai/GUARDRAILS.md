# Rackpad guardrails

These rules map a changed area to its paired obligations. “Automated” names a
real check; “manual” is not a gate and must be reviewed honestly.

## Routes and authorization

- New or changed route ⇒ decide public/authenticated/admin/lab-read/lab-write,
  validate input, use parameterized SQL, and add negative authorization tests.
- Use `requireAdmin`, `assertGlobalAdmin`, `assertLabRead`, `assertLabWrite`, or
  row-based variants from `server/lib/lab-access.ts`; client checks are UX only.
- `server/app.ts` `publicPaths` changes are RESTRICTED and need exposure tests.
- Enforcement: authentication hook and server tests are automated; complete
  route-to-authorization coverage remains manual because no reliable route
  inventory gate exists yet.

## Schema, migrations, and recovery

- New table or column ⇒ append a numbered migration, bump
  `CURRENT_SCHEMA_VERSION`, assess indexes/FKs, backup export, restore ordering,
  compatibility, integrity, and tests in the same change.
- Never edit an applied migration. Migrations are forward-only.
- Backup change ⇒ run schema coverage, scoped-grant round trip, compatibility,
  and atomic rejection tests against a temporary database.
- Enforcement: `npm run test:server` enumerates SQLite tables, permits only the
  commented `schemaVersion`/`userSessions` exclusions, and tests round trips.

## Outbound network access

- User-influenced HTTP/S ⇒ use `requestPinnedUrl` in
  `server/lib/net-guard.ts`, retain DNS/IP/range validation, bounded redirects,
  TLS behavior, credentials rejection, and timeout tests.
- Never replace the guard with raw `fetch`, `http.request`, or a shell command.
- Private-range access is intentional for this product; loopback, link-local,
  metadata, multicast, and reserved destinations stay blocked.
- Enforcement: server net-guard and monitoring tests are automated; new call-site
  adoption is manual review.

## Discovery and imports

- Discovery change ⇒ keep `new`/`imported`/`dismissed` status transitions in
  `server/routes/discovery.ts` distinct, and keep `technicalRole` and
  `placementHint` classification separate from status. A record must never
  change status as a side effect of classification, enrichment, or rescanning.
- Importer change ⇒ Docker and NetBox (`server/routes/imports.ts`) and the
  Proxmox/Hyper-V collector flows (`src/pages/ImportView.tsx`) must never
  silently drop, merge, or duplicate a source VM, container, or host. Report
  skipped and failed records to the user instead of discarding them.
- Enforcement: discovery placement and Docker import tests are automated;
  end-to-end importer completeness is manual review.

## UI and i18n

- New visible string ⇒ add the English key and every locale entry, preserve
  placeholders, and run `npm run check:i18n` plus the relevant build/test.
- English source strings are Rackpad’s current translation-key convention.
- Enforcement: typed locale parity, i18n rule tests, and value checks are automated.

## CSP and browser security

- CSP change ⇒ assess `server/security-headers.ts`, Fastify, Vite, image/export
  behavior, and browser tests together.
- Do not add inline-script, arbitrary-origin, or broad wildcard allowances merely
  to make a feature work.
- Enforcement: shared constant and E2E assertions are automated; policy quality
  remains security review.

## Environment and Compose

- Runtime variable ⇒ update code semantics, `.env.example`, every intended
  Compose manifest, operator docs, safe diagnostics, and defaults.
- Do not expose UDP 1162 or enable host networking/root by default.
- Enforcement: `npm run check:config` derives names from server source and checks
  pass-through in all three Compose files.

## Containers and persistent data

- Docker/Compose change ⇒ reassess non-root/read-only/no-new-privileges defaults,
  healthcheck, volume ownership, ports, capabilities, persistent state, and
  build-context exclusions.
- Privileged discovery stays isolated in `docker-compose.host-discovery.yml`.
- Enforcement: `.dockerignore` safety is automated by `check:config`; effective
  privilege and data behavior require manual review and Compose rendering.

## Proxmox native LXC

- Native helper change ⇒ keep the dispatcher, tagged release assets, Community
  core pin, CT helper, metadata, environment template, operational assets, and
  updater paired.
- Preserve unprivileged defaults, immutable root-owned code, the native marker,
  `/opt/rackpad_data` as the only service-writable path, manual stable-only
  updates, pre-downtime builds, integrity-checked snapshots, and complete paired
  rollback.
- Discovery safe mode must clear capabilities. Advanced mode may add only
  `CAP_NET_RAW` and `CAP_NET_ADMIN` after an outer-LXC/raw-socket preflight; it
  must never convert privilege or edit the Proxmox host. SNMP traps stay
  independent and disabled by default.
- Enforcement: `npm run check:proxmox`, fixture tests, Bash syntax, and
  ShellCheck are automated; disposable real-Proxmox install/update/rollback
  tests remain mandatory release evidence.

## Scanner suppressions

- Suppression ⇒ one finding, narrowest supported scope, written justification,
  owner/review date or expiry, and no unrelated blind spot.
- SNMPv3 legacy hash exceptions belong inline in `server/lib/snmp-v3.ts`; do not
  suppress weak hashing repository-wide.
- Enforcement: Trivy expiry is automated; CodeQL inline scope and review dates
  require manual review because CodeQL config has no enforced expiry field.

## Releases

- Release ⇒ correct dev/beta/stable version, package lock, changelog sections,
  full validation, channel/tag mapping, and smoke-test plan.
- Dev pushes require a distinct next `-dev.N` version unless explicitly waived.
- No agent may push, tag, publish, promote, or deploy without explicit authority.
- Enforcement: validation and image-channel workflow rules are automated; version,
  changelog, tagging, and promotion remain manual.

## Generated and local data

- Never edit build output, `.tsbuild`, caches, test results, local DBs, backups,
  raw reviewer reports, `.ai/local/`, or secret files as product source.
- `.ai/local/` is advisory local context, never a secret store.
- Enforcement: Git/Docker ignores are partial automated controls; final status,
  diff, and secret-sensitive review remain mandatory.
