# Discovery deployment (Proxmox / LXC / Docker)

Rackpad discovery uses ICMP reachability plus optional layer-2 MAC collection
(ARP/neighbor tables, `arp-scan`, or `nmap`). Bridge-networked containers often
**cannot see client MAC addresses** on routed or host-only VLANs.

For the Discovery workflow itself, including manual scans, scheduled scans,
review-first inbox behavior, and current `/24` scan limits, see the
[Discovery guide](./DISCOVERY.md).

## When to use host networking

Use the host-network compose override (or equivalent) when:

- Discovery runs inside **Proxmox LXC** or Docker without layer-2 visibility
- **MAC addresses** are always empty after scans but hosts are reachable
- You scan **local subnets/VLANs** that are not bridged into the container

Set `network_mode: host` (Compose) so Rackpad shares the host network namespace.

## Linux capabilities

| Capability | Typical need |
|------------|----------------|
| `NET_RAW` | ICMP ping, raw ARP/neighbor reads |
| `NET_ADMIN` | Some ARP-scan / interface operations |

UDP 1162 is not a privileged port, so the native Rackpad service does not need
`NET_BIND_SERVICE` for its SNMP trap listener.

Example Compose snippet:

```yaml
services:
  rackpad:
    network_mode: host
    cap_add:
      - NET_RAW
      - NET_ADMIN
    init: true
    # user: root  # only if your image requires raw socket access
```

## First-party native LXC modes

The pre-release native LXC deployment starts in safe mode and provides a
root-only control:

```bash
/usr/local/sbin/rackpad-discovery-mode status
/usr/local/sbin/rackpad-discovery-mode safe
/usr/local/sbin/rackpad-discovery-mode advanced
```

Safe mode uses only the neighbor cache and clears service capabilities.
Advanced mode preflights the outer LXC capability boundary and a raw packet
socket before granting only `CAP_NET_RAW` and `CAP_NET_ADMIN` through a systemd
drop-in. If the unprivileged LXC blocks either capability, the command refuses
the switch. It does not convert the LXC, edit Proxmox configuration, or weaken
the boundary silently.

SNMP traps are controlled separately by `SNMP_TRAP_ENABLED` and remain disabled
by default. Enabling them also requires an explicit UDP 1162 rule in every
applicable Proxmox, guest, and network firewall. See the
[native LXC operations guide](./PROXMOX_NATIVE_LXC.md) for the complete
procedure and current pre-release status.

## Preflight in the UI

When a scan completes with reachable hosts but **zero MAC addresses**, the
Discovery page shows a warning diagnostic (`mac-unavailable`) explaining bridge
networking, Docker Desktop, VPNs, and missing capabilities.

## Related docs

- [Discovery guide](./DISCOVERY.md) — manual and scheduled scans
- [Docker network discovery](./DOCKER_DISCOVERY.md) — host networking compose
- [SNMP implementation plan](./SNMP_IMPLEMENTATION_PLAN.md) — polling/traps scope
- Main [README](../README.md) — general install
