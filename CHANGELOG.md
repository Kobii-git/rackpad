# Changelog

All notable Rackpad changes should be recorded here.

Rackpad uses semantic versioning and Git tags in the form `vX.Y.Z`.

## [Unreleased]

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
