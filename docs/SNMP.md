# SNMP monitoring, traps & inventory sync

Rackpad can poll devices over SNMP, receive SNMP traps, reflect interface
link-state, and (optionally) sync VLANs and subnets from network gear into IPAM.

> This is the operator/admin guide. For implementation status, phase tracking, and
> the outstanding backlog, see
> [`SNMP_IMPLEMENTATION_PLAN.md`](./SNMP_IMPLEMENTATION_PLAN.md).

## What you get

- **SNMP monitors** (v1 / v2c / v3) alongside ICMP / TCP / HTTP / HTTPS checks
- **IF-MIB interface monitoring** — per-port link state, with `ifHighSpeed` used to
  fill in a port's speed when it's blank
- **SNMP-verified badges** in Ports, the Dashboard, and the Visualizer
- **Trap receiver** (v1 / v2c) for `linkUp` / `linkDown` with device auto-learn
- **Inventory sync** (opt-in) — preview/apply VLANs and subnets from a device into
  IPAM; DHCP scopes are **preview-only** for now

## Quick start (v2c)

1. Make sure the device has SNMP enabled with a read-only community string.
2. In Rackpad, open **Monitoring** (or a device's **Monitoring** tab) and add a
   monitor of type **SNMP**.
3. Choose version **v2c**, enter the **community** string and the **OID** to check
   (e.g. an `ifOperStatus` OID for a port), pick a match mode, and save.
4. Run the check. The result and any linked port's link-state update on success.

## SNMP versions

### v1 / v2c

A read-only **community** string per monitor. Simple; the community travels in
cleartext, so keep SNMP on a trusted management network.

### v3 (recommended on shared networks)

SNMPv3 adds auth + privacy. Credentials are stored **per lab, encrypted at rest**
(AES-256-GCM):

1. Set `RACKPAD_SECRET_KEY` before storing any v3 credential (see env table).
   Generate one with `openssl rand -hex 32`. Without it, saving v3 credentials
   fails — v1/v2c and the other monitor types still work.
2. Open a device's **Monitoring / SNMP** area and add SNMPv3 credentials
   (security name, auth protocol + key, privacy protocol + key).
3. Create an SNMP monitor that uses v3.

Rotating `RACKPAD_SECRET_KEY` invalidates stored v3 secrets — re-enter them after a
key change.

## Interface monitoring & port link-state

An SNMP monitor can be linked to a specific port via its `ifIndex`. When linked,
poll results (and matching traps) drive the port's link-state badge across Ports,
the Dashboard, and the Visualizer. Discover/import reads IF-MIB so a port's speed
can be auto-filled from `ifHighSpeed` when it isn't set manually.

## Traps

Rackpad runs a UDP trap receiver at startup.

- **Default port: 1162** (unprivileged on purpose, so containers don't need extra
  capabilities). Forward your network's standard **162 → 1162** upstream, or point
  agents directly at 1162.
- **Docker:** publish the port, e.g. `-p 1162:1162/udp` (or use host networking).
- Incoming v1/v2c `linkUp`/`linkDown` traps update the matching monitor/port; an
  unknown source IP is auto-learned to a device when possible. Duplicate traps are
  de-duplicated within ~30s.
- SNMPv3 `linkUp`/`linkDown` traps are supported for authenticated and encrypted
  USM credentials. Map the trap source, device, or SNMP monitor to the matching
  lab credential so Rackpad can validate and decrypt the packet.

Configure with `SNMP_TRAP_ENABLED`, `SNMP_TRAP_PORT`, `SNMP_TRAP_BIND` (see table).
Receiver status is reported on `/api/health` and `/api/snmp-traps/status`.

## Inventory sync (preview / apply)

Off by default. Set `SNMP_INVENTORY_SYNC=1` to enable it, then use the **SNMP sync**
panel on a device's detail page to preview a diff and apply it.

- **Applies:** VLANs and subnets read from the device (Q-BRIDGE VLANs, IP-MIB
  subnets) into the active lab's IPAM.
- **Preview only:** DHCP scopes (apply is on the roadmap).
- **Safety:** sync is a merge/mirror that **never silently deletes** existing
  assignments — review the preview before applying.
- **Profiles:** a generic profile set ships today (Q-BRIDGE VLANs + IP-MIB
  subnets). Vendor-specific profiles (pfSense/OPNsense, UniFi, …) are not in yet.

## Environment variables

| Variable              | Default   | Purpose                                                                                                                          |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `RACKPAD_SECRET_KEY`  | _(unset)_ | Encrypts SNMPv3 credential secrets. Required **only** to store v3 credentials. Use a long random value (`openssl rand -hex 32`). |
| `SNMP_INVENTORY_SYNC` | `0`       | Set `1` to enable VLAN/subnet sync (DHCP preview-only).                                                                          |
| `SNMP_TRAP_ENABLED`   | `1`       | Enable/disable the trap receiver.                                                                                                |
| `SNMP_TRAP_PORT`      | `1162`    | UDP port the trap receiver binds.                                                                                                |
| `SNMP_TRAP_BIND`      | `0.0.0.0` | Interface the trap receiver binds to.                                                                                            |

## Security notes

- Keep SNMP on a trusted management network; prefer v3 where possible.
- Treat community strings as secrets — they are read-only but still grant device
  visibility.
- Store `RACKPAD_SECRET_KEY` outside the repo (env / secrets manager); back it up,
  since losing it makes stored v3 secrets unreadable.

## Current limitations

Not yet available (tracked in the
[implementation plan](./SNMP_IMPLEMENTATION_PLAN.md) → _Outstanding work_):

- pfSense/OPNsense and other vendor-specific profiles
- DHCP scope sync **apply** (preview only today)
- Scheduled/automatic sync
- SNMPv3 **traps**
- `regex` SNMP match mode
