# First-Party Proxmox Native LXC Roadmap

## Purpose and status

This roadmap governs a Community Scripts-compatible, non-Docker Proxmox LXC
deployment for Rackpad. Native LXC is intended to become an optional supported
deployment after validation and stable release; Docker remains the general
recommendation. This document does not advertise a working installer until the
stable-release phase has passed its exit gate.

| Phase | Status |
| --- | --- |
| 1. Roadmap, application compatibility, and release contracts | Complete |
| 2. Native installer and transactional updater | Complete |
| 3. Discovery controls, operations, documentation, and CI | Complete |
| 4. Beta 1 and fresh-install validation | In progress - publication blocked |
| 5. Beta 2 update/rollback validation and soak | Planned |
| 6. Stable `v1.8.1` deployment | Planned |
| 7. Official Community Scripts submission | Blocked on upstream eligibility |

## Fixed decisions

- The first stable native-LXC release is `v1.8.1`.
- Production support targets Proxmox VE 9.x on `amd64`.
- Debian 13 is the default guest; Ubuntu 24.04 LTS is also tested.
- The default is an unprivileged LXC with nesting, 2 vCPU, 4 GB RAM, 16 GB
  disk, DHCP, and TCP port 3000.
- Native LXC follows the existing `beta -> main -> stable tag` release train.
- Installed instances update only when an operator runs `/usr/bin/update`, and
  production updates resolve stable GitHub Releases only.
- The public dispatcher on `main` resolves the latest non-prerelease Release;
  versioned code and helper assets execute from that exact tag.
- The initial Community Scripts core pin is
  `7cea42d8a3f7164d1813906f386c6d690eba7fc5`.
- Issue #138 stays open until the official Community Scripts submission is
  accepted. The automation roadmap and Discussion #132 remain unchanged.

## Execution contract

Each implementation prompt completes exactly one phase. Before starting a
phase, verify the previous phase's exit gate. Work begins from a clean, current
base, preserves unrelated changes, and uses `codex/proxmox-native-lxc` for the
first-party implementation.

Phases 1-3 may create one local commit each, but must not push, merge, tag,
publish, deploy, or modify GitHub issues. Phases 4-6 may perform only the remote
actions explicitly authorized by their continuation prompts. Phase 7 must not
submit upstream until every eligibility requirement has been verified.

## Phase 1 - Roadmap, application compatibility, and release contracts

Status: **Complete**

Deliverables:

- Link this proposed roadmap from the README without advertising an installer.
- Use a tested ephemeral client-side ID helper in Storage that prefers
  `crypto.randomUUID()` but remains functional over private-LAN HTTP.
- Version a native environment template with fixed `NODE_ENV`, `HOST`, `PORT`,
  `DATABASE_PATH`, and backup paths, plus every operator-facing runtime setting
  documented by `.env.example`.
- Permit only `DISCOVERY_MAC_SCAN_MODE=neighbor` and `SNMP_TRAP_ENABLED=0` as
  safer native default overrides; fail validation for other default drift.
- For every valid SemVer tag, require tag/package version equality and branch
  ancestry (`beta` for prereleases and `main` for stable tags) before publishing
  an image.
- After quality and image publication succeed, create an idempotent formal
  GitHub prerelease or normal Release. Grant `contents: write` only to that job.

Exit gate:

- Client fallback tests pass.
- Native environment contract and drift fixtures pass.
- Actionlint passes.
- `npm run check:full` passes.
- Workflow permissions and publication consequences are reviewed.
- One local Phase 1 commit exists; nothing is pushed or published.

Validation completed on 2026-08-29: the client fallback tests, native
environment and release-contract fixtures, actionlint, and
`npm run check:full` all passed. The Release job's permissions and publication
ordering were reviewed before the local Phase 1 commit.

Phase 2 continuation prompt:

> Continue with Phase 2 of `docs/PROXMOX_LXC_ROADMAP.md`. Verify Phase 1 first, implement only the complete native installer and transactional stable-update path, create one local commit, and stop without pushing or publishing.

## Phase 2 - Complete native installer and transactional updater

Status: **Complete**

Deliverables:

- Add the public dispatcher, versioned runner, pinned core reference, Community
  CT helper, installation helper, JSON metadata, and versioned systemd,
  environment-sync, update, and discovery assets under `deploy/proxmox/`.
- Resolve production installs to the latest stable Rackpad Release. Allow
  maintainer-only reference overrides for beta and branch testing without
  allowing production defaults to select either.
- Supply the selected Rackpad tag, script origin, and pinned Community core
  origin to the Community runner. Use `check_for_gh_release` and
  `fetch_and_deploy_gh_release`; do not use Docker or `git pull`.
- Declare Debian 13 and Ubuntu 24.04 install methods, port 3000, unprivileged
  defaults, null credentials, the existing selfh.st icon, and no ARM64 support.
- Install Node 22 through Community core plus build, Python, SQLite, and network
  discovery tooling. Fetch the selected formal Release tarball, run `npm ci`,
  build both applications, prune development dependencies, and preserve every
  required runtime and collector asset.
- Keep immutable code in `/opt/rackpad_releases/<version>`, atomically select it
  through `/opt/rackpad`, and persist database/backups in `/opt/rackpad_data`.
  Store configuration at `/etc/rackpad/rackpad.env` and require the exact native
  marker `/etc/rackpad/native-lxc`.
- Refuse Docker Compose collisions and updates without the native marker. Run as
  a non-login `rackpad` user with root-owned read-only code, `0750` data paths,
  a `root:rackpad` `0640` environment, `0600` snapshots, an unprinted generated
  secret, and a hardened systemd service whose writable paths are limited to
  persistent data. Leave scheduled backups disabled.
- On update, build the latest stable Release without downtime. Before switching,
  stop the service, create and integrity-check a self-contained SQLite snapshot,
  and back up code selection, configuration, operational assets, version/origin,
  and core-pin state.
- Merge newly introduced template keys atomically without overwriting operator
  values. Preserve unknown or deprecated keys, warn by name only, never emit
  values, and never rotate the existing secret.
- Atomically activate the new release, refresh versioned operational assets and
  the Community update entrypoint, then verify systemd, `/api/health`, the
  database-backed `/api/auth/status`, the SPA root, and both collectors.
- On failure, restore code, database, environment, assets, version, origin, and
  core pin and verify the old release. If that validation fails, leave Rackpad
  stopped and report exact recovery paths. Retain the current release plus the
  latest three paired code/database rollback points and collect only older,
  unreferenced release directories.

Exit gate:

- Bash syntax, ShellCheck, metadata, environment-sync unit, collision, no-op
  update, and rollback fixtures pass.
- No secret value appears in logs or fixtures.
- `npm run check` passes.
- One local Phase 2 commit exists; nothing is pushed or published.

Validation completed on 2026-08-29: Bash syntax and ShellCheck passed across
`scripts/` and `deploy/proxmox/`; the Phase 2 contract validator checked all 13
paired deployment assets; all nine isolated configuration, collision, no-op,
failure, rollback, operational-asset, and retention fixtures passed; and
`npm run check` passed. The fixture output and task diff were also checked for
secret values before the local Phase 2 commit.

Phase 3 continuation prompt:

> Continue with Phase 3 of `docs/PROXMOX_LXC_ROADMAP.md`. Verify Phases 1-2 first, implement only discovery controls, operations and migration documentation, repository guidance, and CI validation, create one local commit, and stop without pushing or publishing.

## Phase 3 - Discovery controls, operations, documentation, and CI

Status: **Complete**

Deliverables:

- Install root-only `rackpad-discovery-mode safe|advanced|status`. Safe mode
  enforces neighbor-cache discovery and removes service capabilities. Advanced
  mode preflights raw networking before adding `CAP_NET_RAW` and
  `CAP_NET_ADMIN` through a systemd drop-in.
- Truthfully refuse advanced mode when the outer unprivileged LXC blocks it;
  explain the Proxmox-side choice without silently changing privilege. Keep
  SNMP traps independently disabled and document explicit firewall enablement.
- Document service/log access, manual updates, configuration, backups, offline
  restore, password reset, rollback retention, and failed-rollback recovery.
- Support fresh LXC installation. Document a controlled, manual Docker-to-native
  migration that preserves the secret key and moves either a validated database
  or portable JSON backup while keeping the stopped Docker LXC recoverable.
- Update relevant operator, contributor, changelog, issue-template, and `.ai`
  documentation to match implemented behavior. Do not alter the automation
  roadmap or Discussion #132.
- Extend quality CI Bash/ShellCheck coverage and add `check:proxmox` for helper
  pairing, origins/pins, variables, forbidden Docker/`git pull` patterns,
  metadata parity, service hardening, and persistent paths.

Exit gate:

- `npm run check:proxmox`, actionlint, Bash syntax, ShellCheck, and
  `npm run check:full` pass.
- The complete diff and guardrails pass review, and documentation describes only
  behavior present in the branch.
- One local Phase 3 commit exists; nothing is pushed or published.

Validation completed on 2026-08-29: the maintained contract checked 16 paired
deployment assets; all 12 isolated environment, collision, operational-asset,
discovery-mode, update-failure, rollback, and retention scenarios passed; Bash
syntax and ShellCheck passed across `scripts/` and `deploy/proxmox/`; actionlint
v1.7.12 passed; and `npm run check:full` passed, including 253 server assertions,
41 client tests, and 29 Playwright tests. The diff, documentation claims,
privilege boundary, persistent paths, rollback set, and secret/data guardrails
were reviewed before the local Phase 3 commit. Real Proxmox guest validation
remains reserved for Phases 4 and 5.

Phase 4 continuation prompt:

> Continue with Phase 4 of `docs/PROXMOX_LXC_ROADMAP.md`. Verify Phases 1-3, merge the reviewed work into `beta`, publish only `v1.8.1-beta.1`, test fresh Proxmox installations, update issue #138 with the beta test request, and stop without publishing a stable release.

## Phase 4 - Beta 1 and fresh-install validation

Status: **In progress - publication blocked**

Deliverables:

- Set package and lockfile to `1.8.1-beta.1`, complete the changelog, rerun the
  full release gate and an independent security review, then merge to `beta`,
  push, tag, and publish only `v1.8.1-beta.1`.
- Confirm matching GHCR images and a formal GitHub prerelease with source
  archives.
- With explicit beta overrides, test disposable Proxmox VE 9.x `amd64` Debian 13
  and Ubuntu 24.04 guests: defaults/custom port, first admin, reboot, hardening,
  ownership, backup/restore/password reset, discovery modes, closed UDP 1162,
  and Docker collision refusal.
- Add a maintainer comment to issue #138 with the beta command and exact test
  checklist; keep the issue open.

Exit gate:

- Both guest operating systems pass without unresolved data-loss, privilege,
  update, or release defects.
- Evidence is recorded in release test notes and the roadmap status is updated.
- Stop before Beta 2.

Progress recorded on 2026-08-30: the reviewed implementation was merged and
pushed to `beta`, and the immutable `v1.8.1-beta.1` tag was created at commit
`1f72800ecb70987c85122f88a37f39e982f1d5b1`. The branch quality, CodeQL, and
security workflows passed. The tag workflow failed twice at the same stale UI
count assertion in the duplicate-MAC Playwright scenario, so its image and
GitHub Release jobs correctly remained skipped. The tag has not been moved or
replaced, no prerelease has been published, and issue #138 has not been given a
non-working beta command. Fresh Debian 13 and Ubuntu 24.04 testing also remains
pending because no disposable Proxmox VE 9.x `amd64` host is connected. See
`docs/releases/v1.8.1-beta.1-test-notes.md` for the evidence and remaining
checklist. Phase 4 cannot pass its exit gate until a replacement prerelease
strategy is authorized, publication succeeds, and both guest tests pass.

Phase 5 continuation prompt:

> Continue with Phase 5 of `docs/PROXMOX_LXC_ROADMAP.md`. Fix any Beta 1 defects, publish only `v1.8.1-beta.2`, test Beta 1-to-Beta 2 update and rollback on both supported guests, complete the soak, and stop without publishing `v1.8.1`.

## Phase 5 - Beta 2 update/rollback validation and soak

Status: **Planned**

Deliverables:

- Apply only Beta 1 defects and publish `v1.8.1-beta.2` through `beta`.
- On retained Beta 1 LXCs, test successful manual update, non-overwriting
  environment merge, helper/core-pin transition, no-op idempotence, pre-downtime
  download/build failure, snapshot failure, post-migration health failure,
  service-unit failure, complete rollback, retention cleanup, and reboot after
  success and rollback.
- Repeat critical update/rollback coverage on Debian 13 and Ubuntu 24.04.
- Soak Beta 2 for seven days using normal monitoring, backup, integration-status,
  and discovery workloads. Material fixes reset affected tests and the soak.

Exit gate:

- The seven-day soak completes without unresolved high-severity defects.
- Update, rollback, and recovery evidence is in Beta 2 test notes.
- The full release gate and independent review pass.
- Stop before stable publication.

Phase 6 continuation prompt:

> Continue with Phase 6 of `docs/PROXMOX_LXC_ROADMAP.md`. You are authorized to promote the validated Beta 2 work to `main`, publish stable `v1.8.1`, verify the public installer and matching GHCR/source releases, update GitHub issue #138 and deployment labels, and stop without submitting an upstream Community Scripts PR.

## Phase 6 - Stable `v1.8.1` deployment

Status: **Planned**

Deliverables:

- Set package and lockfile to `1.8.1`, finalize changelog/release notes, promote
  validated beta to `main`, rerun the release gate, tag, and publish `v1.8.1`.
- Verify the tag's formal source Release, GHCR `1.8.1` and `latest`, versioned
  helper/core-pin assets, and public `main` dispatcher.
- On fresh Debian 13, run the production one-line installer without overrides
  and prove it resolves `v1.8.1`; prove `/usr/bin/update` reports no update
  without changing state.
- Change public documentation from planned to supported. Create and apply the
  `deployment` and `upstream-pending` labels to issue #138, post the stable
  command/support matrix, and keep the issue open.
- Mark first-party phases shipped. Never move `v1.8.1`; fix forward as `v1.8.2`.

Exit gate:

- Public commands and URLs work without the development checkout.
- Source Release, container image, and displayed app version all report `1.8.1`.
- Issue #138 states first-party support is shipped and upstream listing remains
  pending.

Phase 7 continuation prompt:

> Continue with Phase 7 of `docs/PROXMOX_LXC_ROADMAP.md`. First verify the official age, star, maintenance, release-tarball and testing requirements. If every requirement is met, prepare and submit the Community Scripts PR with the required disclosures and evidence; otherwise update only the roadmap and issue status and stop.

## Phase 7 - Official Community Scripts submission

Status: **Blocked on upstream eligibility**

Do not begin submission work until Rackpad is at least six months old, has at
least 600 stars, is actively maintained, publishes formal release tarballs, and
has a proven first-party helper. Recheck the current upstream rules rather than
relying on these recorded thresholds.

When eligible, port the tested CT, install helper, and metadata to the current
ProxmoxVED contribution format; reconcile origins without weakening existing
installs; pass the current audits and real-Proxmox checks; and disclose AI
assistance, ARM64 status, security review, and test evidence. Submit only after
all prerequisites pass.

After acceptance, prefer the official catalog command in new-install docs while
continuing to support existing first-party installs. Origin migration must be
explicit and optional. Close issue #138 only after acceptance.

## Compatibility and completion criteria

The shipped operator interfaces will be the stable one-line installer,
`systemctl status rackpad`, journal logging, `/usr/bin/update`,
`/usr/local/sbin/rackpad-discovery-mode safe|advanced|status`,
`/etc/rackpad/rackpad.env`, and native backup/update rollback directories under
`/opt/rackpad_data`.

No public API, database schema, authentication, or stored-data contract change
is planned. Docker and existing GHCR deployments remain compatible.

First-party native LXC is fully deployed only after stable `v1.8.1` exists on
`main`; GitHub Release and GHCR artifacts agree; versioned helper assets resolve;
fresh installs pass on both supported guests; beta update, rollback, and the
seven-day soak pass; configuration and secrets survive; the unprivileged and
trap-disabled defaults hold; and public documentation plus issue #138 accurately
describe the shipped state.
