# Changelog

All notable Rackpad changes should be recorded here.

Rackpad uses semantic versioning and Git tags in the form `vX.Y.Z`.

## [Unreleased]

> On the `dev` branch; not yet tagged/released.

## [1.7.1-beta.1] - 2026-07-11

### Added

- Added administrator integrity reporting and repair support for legacy subnet
  conflicts and invalid IP-assignment references.
- Added a bounded, fair Discovery scan queue with deduplication, queue
  positions, per-lab limits, and completed-job retention.
- Added responsive and accessibility browser coverage for Dashboard, Devices,
  Networks, Discovery, and Visualizer across English, French, and Arabic RTL.

### Changed

- Bond/LAG member ports now keep their real physical cables while aggregate
  ports represent an independent logical L2 link.
- Monitoring and Docker HTTP targets now use pinned, redirect-safe DNS
  resolution that permits private/ULA networks but blocks host-local,
  metadata, multicast, and other special-purpose destinations.
- Non-English dictionaries now load lazily with bundled-English fallback, and
  visible application copy uses explicit translation keys across all locales.
- Global device-type, port-template, and NetBox-template mutations now require
  an administrator.
- Docker publishing now retains provenance/SBOM attestations and prevents
  prerelease tags from updating the stable `latest` image.

### Fixed

- Enforced canonical, non-overlapping subnets and cross-lab assignment
  references across normal writes, imports, SNMP sync, and backup restore.
- Expanded backup preflight validation for gateways, DHCP scopes, zones,
  reservations, VLAN/lab relationships, and assignment/scope relationships;
  rejected restores remain atomic.
- Fixed Discovery scans that could outlive reverse proxies, standardized the
  completed status, and made the Discovery workspace vertically reachable at
  supported desktop widths.
- Fixed same-lab assignment port/device mismatches, non-admin redaction, and
  conflicted-subnet child mutation permissions.
- Fixed physical LAG paths through patch panels while preserving existing
  aggregate links and backups.

### Test notes

- Upgrade a populated `1.7.0-beta.4` volume and confirm IPAM, DHCP, assignments,
  aggregates, cables, backups, and integrity reporting remain intact.
- Retest a slow routed Discovery subnet and confirm the request queues, polls,
  completes without a 504, and refreshes the inbox.
- At 1024x768, confirm the Discovery inbox has usable height, precedes the
  Inspector, and remains vertically reachable.
- Cable two LAG members through separate patch panels, retain a logical
  aggregate link, and verify direct, active-endpoint, and full-path maps.
- Switch between English, French, and Arabic; confirm RTL direction, preserved
  hostnames, lazy locale loading, and no serious accessibility findings.

## [1.7.0-beta.4] - 2026-07-04

### Added

- Added copyable cabling maps in device ports, visualizer device inspection,
  and trace summaries.
- Added a compact VLAN overview to Networks with subnet, DHCP, assignment, and
  port usage counts.

### Changed

- Discovery scans now fan out larger CIDRs into up to 16 `/24` chunks for
  manual and scheduled runs while scanning every usable host in the accepted
  CIDR.

### Test notes

- Verify Device Detail and Visualizer cabling maps can be copied or downloaded
  in direct, active-endpoint, and full-path modes.
- Verify Trace mode can copy or download a traced path summary.
- Verify Networks shows all VLANs in the overview and selecting a VLAN opens the
  matching network details.
- Verify manual and scheduled discovery scans accept up to `/20`, reject larger
  ranges, and keep results in the normal discovery inbox.

## [1.7.0-beta.3] - 2026-07-04

### Fixed

- Blocked generic port deletion for bond aggregate ports and bond member ports;
  aggregate removal must use the aggregate delete flow.
- Hid the generic delete action for bond aggregate/member ports in the device
  detail port editor.
- Updated the visualizer route test helper to use a valid Rackpad port kind.

### Test notes

- Verify bond member ports cannot be deleted directly from generic port APIs or
  device detail, and that uncabled aggregate ports can still be deleted from
  the Ports workspace aggregate flow.

## [1.7.0-beta.2] - 2026-07-04

### Changed

- Improved visualizer cable routing with stable lane assignment by
  rack/room/container pair.
- Increased spacing for patch-panel cable routes and kept traced cables drawn
  above normal cables.
- Reserved label space from the actual port strip width on device cards to
  reduce dense-port label overlap.

### Fixed

- Added regression coverage that dragged pyramid/diagram nodes expand the
  visualizer bounds instead of escaping the parent canvas.

### Test notes

- Verify visualizer cables remain readable around patch panels and that trace
  highlights stay visually above normal cables.
- Verified `node --import tsx --test src/pages/visualizer/model.test.ts`.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, and `bash -n scripts/collect-proxmox.sh`.
- Smoke tested the Visualizer with a patch-panel path and confirmed the
  3-hop trace list, patch segment, last-hop marker, and trace-highlighted
  cable paths render in beta.

## [1.7.0-beta.1] - 2026-07-04

### Added

- Added half-width rack placement with full, left, and right rack slots.
- Added rack-slot controls to the device drawer and slot labels in rack,
  device list, device detail, and visualizer rack views.

### Changed

- Rack placement validation now allows left and right devices to share the
  same U/face while still rejecting same-side and full-width overlaps.
- Rack usage counts now treat left/right devices sharing one face/U as one
  occupied rack unit.

### Fixed

- Legacy backup restores default missing rack-slot data to full-width devices.

### Test notes

- Verify two half-width devices can share one U as left/right, and that
  full-width or same-side overlaps are rejected across multi-U spans.
- Verify rack and visualizer views render left/right devices side-by-side.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, and `bash -n scripts/collect-proxmox.sh`.

## [1.7.0-beta.0] - 2026-07-04

### Added

- Added port bonding/LAG support using aggregate ports as cable endpoints.
- Added port aggregate create, update, and delete APIs with same-device,
  same-lab member validation.

### Changed

- Member ports in a bond are blocked from direct cabling; cable the aggregate
  port instead.
- Ports views now show aggregate ports and mark physical members with their
  aggregate membership.

### Fixed

- Backup export and restore now preserve aggregate ports and member
  relationships.

### Test notes

- Verify creating `Bond1` from two free switch ports, cabling the aggregate
  endpoint, and confirming the member ports are unavailable as cable endpoints.
- Verify deleting a cabled aggregate is rejected, then succeeds after removing
  the cable.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, and `bash -n scripts/collect-proxmox.sh`.

## [1.6.9-beta.1] - 2026-07-04

### Changed

- Added a Networks/IPAM guide for simple tagged and untagged homelab network
  setup, DHCP scopes, DHCP reservations, IP zones, and optional VLAN ranges.
- Added a Discovery guide covering manual scans, scheduled scans, review-first
  inbox behavior, `/24` scan limits, Docker/LXC MAC visibility, and backup
  restore expectations.

### Test notes

- Verify the README links open the new Networks/IPAM and Discovery guides.
- Verify scheduled discovery scans can still be created, run, paused, resumed,
  deleted, and preserved in backup exports.

## [1.6.9-beta.0] - 2026-07-04

### Added

- Added per-lab scheduled discovery scans so selected CIDRs can refresh the
  discovery inbox automatically on their own interval.

### Changed

- Released Rackpad `1.6.9-beta.0` for beta testing of scheduled discovery
  scans.

### Test notes

- Verify scheduled discovery scans can be created, paused, resumed, run
  manually, and deleted from the Discovery page.
- Verify scheduled scan results continue landing in the normal review inbox.
- Verify backup export and restore preserve scheduled discovery scans.

## [1.6.8-beta.1] - 2026-07-04

### Fixed

- Counted custom device types parented to Patch panel as passive patch panel
  pass-through pairs in Reports capacity totals.
- Localized the new Visualizer trace hop labels and last-hop marker.

### Changed

- Released Rackpad `1.6.8-beta.1` as a follow-up beta for the trace hop and
  custom patch panel report fixes.

### Test notes

- Verify a custom patch panel device type with front/rear ports reports each
  pass-through lane once in Reports capacity.
- Verify Visualizer trace mode still shows the numbered hop list beside the
  trace picker with the `Last hop` marker.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, and `bash -n scripts/collect-proxmox.sh`.

## [1.6.8-beta.0] - 2026-07-04

### Fixed

- Fixed device edits being blocked by unchanged management IP assignments whose
  existing DHCP/static metadata would fail strict validation if resubmitted.
- Allowed trunk ports to use the native VLAN as an allowed/tagged VLAN in both
  port editors while preserving same-lab VLAN validation.
- Counted passive patch panel front/rear pass-through pairs once in report
  capacity totals instead of double-counting front and rear terminations.
- Surfaced the Visualizer trace hop list beside the trace picker with numbered
  rows, segment details, and a final-hop marker.

### Changed

- Released Rackpad `1.6.8-beta.0` as a focused fault-fix beta for device/IP
  sync, trunk VLAN editing, patch panel capacity reporting, and trace hop
  visibility.
- Kept production server builds focused on runtime code by excluding
  `server/tests` from `tsconfig.server.json`; server tests still run through
  `npm run test:server`.

### Test notes

- Verify editing a device's placement, room, or wireless attachment no longer
  trips DHCP/static management IP validation when the management IP settings are
  unchanged.
- Verify a trunk port can use the same VLAN as native and tagged/allowed, and
  that cross-lab VLAN choices are still rejected.
- Verify Reports capacity shows a 24-port front/rear patch panel as 24 Gbps
  instead of 48 Gbps, and linked passive pairs count once.
- Verify Visualizer trace mode shows the numbered hop list beside the trace
  picker, with a `Last hop` marker on the final row.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, and `bash -n scripts/collect-proxmox.sh`.

## [1.6.7-beta.0] - 2026-06-28

### Added

- Added a consolidated Networks workspace that replaces the separate VLANs and
  IPAM sidebar pages with subnet-first network rows, VLAN-only planning rows,
  DHCP scopes, zones, assignments, VLAN details, and VLAN ranges in one view.
- Added a combined VLAN/IPAM network setup flow for creating tagged or
  untagged networks with subnet, gateway, DNS, optional DHCP scope, and IP zones
  in one action.
- Added subnet-level gateway and DNS server fields in IPAM, with backup export
  and restore coverage for those fields.
- Added server-side regression coverage for DHCP scopes, IP zones, subnet edit
  safety, cross-lab VLAN links, restored legacy subnet data, and non-canonical
  CIDR containment.

### Fixed

- Redirected legacy `/vlans` and `/ipam` routes to `/networks` while preserving
  existing subnet and VLAN query selection where present.
- Protected subnet gateway and DNS addresses as technical IPs so normal host
  assignments do not accidentally claim them.
- Kept older backups that do not contain subnet gateway or DNS fields
  restorable with null subnet values.
- Enforced server-side validation for DHCP ranges, IP zones, subnet gateways,
  DHCP gateways, and subnet CIDR edits so existing child records cannot be
  stranded outside their subnet.
- Prevented subnet VLAN links and port access/trunk VLAN links from crossing lab
  boundaries.
- Allowed restored legacy subnet records with an existing off-subnet gateway to
  receive unrelated edits while still blocking CIDR or gateway changes that
  would preserve invalid data.
- Fixed non-canonical CIDR handling so values such as `192.168.1.42/24` still
  use the masked network for containment, allocation, discovery placement,
  utilization bars, imports, and visualizer range math.
- Avoided mutating grouped assignment arrays while rendering the Networks view.

### Changed

- Released the Networks/IPAM development candidate as `1.6.7-beta.0` for beta
  Docker testing.
- Preserved submitted CIDR strings in API and backup data while using masked
  CIDR bounds for validation and display math.

### Test notes

- Verify the sidebar shows Networks only, `/vlans` and `/ipam` redirect to
  `/networks`, and dashboard/command palette shortcuts open Networks.
- Verify tagged, untagged, VLAN-only, and multi-subnet VLAN records all render
  as separate network rows with gateway/DNS, DHCP, zones, assignments, and VLAN
  details visible where applicable.
- Verify DHCP can be enabled or omitted during network creation, and that
  partial DHCP or zone ranges are blocked before submission.
- Verify invalid DHCP scopes, IP zones, subnet gateways, DHCP gateways, and
  cross-lab VLAN links are rejected with clear API errors, while external DNS
  servers such as `1.1.1.1` remain accepted.
- Verify restored legacy subnet data with an off-subnet gateway can still edit
  unrelated fields, but must clear or replace the bad gateway before changing
  CIDR.
- Verify non-canonical CIDRs such as `192.168.1.42/24` accept in-subnet
  gateway, DHCP, zone, assignment, discovery, import, and visualization
  behavior for the masked `192.168.1.0/24` network.

## [1.6.6-beta.2] - 2026-06-24

### Added

- Added management for existing custom or observed device types, including
  label/parent updates and deletion for unused custom types.
- Added a Visualizer trace picker so trace mode can start from, or trace to, a
  device port selected from the side panel instead of only tiny canvas ports.

### Fixed

- Regenerated `package-lock.json` so package entries include resolved registry
  URLs for Nix and other downstream build tooling.
- Added a Ports workspace shortcut to the device detail empty Ports state,
  pre-filtered to the selected device.
- Improved black and white cable visibility in Visualizer canvas and diagram
  views by adding theme-aware contrast treatment.

### Test notes

- Verify existing custom device types can be edited, observed legacy types can
  be assigned a parent, and delete is blocked while a type is still used.
- Verify a device with no ports offers a Ports workspace shortcut and opens it
  filtered to that device.
- Verify Visualizer trace mode works via the side-panel device/port picker and
  black or white cables remain visible in light and dark themes.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, `npm audit`, and
  `bash -n scripts/collect-proxmox.sh`.

## [1.6.6-beta.1] - 2026-06-20

### Added

- Added parent classification for custom device types so user-created types can
  inherit built-in icon, template compatibility, and Visualizer behavior.
- Added Visualizer ordering controls for rack sections, racks, loose groups,
  and devices inside those groups.

### Fixed

- Fixed custom child device types being treated as unknown in Visualizer
  grouping, counts, filters, diagram behavior, and port template matching.

### Test notes

- Verify a custom device type can pick a built-in parent type, such as
  `switch`, and that Visualizer grouping and icons follow the parent.
- Verify the Visualizer `Order` panel can move rack sections, racks, loose
  groups, and devices inside loose groups, and that the order persists after a
  browser refresh.

## [1.6.5] - 2026-06-20

### Fixed

- Updated Nodemailer to 9.0.1 to resolve GHSA-p6gq-j5cr-w38f in Trivy
  filesystem and Docker image scans.

### Test notes

- Verify SMTP/email alerts still deliver with the configured host, port,
  security mode, credentials, sender, and recipients.
- Verified `npm audit --audit-level=low`, `npm run check:i18n`,
  `npm run build`, `npm run lint`, `npm run test:server`, and
  `bash -n scripts/collect-proxmox.sh`.

## [1.6.4] - 2026-06-20

### Added

- Added a Docker CLI recovery command for rotating local-user passwords from
  inside the Rackpad container without adding public reset endpoints.
- Added global Fastify rate limiting for Rackpad API routes.
- Added CodeQL configuration for Rackpad-specific security scan handling,
  including exclusions for test fixtures and protocol-required SNMPv3
  compatibility paths.

### Fixed

- Hardened Docker import HTTP requests against SSRF and DNS rebinding by
  resolving and connecting only to routable hosts while preserving supported
  Unix socket imports.
- Cleared the GitHub Security and quality alert backlog on `dev` and `beta`,
  including Trivy image findings, CodeQL alert noise, OIDC callback validation,
  SNMP timeout/resource exhaustion findings, random identifier generation, and
  ReDoS-prone device type normalization.
- Routed bundled Visualizer cables for loose room devices through the same
  right-side gutter treatment used by rack devices.
- Fixed a VLAN patch comparison bug found during the security cleanup.

### Changed

- Moved the runtime Docker base image to Node 22 trixie slim, removed npm/npx
  from the runtime image, and refreshed frontend/build tooling dependencies.
- Trivy image scans now ignore unfixed inherited base-image vulnerabilities so
  security reporting focuses on actionable Rackpad findings.

### Test notes

- Verify a local admin can reset a lost password from Docker with
  `node dist-server/cli/reset-password.js --username admin`, sign in with the
  new password, and that old sessions are invalidated.
- Verify Docker HTTP/Portainer import preview and import still work, and verify
  Unix socket Docker import if the socket is mounted.
- Verify API login/bootstrap flows, OIDC callback login if configured, SNMP
  credentials/sync/traps if available, VLAN edits, bundled Visualizer routing,
  and normal Rackpad navigation.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, CodeQL, Trivy filesystem scan, Trivy image scan,
  Docker publish for `beta`, runtime npm/npx absence in the Docker image, and
  `bash -n scripts/collect-proxmox.sh`.

## [1.6.4-beta.3] - 2026-06-18

### Added

- Added global Fastify rate limiting for Rackpad API routes.
- Added CodeQL configuration for Rackpad-specific security scan handling,
  including exclusions for test fixtures and protocol-required SNMPv3
  compatibility paths.

### Fixed

- Hardened Docker import HTTP requests against SSRF and DNS rebinding by
  resolving and connecting only to routable hosts while preserving supported
  Unix socket imports.
- Cleared the GitHub Security and quality alert backlog on `dev`, including
  Trivy image findings, CodeQL alert noise, OIDC callback validation, SNMP
  timeout/resource exhaustion findings, random identifier generation, and
  ReDoS-prone device type normalization.
- Fixed a VLAN patch comparison bug found during the security cleanup.

### Changed

- Moved the runtime Docker base image to Node 22 trixie slim, removed npm/npx
  from the runtime image, and refreshed frontend/build tooling dependencies.
- Trivy image scans now ignore unfixed inherited base-image vulnerabilities so
  beta security reporting focuses on actionable Rackpad findings.

### Test notes

- Verify Docker HTTP/Portainer import preview and import still work, and verify
  Unix socket Docker import if the socket is mounted.
- Verify API login/bootstrap flows, OIDC callback login if configured, SNMP
  credentials/sync/traps if available, VLAN edits, and normal Rackpad
  navigation.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, CodeQL, Trivy filesystem scan, Trivy image scan,
  runtime npm/npx absence in the Docker image, and
  `bash -n scripts/collect-proxmox.sh`.

## [1.6.4-beta.2] - 2026-06-17

### Fixed

- Routed bundled Visualizer cables for loose room devices through the same
  right-side gutter treatment used by rack devices.

### Test notes

- Verify bundled harness routing with loose devices below racks and room-only
  sections enabled; loose-device cables should offset to the right of the
  cards instead of hugging the card edge.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, the focused Visualizer routing test, and
  `bash -n scripts/collect-proxmox.sh`.

## [1.6.4-beta.1] - 2026-06-16

### Added

- Added a Docker CLI recovery command for rotating local-user passwords from
  inside the Rackpad container without adding public reset endpoints.

### Test notes

- Verify a local admin can reset a lost password from Docker with
  `node dist-server/cli/reset-password.js --username admin`, sign in with the
  new password, and that old sessions are invalidated.
- Verify OIDC-backed users still reset passwords in the identity provider.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, and `bash -n scripts/collect-proxmox.sh`.

## [1.6.3] - 2026-06-16

### Added

- Added SNMPv3 trap support for authenticated `linkUp`/`linkDown` events,
  including encrypted credential matching for devices, monitors, and trap
  sources.
- Added Docker/Portainer import source tracking, encrypted Docker API token
  storage, manual and background Docker container status refresh, and mounted
  `unix:///var/run/docker.sock` import support.
- Added a discovered-host picker so new devices, AP children, Proxmox children,
  shelf devices, VMs, and containers can reuse scanned discovery data.
- Added rack device image thumbnails, Visualizer bundled harness routing, and
  CI security reporting with Dependabot, CodeQL, and Trivy scans.

### Fixed

- Proxmox collection now merges `pvesh`, `qm list`, and `pct list` results,
  continues after individual guest validation failures, and imports guest IPs
  inside DHCP scopes as DHCP reservations.
- NetBox imports now accept 0U device types, creating access points as wireless
  inventory and other 0U models as room inventory.
- IPAM static zones now take precedence over broad DHCP scopes for host
  assignments, and VLAN linked DHCP utilization now matches IPAM counts.
- Visualizer cable routing and tablet panning are more stable, with reduced
  looping/crossed paths for non-rack links.
- WiFi discovery placement now fills matching SSID associations immediately for
  new and already AP-attached clients.
- Docker preview/import permissions, Docker/monitor target validation, and SNMP
  trap logging were hardened to reduce SSRF and trap flood risk.
- Updated `nodemailer` to clear the production npm audit finding before the
  stable release.

### Changed

- Docker image publishing now includes explicit OCI metadata and disables
  published provenance/SBOM attestations so GHCR lists only Rackpad runtime
  Linux architectures.
- Security scans currently run in reporting mode while inherited base-image
  findings are reviewed.

### Test notes

- Verify Docker socket preview/import/status refresh with a read-only
  `/var/run/docker.sock` mount, and verify HTTP/Portainer Docker imports still
  work.
- Verify Proxmox guest import completeness, NetBox 0U imports, IPAM static zone
  assignments, WiFi discovery SSID placement, SNMPv3 traps, rack image
  thumbnails, and Visualizer cable routing.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, `npm audit --omit=dev`, and
  `bash -n scripts/collect-proxmox.sh`.

## [1.6.3-beta.6] - 2026-06-14

### Added

- Rack view device tiles can now show uploaded per-device images, using the
  existing device image attachments as compact front-panel thumbnails.
- Docker container imports can now preview, import, and refresh status through
  a mounted `unix:///var/run/docker.sock` socket as well as HTTP/Portainer
  endpoints.

### Fixed

- VLAN linked IP range DHCP utilization now counts assignments the same way IPAM
  does, so DHCP usage percentages match between VLANs and IPAM.

### Test notes

- Verify uploaded device images appear on racked devices across different rack
  unit heights.
- Verify Docker socket preview/import/status refresh using a read-only
  `/var/run/docker.sock` mount, and HTTP/Portainer Docker imports still work.
- Verify VLAN linked DHCP utilization matches IPAM for the same subnet.
- Added Docker socket regression coverage and verified `npm run check:i18n`,
  `npm run build`, `npm run lint`, `npm run test:server`, and
  `bash -n scripts/collect-proxmox.sh`.

## [1.6.3-beta.5] - 2026-06-14

### Fixed

- Discovery WiFi auto-placement now fills the matching SSID association when a
  client is discovered on a WiFi VLAN, including clients that are already
  attached to the correct AP.
- Newly auto-placed wireless clients now refresh WiFi associations in the UI
  immediately after device creation, so the assigned SSID appears without a
  page reload.

### Test notes

- Added regression coverage for WiFi VLAN discovery creating the correct SSID
  association for new and already AP-attached clients.
- Verified focused discovery placement and API tests, plus
  `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, and `bash -n scripts/collect-proxmox.sh`.

## [1.6.3-beta.4] - 2026-06-14

### Fixed

- Visualizer Pyramid/auto cable routing now uses stable orthogonal lanes for
  non-rack links instead of large sweeping curves, reducing crossed and looping
  cable paths in Firefox and other browsers.
- Visualizer canvas panning now uses pointer events and touch-safe handling, so
  tablet users can drag the canvas while the page keeps a usable scroll layout
  on narrower screens.

### Test notes

- Smoke-tested the Visualizer locally in Pyramid/auto mode with demo data at
  desktop and 1024x768 tablet-sized viewports.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`,
  `npm run test:server`, and `bash -n scripts/collect-proxmox.sh`.

## [1.6.3-beta.3] - 2026-06-13

### Fixed

- Added explicit OCI metadata to the Docker image and disabled published
  provenance/SBOM attestations so GHCR only lists Rackpad's runtime Linux
  architectures.
- IPAM static zones now take precedence over broad DHCP scopes, so static
  addresses such as infrastructure management IPs can be assigned from the
  selected static range without being rejected as DHCP pool addresses.

### Test notes

- Added API regression coverage for a broad DHCP scope with separate static and
  DHCP IP zones, including a static assignment for `10.0.21.33`.
- Verified `npm run check:i18n`, `npm run build`, `npm run lint`, and
  `npm run test:server`.

## [1.6.3-beta.2] - 2026-06-11

### Added

- Added Dependabot configuration for weekly npm and GitHub Actions update PRs
  against the `dev` branch.
- Added CodeQL scanning for JavaScript/TypeScript security analysis on pushes,
  pull requests, scheduled runs, and manual dispatches.
- Added Trivy filesystem and Docker image security scans that upload SARIF
  reports without blocking builds on inherited base-image findings yet.

### Fixed

- Updated `concurrently` to pull in `shell-quote@1.8.4`, clearing the remaining
  local npm audit finding.

### Changed

- Security scanning starts in reporting mode so Rackpad can track inherited
  `node:22-bookworm-slim` Debian findings while avoiding false release blockers
  for CVEs with no fixed Debian package available.

### Test notes

- Verified the npm dependency audit is clean after the `concurrently` update.
- Added CI coverage for dependency, source, and container image security
  scanning; Docker image scan reports should be reviewed in GitHub security
  results before switching to fail-on-high/critical mode.

## [1.6.3-beta.1] - 2026-06-11

### Added

- Added a shared routable-host guard for Docker import endpoints and HTTP/HTTPS
  monitor checks, rejecting loopback, link-local, private, unique-local, and
  metadata address ranges after DNS resolution.
- Added monitor target validation for IPv4, IPv6, and RFC-1123 hostnames.

### Fixed

- Docker container preview now requires lab editor access, matching Docker
  import permissions instead of allowing viewers to probe endpoints.
- Docker and HTTP/HTTPS monitor checks now block reserved host targets before
  outbound requests to reduce SSRF risk.
- SNMP trap logging now caps persisted trap log and audit rows per source IP so
  trap floods do not fill the database, while still updating trap status/source
  counters and monitor state.

### Changed

- Moved `concurrently` and `tsx` to dev dependencies and refreshed audited
  dependency metadata so production installs omit dev/test tooling.

### Test notes

- Added unit and API coverage for Docker endpoint host guards, monitoring
  target validation, HTTP monitor reserved-host blocking, Docker preview lab
  write access, and SNMP trap log flood caps.
- Verified production dependencies with `npm audit --omit=dev`.

## [1.6.2-beta.5] - 2026-06-11

### Added

- Docker/Portainer imports now persist encrypted source metadata for imported
  containers and can refresh their Rackpad device status from the Docker API.
- Added a manual "Refresh Docker statuses" action, plus a background Docker
  status sync loop configurable with `DOCKER_STATUS_SYNC_INTERVAL_MS`.

### Fixed

- Docker import now preserves Portainer proxy base paths such as
  `/api/endpoints/{id}/docker` when calling `/containers/json`.

### Test notes

- Added parser coverage for Portainer proxy URLs and API coverage for Docker
  import source/link persistence plus status refresh from running to stopped.

## [1.6.2-beta.4] - 2026-06-11

### Fixed

- NetBox device-type YAML imports now accept `u_height: 0` devices, including
  access points and other non-rack-mounted hardware from the NetBox device type
  library.
- NetBox device imports now create 0U access points as wireless inventory and
  other 0U devices as room inventory instead of failing the preview or storing
  an invalid loose placement.

### Test notes

- Added parser and API import coverage for 0U NetBox access points and generic
  0U devices.

## [1.6.2-beta.3] - 2026-06-11

### Added

- Added a Visualizer "Bundled harness" cable routing mode that routes rack
  cables through a rounded side gutter, matching the rack-side cable-management
  shape requested in #49.

### Changed

- Visualizer "Auto cables" now prefers the bundled harness route for
  rack-involved cable links, while keeping the older auto curve fallback for
  non-rack topology links.

### Fixed

- Rack Visualizer cable paths are less likely to run as loose direct curves
  through device cards when a rack-side route is available.

### Test notes

- Smoke-tested the bundled harness in the demo Rack elevations view with the
  right control panel collapsed; same-rack links now leave the rack, turn
  through a side gutter, and return to the destination port.

## [1.6.2-beta.2] - 2026-06-11

### Added

- Add a discovered-host picker to the device drawer so new AP children,
  Proxmox/compute children, shelf devices, and normal devices can reuse scanned
  discovery data instead of retyping hostname, IP, MAC, vendor, and device type.

### Fixed

- Proxmox collector now merges `pvesh` workload results with `qm list` and
  `pct list`, avoiding truncated QEMU/LXC imports on hosts where the API list
  does not return every workload.
- Proxmox guest import now continues after a single VM/CT fails validation and
  logs the skipped workload instead of stopping the entire import batch.
- Proxmox guest IPs that fall inside a Rackpad DHCP scope are imported as DHCP
  reservations, matching IPAM validation for device, VM, and container
  addresses.

## [1.6.2-beta.1] - 2026-06-11

### Added

- SNMP trap receiver now supports authenticated SNMPv3 `linkUp`/`linkDown`
  traps, including AES128 privacy, when the trap source, device, or SNMP monitor
  is mapped to the matching lab credential.

### Changed

- Updated SNMP docs, in-app monitoring guidance, and issue tracking notes to
  mark SNMPv3 traps as beta-supported and keep the remaining #35 work focused
  on vendor profiles, DHCP scope apply, scheduled sync, and lab validation.

## [1.6.2-beta.0] - 2026-06-10

### Changed

- SNMP docs and in-app monitoring guidance now make the split explicit:
  SNMPv3 polling is supported through encrypted credentials, while SNMPv3 traps
  remain a follow-up item.

### Fixed

- SNMP trap source updates now validate that any mapped credential exists in the
  same lab as the trap source, avoiding stale or cross-lab credential links.

## [1.6.1] - 2026-06-10

### Added

- NetBox device-type import can now create a full device (manufacturer, U-height,
  interfaces) in one transaction, not just a port template (#53).
- Link documentation pages to specific devices, with a "Linked documentation" section
  on the device page (#58).
- Read-only Docker/Portainer container import (preview + import as `container` devices);
  no credentials are persisted (Phase 1 foundation, #54).

### Changed

- Device network/IP assignments can now be edited in place instead of deleting and
  recreating them (#55).
- Dashboard no longer double-counts an offline device's failing monitor as a separate
  warning — one offline device shows as a single "device offline — monitoring failing"
  entry (#57).

### Fixed

- Visualizer: the right-hand controls panel scrolls again, so the Filters / Device
  types section at the bottom is reachable (its scroll container was clipping instead
  of scrolling).
- Visualizer cable lines no longer render as fat, broken dashes in Firefox: dashed
  strokes use `butt` line-caps (round caps + dashes rendered incorrectly in Gecko);
  solid cables are unchanged (#51).
- Backup/restore now includes the documentation-to-device links table, so links survive
  a restore.

## [1.6.0] - 2026-06-09

### Added

- SNMP monitoring suite (v1/v2c/v3) alongside ICMP/TCP/HTTP/HTTPS checks:
  IF-MIB interface monitors with per-port link-state, SNMP-verified badges in
  Ports/Dashboard/Visualizer, encrypted per-lab SNMPv3 credentials, a v1/v2c
  trap receiver (UDP 1162, with device auto-learn), and opt-in VLAN/subnet
  inventory sync (preview/apply; DHCP scopes preview-only). Enable sync with
  `SNMP_INVENTORY_SYNC=1`. See [`docs/SNMP.md`](./docs/SNMP.md).
- Expanded localization from 2 to 24 languages with right-to-left support for
  Arabic, Hebrew, and Persian. Rackpad now includes Afrikaans, German, Dutch,
  Spanish, Portuguese, Italian, Polish, Simplified & Traditional Chinese,
  Japanese, Korean, Hindi, Bengali, Thai, Hebrew, Persian, Arabic, Russian,
  Ukrainian, Turkish, Vietnamese, and Indonesian.
- Complete app-wide localization: every user-facing view — including the device
  add/edit drawer, Discovery, IPAM, WiFi, Reports, Ports, and the Visualizer —
  is now translatable.
- Device Detail: add / edit / delete ports inline, including a custom MAC address per
  port (#48, #56). New `PATCH`/`DELETE` port routes, an additive `ports.macAddress`
  migration, and backup/restore coverage for the new column.
- NetBox device-type YAML import foundation: parse + preview (manufacturer, model,
  U-height, interfaces) and import as a deduplicated port template (#53).
- Print / PDF support on the Docs page, plus richer, paginated print output for Reports
  (#47).
- Issue templates and a `CONTRIBUTING.md` (#52), and a `check:i18n` script that flags
  wrong-language values in locale files.

- Added a shared empty-state component and applied it across every view for
  consistent "nothing here yet" placeholders, and localized the remaining
  hardcoded empty-state strings across all 24 languages.
- Discovery now auto-assigns newly discovered devices to the access point / SSID
  of their subnet's Wi-Fi VLAN instead of leaving them loose (#45). Wired and
  already-known devices are left untouched, and assignment only happens when a
  single matching AP is found.
- Bulk device editing supports custom device types and Wi-Fi placement.
- Docker / Proxmox host-network discovery deployment guide and host-network
  compose variant for installs that need raw-socket and layer-2 visibility.

### Changed

- Visualizer: shelf devices now bottom-justify, the cable routing modes do real
  lane-based separation instead of inverted curvature, and the link-line rendering was
  made more robust (#49, #50, #51).
- Monitoring: reworked the page to be monitoring-first. The whole page now
  scrolls as one, and the SNMP traps panel collapses to a button — closed by default,
  with the status line and received-count badge still visible — so the inventory list
  remains the focus.
- Bulk device updates are now atomic: every selected device is validated before
  any write, then all changes apply in one transaction, so a mid-list failure
  rolls back instead of leaving a partial update.
- Documented the new SNMP and secret-key environment variables
  (`RACKPAD_SECRET_KEY`, `SNMP_INVENTORY_SYNC`, `SNMP_TRAP_*`) in `.env.example`.
- Discovery diagnostics now point Docker/LXC users toward the host-network
  compose/capability fix when MAC addresses are hidden by container networking.
- Refreshed the colour tokens so the brand accent (orange) and the warning colour
  (yellow) are clearly distinct, and firmed up panel separation in dark mode.

### Fixed

- Monitoring: restored page scrolling after the beta regression where the device
  list shrank to fit the viewport instead of overflowing naturally.
- i18n: removed French strings that had leaked into the WiFi/wireless block of several
  non-French locales (bn, de, fa, he, nl, pl, ru, tr, uk).
- Back-filled the language layer so recently-added strings (the OIDC sign-in
  flow, lab access/permissions, account/sign-out) are translated across all
  locales instead of falling back to English.

## [1.5.10] - 2026-06-06

### Added

- Added SNMP device monitoring (SNMP v1/v2c) with OID polling alongside the
  existing ICMP/TCP/HTTP probes, plus expanded monitoring tests.
- Added a lightweight typed localization layer with English as the fallback
  language and French as the first translated locale.
- Added a language selector to the setup/sign-in screen and an Admin language
  settings card for saving the instance default language.
- Added public `/api/auth/status` UI settings and admin-only
  `/api/admin/ui-settings` read/update endpoints.
- Added self-hosted IBM Plex Sans / IBM Plex Mono fonts so Rackpad renders
  correctly offline / air-gapped without a Google Fonts runtime dependency.

### Changed

- Renamed the user-facing Users area to Admin, moved navigation to `/admin`,
  and kept `/users` as a backwards-compatible redirect.
- The app now resolves language by browser preference first, then instance
  default, then English, and updates the document language for English/French.
- Refined the visual design pass with cleaner sidebar/footer treatment, tighter
  page copy, improved panel separation, and clearer brand/warning colors.

### Fixed

- Fixed a language selector freeze by preventing the translation observer from
  rewriting already-translated text/attributes and leaving native select option
  text alone.
- Fixed the Rack "Both" face view so front and rear elevations render
  side-by-side instead of pushing the rear face off-screen.
- Fixed VLAN reserved-space bars so small low-numbered ranges remain visible and
  clickable.
- Constrained the Labs grid so workspaces no longer stretch across empty space.

## [1.5.9-beta.1] - 2026-06-06

### Changed

- Superseded by `1.5.10` so the Admin/French localization work is
  versioned as a feature beta and includes the language selector freeze fix.

## [1.5.9-beta.0] - 2026-06-05

### Added

- SNMP device monitoring (SNMP v1/v2c) with OID polling alongside the existing
  ICMP/TCP/HTTP probes, plus expanded monitoring tests.
- Self-hosted IBM Plex Sans / IBM Plex Mono fonts bundled with the app. The
  typeface is now actually applied to the UI (previously it was fetched from the
  Google Fonts CDN but never referenced), and there is no longer a runtime CDN
  dependency, so Rackpad renders correctly offline / air-gapped.

### Changed

- Visual overhaul pass for a more crafted, less templated feel:
  - Removed redundant duplicate section eyebrows on the Dashboard and tightened
    the uppercase-label letter-spacing app-wide.
  - Rewrote loading, error, login, and sidebar copy to be terse and human.
  - Replaced the login card's multi-color gradient with a single brand hairline.
  - Reworked the sidebar footer to a clean identity (session expiry moved to a
    tooltip) and refreshed the wordmark logo to read as a rack, not a menu.
  - Firmer panel separation in both themes and a clearer split between the brand
    amber and the warning yellow so calls-to-action no longer read as cautions.
  - Shortened verbose page subtitles (IPAM, VLANs, WiFi).

### Fixed

- Rack "Both" face view now shows the front and rear elevations side-by-side
  instead of pushing the rear face off-screen.
- The VLAN reserved-space bar now sizes defined ranges so small low-numbered
  ranges stay visible and clickable instead of collapsing to a sliver.
- Constrained the Labs grid so workspaces no longer stretch across empty space.
- Removed two stale duplicate source files (`ReferenceImageGallery 2.tsx`,
  `reference-images 2.ts`).

## [1.5.8] - 2026-06-05

### Added

- Promoted the 1.5 beta Visualizer updates to main, including readable labels,
  wider rack scales, shelf layout controls, multi-select device-type filters,
  and cable route modes for `Auto`, `Concave`, and `Convex` paths.
- Added Discovery subnet targeting with IPAM subnet selection, all-subnet
  scanning, and manual CIDR scanning.

### Changed

- Improved dense rack and shelf rendering so shelf child devices have more room
  for names and multi-U shelf devices respect their own rack footprint.

### Fixed

- Fixed manual CIDR discovery scans so choosing `Manual CIDR` no longer snaps
  back to the first IPAM subnet.
- Fixed Discovery handling for gateway, DNS, reserved, dismissed, linked, and
  deleted imported rows so technical addresses stay out of the normal import
  workflow and stale imported rows return to `new`.
- Fixed IPAM and device networking edge cases for DHCP reservations, gateway
  interface IPs, host-shared containers, and duplicate address validation.
- Fixed documentation markdown table previews and cross-browser image expansion.

## [1.5.8-beta] - 2026-06-04

### Added

- Added a persisted Visualizer cable route selector for grouped and pyramid
  views with `Auto`, `Concave`, and `Convex` modes.

## [1.5.7-beta] - 2026-06-04

### Fixed

- Discovery now resets orphaned `imported` rows back to `new` before listing or
  scanning, so devices deleted through bulk actions do not leave future
  discovery results stuck as imported.

## [1.5.6-beta] - 2026-06-04

### Fixed

- Visualizer shelf child devices now respect their own `heightU` footprint and
  reserve enough rack height for multi-U shelf devices instead of compressing
  every child into the parent shelf height.

## [1.5.5-beta] - 2026-06-04

### Added

- Documentation markdown preview now renders GitHub-style pipe tables.

### Fixed

- Image expand buttons now open Blob URLs instead of direct `data:` URLs, so
  larger image views work in Chrome, Safari, and Firefox.
- Discovery technical addresses such as gateways, DNS, reserved, and
  infrastructure IPs now stay out of normal discovery filters and cannot be
  imported or linked as devices.

## [1.5.4-beta] - 2026-06-01

### Added

- Added Visualizer rack width and shelf layout controls so dense racks can be
  expanded for readable device names without changing rack inventory data.
- Discovery scans can now target an existing IPAM subnet, all IPAM subnets, or
  a manually typed CIDR.

### Fixed

- Host-shared VM/container devices now inherit and explain the parent host IP
  without forcing a duplicate IPAM assignment.
- IPAM now allows interface assignments to use an address that is also marked
  as a DHCP gateway or DNS server, covering firewall VLAN interface IPs.
- Discovery auto-map now imports DHCP-scope addresses as DHCP reservations.
- Deleting an imported device now resets linked discovery rows back to `new`
  instead of leaving stale `imported` entries.

## [1.5.3-beta] - 2026-06-01

### Added

- Added a persisted Visualizer "Readable labels" toggle for grouped and
  pyramid layouts.

### Changed

- Refreshed README and install documentation for the `1.5.2` release with
  light-mode screenshots and current Docker tag examples.
- Readable-label mode widens rack and pyramid device cards, allows larger
  two-line device names, and gives shelf child devices more room.

## [1.5.2] - 2026-05-31

### Fixed

- DHCP reservation allocation now respects manually defined DHCP IP zones
  instead of using the full DHCP scope range.
- Add Device IP assignment now offers Static vs DHCP Reservation allocation
  with a next-address preview that follows the selected allocation mode.
- Server-side IPAM validation now blocks DHCP reservations outside the DHCP IP
  zone when a DHCP zone exists for the subnet.

## [1.5.1] - 2026-05-31

### Changed

- Normal Visualizer and Pyramid device-type filters now multi-select by default:
  click categories to toggle them together, and click All to reset.

## [1.5.0] - 2026-05-31

Rackpad 1.5.0 promotes the beta topology, discovery, monitoring, and IPAM
work into the main release.

### Added

- Added a React Flow diagram visualizer with draggable saved device placement,
  grouped topology sections, minimap, and direct device/cable inspection.
- Added Diagram controls for filtering by device type, with multi-select
  category toggles and an All reset.
- Added whole-section dragging in Diagram view so racks, rooms, WiFi groups,
  and hosted/shelf groups can be moved together instead of only moving one
  device at a time.
- Added WiFi AP/SSID-aware sections to the Diagram visualizer so associated
  wireless clients are grouped by their documented AP and SSID instead of
  falling into loose inventory.
- Added virtual NIC/vSwitch details to the Diagram inspector, including direct
  links to guest devices and the specific NIC in the ports workspace.
- Added monitoring bulk actions for selecting devices and enabling or disabling
  ICMP checks.
- Added an optional ICMP monitor toggle when auto-mapping discovery clients.

### Changed

- Improved IPAM and DHCP utilization around technical addresses, gateways, DNS
  servers, reservations, and DHCP scope usage.
- Improved discovery handling so gateway, DNS, reserved, dismissed, and linked
  rows stay out of the active client workflow.
- Improved visualizer scrolling, dense rack/shelf readability, Diagram card
  sizing, edge routing, edge highlighting, and connected-cable inspection for
  larger rack documentation views.
- Fixed Diagram zoom controls so their icons follow the app theme in dark mode.
- Improved device sorting for IP-like hostnames so discovered devices order by
  numeric IP address instead of plain text.
- Added build-channel badges and GHCR publishing for dev builds.

## [1.4.1] - 2026-05-30

### Fixed

- Shelf-mounted physical hosts, such as a Raspberry Pi placed on a rack shelf,
  can now own virtual switches/bridges while actual VMs and containers remain
  blocked as bridge hosts.

## [1.4.0] - 2026-05-30

### Added

- Added bulk editing for selected devices and selected ports.
- Added rack and room reference images with front/rear rack filtering, larger
  viewing, downloading, notes, and delete support.
- Added a Pyramid visualizer layout for master-to-endpoint topology review.
- Added discovery auto-map for clean new hosts, creating inventory devices and
  linking the discovery row in one workflow.

### Changed

- Rack views can now show front and rear faces side by side.
- Visualizer rack panels now separate rear-mounted devices from front-mounted
  devices and show shelf/tray child devices more accurately.
- Discovery now opens on an active inbox that excludes imported, dismissed, and
  IPAM technical addresses from the main review queue.
- Discovery linking now syncs linked rows from the selected inventory device.
- Dashboard, monitoring, ports, cables, and visualizer workflows were tightened
  from the Additional Notes feedback.

### Fixed

- Cable links can now be edited instead of deleted and recreated.
- The device detail Ports action now deep-links to the selected device/port in
  the ports workspace.
- Discovery scans now identify DHCP gateways, DNS servers, reserved IPs, and
  infrastructure ranges from IPAM and dismiss them from the active client queue.
- IP allocation and utilization now treat DHCP gateways and DNS servers as
  reserved technical addresses instead of free client addresses.
- Imported discovery rows no longer continue showing duplicate warnings after
  they are linked to an existing device.

## [1.3.0] - 2026-05-24

### Added

- Added a Proxmox import workflow with a downloadable Linux collector for
  staging Proxmox nodes, Linux bridges, QEMU VMs, LXC containers, MAC
  addresses, VLAN tags/trunks, guest IPs, CPU, configured RAM, live RAM usage
  metadata, disks, boot flags, source tags, and Proxmox metadata before import.
- Added in-app Hyper-V and Proxmox collector runbooks with prerequisites, exact
  commands, upload/review steps, Proxmox cluster guidance, and collector
  options.
- Added a dedicated Audit Log page, with Dashboard recent activity limited to
  the five newest entries and linked to the full log.
- Added a full tabular port view on switch and patch-panel device detail pages.

### Changed

- Reworked the Dashboard around operational review data: attention items,
  monitor issues, IPAM usage, cabled-port coverage, discovery queue, placement
  coverage, device mix, and network documentation gaps.
- The Imports workspace now supports both Hyper-V and Proxmox collector JSON
  files in the same review-first staging flow.
- Renamed Racks to Racks / Rooms in navigation and page titles.
- Discovery now places the inspector above the inbox in a shorter scrollable
  panel so the host table has more room.
- Visualizer side context can collapse, uses compact summary stats, gives rack
  zones more canvas room, and keeps loose-device layout controls documented.
- Documentation panes now use more of the viewport, with larger Markdown and
  preview panes.
- Users now show local/OIDC auth-source badges in the account list and detail
  pane.
- Updated install docs, Proxmox install notes, Proxmox import docs, README
  feature coverage, and stable Docker defaults for the 1.3.0 release.

### Fixed

- Proxmox imports now include LXC/CT workloads as container devices instead of
  stopping after QEMU VMs.
- Proxmox imports now use configured/max RAM allocation for QEMU VMs and LXC
  containers instead of importing live used memory as the device RAM value.
- Proxmox collection now falls back to `pct list`, `pct config`, and
  `pct status` when API shell endpoints do not return container data.
- Proxmox LXC static network parsing no longer treats the `gw=` gateway as a
  container IP address.
- Docker images now include the Proxmox collector script so the in-app download
  works from GHCR deployments.
- Room rack links now render as proper block rows instead of inline anchors.
- Visualizer direct connections now scroll vertically and cable inspectors add
  direct links to endpoint device pages.
- Built-in switch port template positions keep SFP/SFP+ uplinks after numbered
  copper ports.
- TCP monitor checks now report offline instead of returning a 500 when the
  runtime blocks outbound socket opens.

## [1.2.3-beta.9] - 2026-05-24

### Added

- Added a dedicated Audit Log page and limited Dashboard recent activity to the
  five newest entries with a direct link to the full log.
- Device detail port tabs now include a full tabular port view for switches and
  patch panels in addition to the visual port layout.

### Changed

- Reworked the Dashboard around operational review data: attention items,
  monitor issues, IPAM usage, cabled-port coverage, discovery queue, placement
  coverage, device mix, and network documentation gaps.
- Renamed the navigation and page title from Racks to Racks / Rooms.
- Discovery now places the inspector above the inbox in a shorter scrollable
  panel so the host table has more horizontal space.
- Visualizer side context can be collapsed, keeps summary stats in a compact
  two-column rail, and gives the rack zone more canvas space.
- Documentation panes now use more of the viewport, with larger Markdown and
  preview panes.
- Users now show a local/OIDC auth-source badge in the account list and detail
  pane.

### Fixed

- Room rack links now render as proper block rows instead of inline anchors.
- Visualizer direct connections now scroll vertically and cable inspectors add
  direct links to the endpoint device pages.

## [1.2.3-beta.8] - 2026-05-24

### Fixed

- Proxmox imports now use configured/max RAM allocation for QEMU VMs and LXC
  containers instead of importing live used memory as the device RAM value.
- Proxmox collector output now keeps live used memory as separate
  `memoryUsedGb` metadata for review without overwriting allocated RAM.

## [1.2.3-beta.7] - 2026-05-24

### Fixed

- Added `container` as a built-in device type so Proxmox LXC/CT workloads
  import correctly instead of stopping after QEMU VMs.
- Containers now use the same virtual-workload defaults as VMs for placement,
  ports, device type pickers, and compute views.

## [1.2.3-beta.6] - 2026-05-24

### Fixed

- Proxmox collector now falls back to `pct list`, `pct config`, and
  `pct status` when the Proxmox API shell LXC endpoints do not return
  container data, so LXC containers are included alongside QEMU VMs.

## [1.2.3-beta.5] - 2026-05-24

### Fixed

- Docker images now include the Proxmox collector script, so the in-app
  Proxmox collector download works from GHCR deployments.
- Docker beta install examples now use the published moving `beta` image tag.

## [1.2.3-beta.4] - 2026-05-24

### Fixed

- Proxmox LXC imports no longer treat the `gw=` gateway value as a container IP
  address when staging static LXC network configuration.

## [1.2.3-beta.3] - 2026-05-24

### Changed

- Removed the Ko-fi support link from the application UI and kept the optional
  support link only in the GitHub README.

## [1.2.3-beta.2] - 2026-05-24

### Added

- Added in-app Hyper-V and Proxmox collector runbooks on the Imports page with
  prerequisites, exact commands, upload/review steps, Proxmox cluster guidance,
  and optional Proxmox collector flags.

## [1.2.3-beta.1] - 2026-05-24

### Added

- Added a Proxmox import workflow with a downloadable Linux collector for
  staging Proxmox nodes, Linux bridges, QEMU VMs, LXC containers, MAC
  addresses, VLAN tags/trunks, guest IPs, CPU, RAM, disks, boot flags, source
  tags, and Proxmox metadata before import.
- Added Proxmox import documentation with collector options, review checklist,
  and troubleshooting notes for QEMU guest agent and LXC IP collection.

### Changed

- The Imports workspace now supports both Hyper-V and Proxmox collector JSON
  files in the same review-first staging flow, with LXC containers imported as
  container devices and container IP assignments.
- Updated GitHub install/demo instructions, seeded demo content, and 1920x1200
  screenshot coverage for the v1.2.2 feature set.
- Added richer Visualizer screenshots for cable selection, health overlay, trace
  mode, and loose-device layout options.

### Fixed

- Fixed built-in switch port template positions so SFP/SFP+ uplinks sort after
  the numbered copper ports when new devices are created from templates.
- TCP monitor checks now report offline instead of returning a 500 when the
  runtime blocks outbound socket opens.

## [1.2.2] - 2026-05-24

### Added

- Added OIDC sign-in support with PKCE, role mapping, Authentik-style
  configuration guidance, and `OIDC_DEBUG=1` troubleshooting logs.
- Added custom device types across inventory, discovery, icons, filters, and
  port templates.
- Added MAC address support across device records, discovery imports, inventory
  search/sort, ports, IPAM, monitoring, reports, racks, WiFi, compute, and the
  Visualizer.
- Added a Markdown Documentation workspace with persisted pages, preview,
  search, and inline image insertion.
- Added persisted device image attachments with labels and notes on device
  detail pages.
- Added rack and room deep links for the Racks workspace, plus Dashboard
  inventory type links that open filtered device lists.

### Changed

- Visualizer cable highlighting, room loose-device layout, and room-only rack
  zone behavior are easier to inspect and tune.
- OIDC provider errors now include the discovery URL that failed, making issuer
  URL 404s easier to diagnose.
- Discovery can report why MAC addresses are unavailable and can use stronger
  MAC discovery helpers when the deployment has layer-2 visibility.

### Fixed

- Updated vulnerable transitive packages through the Fastify static-file stack.
- Backup/restore now preserves parent-linked devices, documentation pages,
  device images, MAC addresses, and related beta data.

## [1.2.1-beta.4] - 2026-05-23

### Added

- Added a Markdown Documentation workspace with persisted pages, preview, search,
  and inline image insertion.
- Added persisted device image attachments with labels and notes on each device
  detail page.
- Rack and room links can now deep-link into the Racks workspace with selected
  rack or room context.
- Dashboard inventory type tiles now open the Devices page filtered to that
  device type.

### Changed

- Rack/report navigation now targets specific rack and room context instead of
  only opening the general Racks page.

## [1.2.1-beta.3] - 2026-05-23

### Added

- Device records now have a MAC address field, discovery imports preserve it,
  and major IP displays show the MAC beside the management IP when known.
- Devices, Discovery, Ports, IPAM, Dashboard, Reports, and the Visualizer now
  expose more direct navigation links between devices, racks, rooms, ports, and
  addresses.
- Visualizer layout options can place room loose devices below racks and can
  show room-only sections in the rack-zone pane without creating a placeholder
  rack.
- `OIDC_DEBUG=1` adds issuer/discovery/token/JWKS troubleshooting logs for OIDC
  sign-in setup.
- Docker compose examples now pass `OIDC_REDIRECT_URI`, and the README includes
  a working Authentik-style OIDC configuration example.

### Changed

- OIDC provider errors now include the discovery URL that failed, making issuer
  URL 404s easier to diagnose.
- Device MAC addresses can now be searched and sorted directly in inventory
  views, including the Devices table and Discovery inbox.

## [1.2.1-beta.2] - 2026-05-22

### Added

- Discovery scan diagnostics now explain when MAC addresses are unavailable
  because Rackpad lacks layer-2 visibility from the current runtime.
- Optional stronger MAC discovery using `arp-scan` or `nmap` when those tools
  are available and the deployment has the needed network capabilities.

### Changed

- Docker images now include common network discovery helpers used by Rackpad's
  MAC enrichment path.

## [1.2.1-beta.1] - 2026-05-22

### Added

- OIDC login support with PKCE, role mapping, bootstrap handling, and frontend
  sign-in/callback flow.
- Custom device types for device records, discovery review, icons, filters, and
  port templates.
- IEEE OUI vendor enrichment for discovered MAC addresses with cached MA-L,
  MA-M, and MA-S prefix data.

### Changed

- Visualizer cable highlighting and same-rack cable routing are easier to read.
- Room-assigned loose devices render with their room/rack section in the
  Visualizer.

### Fixed

- Updated vulnerable transitive packages through the Fastify static-file stack.

## [1.2.0] - 2026-05-20

### Added

- First-class Rooms for racks and devices, including room-aware rack views,
  device placement, and Visualizer topology sections.
- Visualizer 1.2 topology workspace with room/rack zones, documented cable
  colors, endpoint dots, port strips, search, health overlay, trace mode,
  pan/zoom, type filters, and richer inspectors.
- Hyper-V import workflow with a downloadable collector, editable host staging,
  VM selection, CPU/RAM/disk/OS/IP/VLAN import controls, and host matching or
  creation.
- Reports workspace with printable/PDF-friendly output plus Excel and CSV
  exports for inventory, IPAM, monitoring, cabling, WiFi, and summary data.

### Changed

- Visualizer rack elevations now render full configured rack height and scale
  U spacing for dense 1U switch or patch-panel layouts.
- Devices, Discovery, Monitoring, Cables, and VLANs gained broader sorting,
  filtering, and scroll usability improvements.
- GHCR publishing now supports stable `latest` and beta image tags for simpler
  Docker-only installs.

### Fixed

- Stabilized Visualizer rack layout, room grouping, and dense rack rendering.
- Fixed Hyper-V importer edge cases with older collector exports and normal
  browser collector downloads.
- Improved direct-route refresh behavior for deployed Rackpad pages.

## [1.2.0-beta.6] - 2026-05-20

### Changed

- Visualizer rack elevations now always render the full rack height, including
  empty U positions, and dynamically increase per-U spacing for dense 1U
  devices with many ports.

## [1.2.0-beta.5] - 2026-05-20

### Changed

- Visualizer now treats Rooms as first-class topology sections: rack elevations
  are grouped by room, room/loose inventory groups include room context, and
  cross-room cable tracing remains available through the existing port graph.

## [1.2.0-beta.4] - 2026-05-20

### Fixed

- Stabilized Visualizer rack elevations so 1U devices, shelves, brush panels,
  and blanking panels no longer compress into overlapping rows.

## [1.2.0-beta.3] - 2026-05-20

### Added

- Shared sortable table headers and sort helpers for denser inventory tables.
- Ports workspace device and interface filters for type, link status, port
  names, VLANs, bridge membership, peers, and cable metadata.
- VLAN workspace search and sorting for ranges and documented VLAN records.

### Changed

- Visualizer now groups hosted VMs under their parent host instead of treating
  them as generic loose room inventory, and supports shift-wheel horizontal pan.

## [1.2.0-beta.2] - 2026-05-19

### Added

- Visualizer 1.2 beta upgrade with grouped rack and room zones, documented cable
  colors, endpoint dots, hover/selection dimming, online cable pulse, port
  strips, type filters, search/jump, health overlay, trace mode, pan/zoom,
  legend, rack free-U bands, empty states, and a richer topology inspector.

### Changed

- Visualizer now derives its canvas from a scoped model layer that indexes
  devices, ports, cables, racks, rooms, monitor rollups, IPAM subnets, VLANs,
  virtual switches, and discovery MAC/vendor metadata without changing backend
  APIs or schema.

## [1.2.0-beta.1] - 2026-05-19

### Added

- First-class Rooms for grouping racks and loose devices by physical location,
  including room create/edit/delete workflows, room assignment from rack/device
  editors, Devices placement awareness, and room columns in the Visualizer.
- Hyper-V import host staging now lets you edit the host record before import
  and choose whether VMs should be attached to an auto-matched host, a newly
  created host, or a manually selected existing Rackpad device.
- GHCR publishing now explicitly maintains a `latest` image tag for stable
  `main` and release-tag builds, while documentation still shows pinned version
  tags for controlled production upgrades.
- Beta branch Docker publishing now builds a `beta` image tag, and prerelease
  builds show a visible beta marker beside the app version.

### Fixed

- Monitoring status filters now use target health rollups, so devices with a
  failing ICMP/TCP/HTTP target appear under Offline even if their inventory
  status is still Online or Maintenance.
- Visualizer, Discovery, Monitoring, Reports, and Devices usability fixes from
  the beta stabilization pass are included in this beta.

## [1.1.2] - 2026-05-12

### Fixed

- Hyper-V collector downloads now work from a normal browser click without
  being blocked by the API authentication guard. The endpoint only serves the
  static collector script and does not expose inventory data.
- Hyper-V imports now tolerate PowerShell-exported VLAN and IP list fields that
  arrive as strings, ranges, or empty objects instead of arrays, preventing the
  Imports workspace from failing on older collector exports.

## [1.1.1] - 2026-05-12

### Changed

- Docker image defaults and install examples now use GHCR tags without the Git
  tag `v` prefix, matching the published package names.
- The Visualizer canvas now handles low-cable states more clearly and reduces
  rack-device overlap in dense U positions.

### Added

- Hyper-V import now includes a direct collector download action from the
  Imports workspace.

### Fixed

- Route-level render failures now show a recoverable workspace error card
  instead of a blank screen.

## [1.1.0] - 2026-05-12

### Added

- Reports workspace with a live inventory summary, printable/PDF-friendly report layout, Excel workbook export, and CSV exports for full report data, devices, ports/cables, IPAM, monitoring, and WiFi.
- Visualizer workspace that maps rack, loose-room, port, and cable relationships from existing inventory data with selectable cable paths and device context.
- Hyper-V import wizard and local PowerShell collector for staging host, VM, power state, guest OS, virtual switch, virtual NIC, VLAN, IP, CPU, memory, and disk details before importing selected records.
- Hyper-V guest OS inference for Linux VMs that expose a kernel version but no distro name through integration services.

## [1.0.1] - 2026-05-12

### Added

- Release-only Docker Compose file for no-clone installs from the published GHCR image.
- Docker install helper script for Debian/Ubuntu Docker hosts and Proxmox LXC containers.
- Proxmox LXC deployment notes covering nesting, install, updates, and backup expectations.

### Changed

- Rack shelf / tray placement now guides users through creating a shelf directly from the device drawer when no shelf is available to select.
- Default release image references now point at `v1.0.1`.

### Fixed

- Non-root app routes such as `/cables`, `/compute`, and `/ipam` are included in the patch release with the SPA fallback fix, so direct refreshes serve the Rackpad app instead of JSON errors.

## [1.0.0] - 2026-05-03

### Added

- Proper front-and-rear patch-panel passthrough modeling, including built-in patch-panel templates that create paired terminations for every jack.
- Automatic normalization for existing single-sided patch-panel ports during startup, seed, and backup restore so older installs upgrade cleanly without manual data repair.

### Changed

- Patch panels now render as grouped front/rear jacks in the Ports and device detail workflows instead of being treated like one-sided generic port lists.
- The public repository is release-clean for `v1.0.0`; the standalone marketing/launch website now lives outside the application repo.
- Project release metadata, install examples, and container defaults now point at `v1.0.0`.

### Security

- Restricted discovery scans and active monitor target management to administrators, so editor accounts can no longer use Rackpad as a general network probe from the server.
- Backup exports now redact stored Discord, Telegram, and SMTP delivery secrets before download while preserving inventory data and local-user password hashes needed for restore.
- Increased the restore request body size allowance so larger production backups are less likely to fail during import.

### Fixed

- Backup restore now re-attaches parent-linked devices in a second pass, so exports restore cleanly even when child devices sort ahead of their host record.
- IPAM subnet selection no longer bounces between entries when switching subnets in the demo or live app.
- Custom port-template inputs now keep focus while typing instead of dropping focus after the first character.

### Notes

- `npm run build` passes.
- `npm run lint` passes.

## [0.9.7] - 2026-05-02

### Added

- A standalone IIS-friendly Rackpad website and legal/support pack for `rackpad.co.za`, prepared outside the application repository for separate hosting.
- Root project governance files: `LICENSE`, `NOTICE.md`, `SECURITY.md`, and `SUPPORT.md`.
- A richer compute bridge workflow so virtualization hosts can model `external`, `internal`, and `private` virtual switches directly from the Compute workspace.

### Changed

- External virtual switches can now claim one or more host uplink ports directly from the Compute page instead of forcing that workflow through the Ports workspace.
- Compute bridge cards now summarize bridge kind, host uplinks, guest member NICs, and bridge notes in one place for Hyper-V, Proxmox bridge, and similar host-switch layouts.
- README and installation docs now include the public deployment, legal, and system requirement guidance needed for early production-style deployments.

### Schema

- Added `kind` to `virtualSwitches`.
- Bumped the SQLite schema version to `11`.

### Notes

- `npm run build` passes.
- `npm run lint` passes.

## [0.9.6] - 2026-05-02

### Added

- A dedicated Monitoring workspace that rolls all monitored devices and targets into one operational view, with filters, recent results, and per-device or global check actions.
- Support for documenting `virtual` VM interfaces and building VM-friendly port templates, including the built-in `2x VirtIO VM` template.
- Better best-effort discovery enrichment that now tries additional hostname and MAC lookup paths when plain reverse DNS is not enough.

### Changed

- Port modeling is now more accurate for switches, firewalls, servers, and VMs: access ports use a single access VLAN, while trunk ports can document multiple tagged VLANs plus an optional native VLAN or no native VLAN at all.
- Port editor, port list, port grid, and device port inspector now surface access/native/tagged VLAN information directly instead of hiding it behind a single VLAN field.
- Discovery inbox rows now show vendor and MAC address separately so review and duplicate checks are easier to trust at a glance.
- Custom port templates now preserve per-port mode so VM, firewall, and trunk-oriented templates can be reused cleanly.

### Schema

- Added `mode` and `allowedVlanIds` to `ports`.
- Bumped the SQLite schema version to `9`.

### Notes

- `npm run build` passes.
- `npm run lint` passes.

## [0.9.5] - 2026-05-02

### Fixed

- Initial admin bootstrap is now atomic, so creating the first account with demo data either completes fully or rolls back cleanly instead of leaving a partial user behind.
- Demo seeding now inserts discovered-device rows using an explicit column list that matches the current SQLite schema, which fixes the broken first-run demo load path.
- Successful bootstrap and login now redirect to the dashboard instead of dropping the user back onto whichever protected page was open underneath the auth screen.

### Changed

- The bootstrap screen now labels its secondary action `Go to sign in` instead of `Recheck server state`, which better matches what the action actually does after first-run state changes.
- Bootstrap failures now return a clearer message when demo-data setup does not complete, making it obvious that no partial changes were saved.

### Notes

- `npm run build` passes.
- `npm run lint` passes.

## [0.9.4] - 2026-05-02

### Added

- A much richer demo seed that now spans multiple labs, room tech, a detached office rack, additional compute examples, discovery inbox states, custom port templates, and multi-target monitor examples.
- Demo wireless data for a second lab so lab switching feels real across WiFi, inventory, compute, and IPAM workflows.
- Trusted proxy, trusted host, and trusted origin environment controls for harder production deployments.
- Copy-paste reverse proxy examples for both Caddy and Nginx in the new `deploy/` directory.

### Changed

- Docker compose now runs the app with a read-only root filesystem plus a `/tmp` tmpfs while keeping SQLite persistence on `/data`.
- Bootstrap copy now explains that the demo install includes multiple labs, monitoring, discovery, compute, and WiFi examples.
- User-account security is tighter: password changes and account disables now invalidate active sessions, and login/bootstrap/logout events are written to the audit log.

### Security

- Rackpad now rejects production requests whose `Host` header is outside the configured trusted host list.
- Rackpad now rejects production browser requests whose `Origin` header is outside the configured trusted origin list.
- API responses now carry `Cache-Control: no-store`, and the app sends a baseline `Content-Security-Policy` header by default.

### Notes

- The SQLite schema version remains `8`.
- `npm run build` passes.
- `npm run lint` passes.

## [0.9.3] - 2026-05-02

### Added

- First-class WiFi entities for controllers, SSIDs, AP metadata, radios, and explicit client associations.
- A controller-aware WiFi workspace that shows which AP, SSID, radio band, and channel each wireless client is using.
- WiFi CRUD flows for documenting controller records, SSIDs, AP metadata, radios, and client links from the app UI.
- Demo WiFi data with a real controller, two APs, multiple SSIDs, and client telemetry so the wireless workspace is populated on first-run demo installs.

### Changed

- Wireless clients are no longer modeled only as generic parent-child links; they can now carry explicit SSID, radio, band, channel, signal, and roam timing data.
- Access points can now be associated with a controller and documented with firmware and physical location notes.
- Backup export and restore now preserve the full WiFi model, including controller records, SSIDs, radios, radio-to-SSID mappings, and client associations.

### Schema

- Added `wifiControllers`, `wifiSsids`, `wifiAccessPoints`, `wifiRadios`, `wifiRadioSsids`, and `wifiClientAssociations`.
- Bumped the SQLite schema version to `8`.

### Notes

- `npm run build` passes.
- `npm run lint` passes.

## [0.9.2] - 2026-05-02

### Added

- SMTP/email notification delivery alongside the existing Discord and Telegram channels.
- Admin UI fields for SMTP host, port, TLS mode, credentials, sender identity, and multi-recipient delivery.
- A test-send action that exercises the currently configured notification channels and records the result in the audit log.
- A recent alert-activity view in the admin area backed by alert-related audit entries.

### Changed

- Alert settings now support separate controls for down alerts, recovery alerts, and repeat reminders while a target stays offline.
- Monitor transitions now persist the last successful alert timestamp so Rackpad can throttle repeat reminders instead of spamming every monitor pass.
- Alert payloads now include the monitor target name across Discord, Telegram, and email delivery so multi-target outages are easier to understand.
- Backup export and restore now preserve the richer alert settings and per-monitor alert timing state.

### Schema

- Added `lastAlertAt` to `deviceMonitors`.
- Bumped the SQLite schema version to `7`.

### Notes

- Added runtime dependency `nodemailer` and dev dependency `@types/nodemailer`.
- `npm run build` passes.
- `npm run lint` passes.

## [0.9.1] - 2026-05-02

### Added

- Multi-target device monitoring so a single device can track separate management IPs, service ports, storage NICs, or VIPs instead of being limited to one health-check endpoint.
- A target list and editor on the device detail page for creating, naming, selecting, running, and deleting multiple monitor definitions per device.
- A `V1_CHECKLIST.md` roadmap file that breaks the remaining `1.0` work into concrete milestones, acceptance criteria, and release gating checks.

### Changed

- Device monitoring now rolls up overall device status from all enabled targets, which lets one host show a clean aggregate `online`, `offline`, or `unknown` state while preserving per-target detail.
- Monitor alerts now include the monitor target name so outage and recovery notifications are easier to interpret on multi-homed or multi-service devices.
- Backup restore now understands the richer monitor schema and preserves monitor names and ordering.

### Schema

- Reworked `deviceMonitors` into a one-to-many table by removing the one-monitor-per-device uniqueness assumption.
- Added `name` and `sortOrder` columns to `deviceMonitors`.
- Bumped the SQLite schema version to `6`.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- This is the first `v1.0` runway release; SMTP alerts, controller-aware WiFi, demo expansion, and additional security/deploy hardening are tracked in `V1_CHECKLIST.md`.

## [0.9.0] - 2026-05-02

### Added

- Optional structured device capacity fields for CPU cores, memory, storage, and freeform specs so hosts, servers, and VMs can be documented more realistically.
- Compute workspace capacity meters that compare documented host capacity to the total assigned VM capacity per host.
- Admin-configurable monitor notifications with Discord webhook and Telegram delivery, including a built-in test action.
- Discovery enrichment with MAC-address capture, basic vendor lookup, and a direct `Link existing` action for duplicate matches instead of forcing a duplicate import.
- A shared color picker with preset dropdowns and manual hex entry for cable and VLAN-range colors.

### Changed

- Device detail pages now surface capacity/spec fields directly and show child-allocation summaries for hosts with linked guests.
- Discovery rows and inspectors now expose vendor and MAC details when Rackpad can resolve them from ARP data on the server or container.
- The UI shell is softer and less blocky, with rounder radii, smoother button treatment, richer background atmosphere, and gentler elevation.
- Backup export and restore now include admin app settings so alert configuration survives rebuilds and test resets.

### Security

- Added login/bootstrap rate limiting to reduce password and bootstrap brute-force attempts.
- Added baseline production response hardening headers such as `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- Hardened the Compose deployment slightly with `init: true` and `no-new-privileges`.

### Schema

- Added `cpuCores`, `memoryGb`, `storageGb`, and `specs` columns to `devices`.
- Added `macAddress` and `vendor` columns to `discoveredDevices`.
- Added an `appSettings` table for persisted admin-level app configuration such as alert destinations.
- Bumped the SQLite schema version to `5`.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- Multi-IP monitoring per device is still deferred beyond `0.9.0`; the current release keeps one monitor target per device to avoid destabilizing the existing health-check model right before the `1.0` push.
- Linux/Docker runtime soak testing is still the next real validation step for this release because this Windows machine is not the final `better-sqlite3` runtime target.

## [0.8.0] - 2026-05-02

### Added

- A dedicated `Compute` workspace for virtualization hosts and VMs, including per-host guest listings and an unassigned-VM queue.
- Fast VM creation flows that can start from the compute workspace globally or directly from a specific host card.
- Duplicate awareness in the discovery inbox so scanned devices can be compared against existing inventory by management IP and hostname before import.
- Discovery summary cards and filter shortcuts for `new`, `duplicates`, `imported`, and `dismissed` records.

### Changed

- The sidebar now includes a direct `Compute` workspace alongside the existing WiFi and Discovery views.
- Discovery rows now show whether a scanned host already appears to exist in inventory, instead of treating every reachable host as a clean new record.
- The discovery inspector now links duplicate candidates so you can review existing devices before importing anything new.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- This release improves operator workflow rather than the underlying discovery probe itself; discovery is still ICMP plus reverse-DNS enrichment, not SNMP or agent-based inventory.

## [0.7.0] - 2026-05-02

### Added

- Device placement modes for `rack`, `room`, `wireless`, and `virtual` inventory so the app can model loose room tech, AP-linked clients, and hosted VMs alongside rack-mounted gear.
- Parent-child device relationships, including AP-to-client links for wireless inventory and host-to-VM links for virtual workloads.
- A dedicated `WiFi` workspace with AP summaries, wireless client counts, and an unassigned-clients section.
- A new discovery inbox with ICMP subnet scanning, reverse-DNS enrichment, review/edit controls, and one-click import into the normal device inventory flow.
- Discovery records in backup export and restore so staged findings survive migrations and test resets.

### Changed

- Device creation and edit flows now expose placement directly and only ask for rack coordinates when the device is actually rack-mounted.
- Device details now show placement context and child relationships so APs and hosts can act as inventory anchors instead of flat standalone records.
- Device lists now describe placement honestly, including loose-room devices, hosted VMs, and wireless clients attached to APs.
- The main sidebar now includes direct navigation to the new WiFi and Discovery workspaces.

### Schema

- Added `placement` and `parentDeviceId` columns to `devices`, plus an index for parent-device lookups.
- Added a new `discoveredDevices` table with per-lab uniqueness on IP address and status indexing for discovery workflows.
- Bumped the SQLite schema version to `4`.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- Discovery scans are intentionally limited to `/24` or smaller IPv4 ranges for now.
- Reverse-DNS and ICMP scan results are best-effort enrichment from the Rackpad server or container; imported devices are still meant to be reviewed before you trust them as final inventory.

## [0.6.3] - 2026-05-02

### Added

- ICMP device monitoring so Rackpad can test plain host reachability without depending on a specific application port being open.
- A clickable port inspector on the device detail page, including port state, speed, face, VLAN, description, and linked cable peer details.
- A dedicated Notes tab on the device detail page so device documentation is easier to read without reopening the edit drawer.

### Changed

- The dashboard now shows aggregate network capacity derived from documented port speeds and link states, instead of a fake traffic chart that looked like live telemetry.
- New monitor setups now default to ICMP when a device has a management IP, which is a better default for homelab reachability checks than assuming TCP port 22.
- The monitoring UI now explains the difference between ICMP reachability, TCP service checks, and HTTP/HTTPS health probes.
- The runtime Docker image now installs `iputils-ping` so ICMP checks work inside the Linux container.

### Fixed

- Device-detail ports are no longer a dead end; clicking a port now surfaces its configuration instead of forcing a context switch to the main ports workspace.
- The app no longer implies that aggregate throughput is measured traffic when Rackpad does not yet collect real telemetry.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- TCP checks still test a specific service from the Rackpad server or container; use ICMP when you only want to know whether the host itself is reachable.

## [0.6.2] - 2026-05-02

### Fixed

- Multi-arch Docker builds now run the full dev-dependency install on the build platform instead of under emulated target architectures, which avoids the flaky `tsx` / `esbuild` `ETXTBSY` failure seen in GitHub Actions during `npm ci`.
- Docker npm cache mounts now use `sharing=locked` so concurrent cache access is less likely to corrupt or race during BuildKit installs.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- This patch is aimed at the GitHub Docker publish pipeline and published image reliability rather than app behavior.

## [0.6.1] - 2026-05-02

### Added

- Real lab management with backend CRUD, a lab switcher in the sidebar, and a dedicated labs page.
- A `Loose / room tech` section in the racks workspace so unracked devices have a first-class home.

### Fixed

- `Add rack` now opens a reliable modal editor instead of dropping into a broken inline state.
- Rack, VLAN range, and subnet creation now use the active lab instead of a stale hard-coded `lab_home` value.
- VLAN-linked subnet creation from the VLAN page now works correctly in restored or newly created labs.
- The IPAM empty-state `Add subnet` flow no longer falls through to a blank page when there are no subnets yet.
- Devices without a rack now display as `Unracked` instead of appearing to have missing placement data.

### Notes

- `npm run build` passes.
- `npm run lint` passes.

## [0.6.0] - 2026-05-01

### Added

- Admin backup restore endpoint and in-app restore flow from the users page.
- Full custom port-template management in the ports page, including create, edit, delete, and clone-from-device actions.
- Database-backed storage for custom port templates so templates survive restart, export, and restore.
- Regression tests for backup restore, custom port templates, VLAN range validation, and IP assignment integrity checks.

### Changed

- Backup export now includes custom port templates, and restore rebuilds users, racks, devices, ports, cables, VLANs, IPAM objects, monitors, audit history, and templates in one pass.
- TCP monitoring now treats `ECONNREFUSED` as host reachable while keeping true network-unreachable errors such as `EHOSTUNREACH` and `ENETUNREACH` offline with clearer server-side messaging.
- Device activity history can now fetch more audit entries on demand instead of being capped by the initial app load.
- Initial app loading now tolerates partial API failures and keeps the data that did load instead of failing all-or-nothing.
- Device creation now filters port templates by device type and clears incompatible template selections when the device type changes.

### Fixed

- `PATCH /api/vlans/ranges/:id` now rejects inverted effective ranges where `startVlan > endVlan`.
- `PATCH /api/ip-zones/:id` now rejects empty `startIp` and `endIp` values with HTTP `400`.
- `PATCH /api/ip-assignments/:id` now rejects empty `ipAddress` values and rejects assignments that do not belong to the selected subnet.
- IP assignment create and patch flows now both enforce subnet membership instead of allowing cross-subnet mismatches.
- Audit-log writes now use the authenticated request user directly instead of relying on a fallback username path.
- Session bootstrap state is cached and refreshed after bootstrap and restore, instead of re-running the bootstrap query on every request.
- Expired API sessions are now purged on startup and on a daily cleanup interval.
- Remaining route-level `Date.now()` identifiers were replaced with `createId(...)`-based IDs for safer concurrent writes.
- `type: "none"` monitor updates now explicitly disable the monitor instead of leaving stale enabled state behind.
- Port delete cleanup no longer does redundant linked-port follow-up work when dropping cable state.

### Schema

- Added schema-version tracking and transactional migrations so new releases can evolve the SQLite database more safely.
- Added the `portTemplates` table for custom templates, plus JSON serialization for template device types and port definitions.
- Added foreign-key indexes for the main device, port, cable, IPAM, and monitoring relationships to improve lookup and delete performance.
- Added a per-lab unique index on VLAN range names so duplicate range names cannot be created inside the same lab.

### Notes

- Backups remain sensitive because they include user records and password hashes; treat exported JSON as a secret.
- `npm run build` passes.
- `npm run lint` passes.
- `npm run test:server` is still blocked on this Windows Node `24.15.0` machine because `better-sqlite3` has no working native binding here.

## [0.5.0] - 2026-05-01

### Added

- First-run bootstrap choice to start with demo data or a clean empty lab.

### Changed

- VLAN UI now speaks more explicitly in terms of VLAN ID ranges.
- VLAN cards now show all linked IP ranges and can create a linked subnet directly from the VLAN page.
- IPAM UI now labels the subnet-to-VLAN relationship more clearly as a linked VLAN.
- Device monitoring now explains that checks run from the Rackpad server or container, not the browser.
- New monitor setups now prefill from a device management IP when one exists.
- Saving an enabled monitor now runs an immediate check so device status does not stay `unknown` until the next interval.
- Compose and example environment defaults now use the lowercase `kobii-git` image owner to avoid Docker reference-format errors.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- `npm run test:server` still needs Linux/Node 22 or Docker to load the `better-sqlite3` native binding.

## [0.4.2] - 2026-05-01

### Fixed

- Restored clean committed copies of `server/index.ts`, `server/routes/audit.ts`, `tsconfig.server.json`, `.gitignore`, and `README.md` after file truncation and NUL-padding corruption.
- Re-synced release metadata so the app version, install guide, compose defaults, and example environment file all point at the same deployable tag.

### Notes

- `v0.4.2` is the first post-recovery tag intended for GitHub and Docker deployment after the truncation issue was cleaned up.
- `npm run build` passes.
- `npm run lint` passes.
- `npm run test:server` still needs Linux/Node 22 or Docker to load the `better-sqlite3` native binding.

## [0.4.1] - 2026-05-01

Pre-deployment static review of all 41 source files. Six bugs found and fixed;
no regressions introduced. First release intended for Docker/Linux deployment.

Commit: `d103f8e`

### Fixed

- Dockerfile runtime stage now copies `package.json` so the admin backup export correctly reports the app version instead of `0.0.0`.
- `PATCH /api/users/:id` no longer accepts `null` for `username` or `displayName`, returning HTTP 400 instead of a NOT NULL constraint 500.
- `PATCH /api/subnets/:id` now rejects a null or empty `cidr` with HTTP 400 instead of a NOT NULL constraint 500.
- `PATCH /api/dhcp-scopes/:id` now rejects null `startIp` or `endIp` with HTTP 400 instead of a NOT NULL constraint 500.
- Error handler now catches `FOREIGN KEY constraint failed` (returns HTTP 422) and `NOT NULL constraint failed` (returns HTTP 400) rather than falling through to a generic 500.
- `GET /api/dhcp-scopes` now returns results in a consistent `ORDER BY subnetId, name` order.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- `npm run test:server` requires Linux/Node 22 or Docker to load the `better-sqlite3` native binding; still blocked on this Windows Node 24 machine.
- Recommended deploy path: `docker compose up --build -d` - verify backup export shows `appVersion: "0.4.1"` as a smoke test.
- Minor observations noted but not changed: `needsBootstrap()` runs a `SELECT COUNT(*)` on every API request (negligible for homelab traffic); ID generation style is inconsistent across routes (cosmetic only); `PORT_KINDS` is duplicated between `ports.ts` and `port-templates.ts` (they match).

## [0.4.0] - 2026-05-01

### Added

- VLAN range create, edit, and delete controls in the frontend.
- Admin-only backup export endpoint at `/api/admin/export`.
- Admin operations UI for downloading a full JSON backup from the users screen.
- Backend test coverage for the admin export workflow and admin-only enforcement.

### Changed

- Frontend routes now lazy-load to reduce the size of the initial app bundle.
- Vite now injects the app version from `package.json` and splits major vendor chunks during build.
- The sidebar version badge now stays in sync with the release version automatically.
- Docker and install defaults now point at `v0.4.0`.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- `npm run test:server` still needs Linux/Node 22 or any environment where `better-sqlite3` can load successfully.

## [0.3.0] - 2026-05-01

### Added

- Authentication bootstrap, login, logout, and persisted API sessions.
- User accounts with `admin`, `editor`, and `viewer` roles.
- Read-only backend enforcement for viewer accounts.
- Port-template support when creating new devices.
- Manual port creation and deletion from the ports screen.
- Rack CRUD in the frontend.
- IPAM CRUD in the frontend for subnets, DHCP scopes, and IP zones.
- Per-device health-check configuration for `tcp`, `http`, and `https` checks.
- Backend tests covering bootstrap/auth, viewer write blocking, device templates, rack overlap validation, and monitoring validation.

### Changed

- Device detail now includes monitoring controls and live monitor runs.
- The app shell now boots through auth before loading inventory data.
- Docker and container health checks now use `/api/health` instead of a protected API route.
- Install and README docs now describe the real first-run bootstrap flow.
- Release version is now `0.3.0`.

### Notes

- `npm run build` passes.
- `npm run lint` passes.
- `npm run test:server` is wired in, but it still cannot run on this Windows Node 24 machine until `better-sqlite3` can load successfully.

## [0.2.0] - 2026-05-01

### Added

- Fastify + SQLite backend with routes for racks, devices, ports, cables, VLANs, IPAM, and audit history.
- API-backed frontend store and bootstrapping flow for loading live data.
- Real device lifecycle actions: create, edit, delete, management IP sync, and IP release.
- Real port and cable management screens, including cable create, edit, inspect, and delete flows.
- Docker deployment, systemd service file, Linux install guide, and Node 22 runtime pinning.

### Changed

- Installation instructions now pull versioned source directly from GitHub instead of assuming a copied local folder.
- Docker defaults now point at the `Kobii-git/Rackpad` repository and the `v0.2.0` release tag.
- Release process expectation is now explicit: future shipped changes should include a version bump and changelog entry.

### Notes

- This was the first versioned GitHub-ready release for Docker and Linux testing.
