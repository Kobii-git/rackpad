# Rackpad V1 Checklist

This file tracked the work required for `v1.0.0`.

Rackpad `v1.0.0` is now released. Keep this file as a record of the pre-1.0 scope and use future release notes or roadmap documents for post-1.0 planning.

## Release goal

Rackpad `v1.0.0` should be:

- feature-complete for core homelab inventory and monitoring
- polished enough that demo data shows the full product clearly
- safe enough to self-host behind a reverse proxy without "early alpha" caveats
- validated in Linux and Docker, not just by local Windows build/lint checks

## Milestones

### `v0.9.1` Multi-target monitoring

Status: `done`

- Support multiple monitor targets per device
- Allow naming targets like `Management`, `Storage`, `WAN`, `VIP`, or `SSH`
- Keep a rolled-up device status based on enabled targets
- Preserve monitor names/order through backup and restore

Acceptance:

- A server or firewall can track multiple NICs or services at once
- A single failed target does not erase visibility of the others
- The device detail page shows both per-target results and overall device health

### `v0.9.2` Email notifications

Status: `done`

- Add SMTP/email delivery beside Discord and Telegram
- Support sender address, host, port, auth, TLS mode, and recipients
- Add test-send from the admin UI
- Support down and recovery notifications
- Support optional repeat reminders while a target stays offline
- Show recent alert activity from the admin UI

Acceptance:

- An admin can configure and test email alerts from the app
- Monitor notifications can be sent to Discord, Telegram, or SMTP
- Alert settings survive backup/restore and redeploys
- Repeated offline reminders are throttled instead of firing every monitor interval

### `v0.9.3` Controller-aware WiFi

Status: `done`

- Add first-class WiFi entities for controllers, SSIDs, AP radios, and clients
- Track SSID, band, channel, signal, and last-seen client telemetry when known
- Associate wireless clients with APs and SSIDs instead of only generic parent-child device links

Acceptance:

- The WiFi workspace can answer which AP and SSID a client belongs to
- APs expose radio/band/channel context
- Demo data shows multiple APs, SSIDs, and wireless clients across more than one band

### `v0.9.4` Demo expansion and release hardening

Status: `done`

- Expand demo data to showcase every major feature in a believable environment
- Add multi-NIC servers, firewalls, APs, SSIDs, wireless clients, hosts, VMs, discovery findings, alerts, custom port templates, room tech, and multiple labs
- Add trusted-origin/trusted-host config
- Tighten reverse-proxy deployment guidance for TLS and secure headers
- Review audit/session behavior after the monitoring and WiFi changes settle

Acceptance:

- A fresh demo install makes every major page feel populated and understandable
- Reverse-proxy guidance is copy-paste usable for Nginx or Caddy
- Public-release docs clearly explain the safe deployment shape

### `v1.0.0-rc1` Soak candidate

Status: `done`

- Run Linux/Docker soak testing for:
  - bootstrap with demo data
  - bootstrap without demo data
  - rack/device/IPAM flows
  - multi-target monitoring
  - alert delivery
  - discovery import/link flows
  - WiFi relationships
  - backup and restore
- Fix any runtime-only issues found during the soak pass

Acceptance:

- The release candidate survives repeated redeploys and restores cleanly
- No major workflow depends on local manual data repair
- Docs match the real runtime behavior

## Cross-release quality gates

These were required before `v1.0.0`:

- `npm run build` passes
- `npm run lint` passes
- Linux/Docker validation is completed on the release candidate
- Demo data covers all first-class product areas
- Monitoring, alerts, WiFi, and backup/restore are all exercised end to end

## Explicitly post-1.0

These are valuable, but they should not block `v1.0.0`:

- OPNsense integrations
- SNMP and controller API integrations beyond the first polished WiFi model
- rack/cable visualizer
- Proxmox or hypervisor sync
- WhatsApp alerts
- advanced scheduled discovery automation

## Notes for future passes

- Prefer incremental releases with a clear schema/version bump instead of one huge late merge.
- Keep the demo dataset honest: it should demonstrate real relationships, not synthetic filler.
- Any new public-release feature should include backup/restore compatibility and changelog coverage.
