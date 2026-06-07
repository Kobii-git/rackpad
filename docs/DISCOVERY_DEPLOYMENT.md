# Discovery deployment (Proxmox / LXC / Docker)

Rackpad discovery uses ICMP reachability plus optional layer-2 MAC collection
(ARP/neighbor tables, `arp-scan`, or `nmap`). Bridge-networked containers often
**cannot see client MAC addresses** on routed or host-only VLANs.

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
| `NET_BIND_SERVICE` | SNMP trap listener on UDP 1162 (non-root) |

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

## Preflight in the UI

When a scan completes with reachable hosts but **zero MAC addresses**, the
Discovery page shows a warning diagnostic (`mac-unavailable`) explaining bridge
networking, Docker Desktop, VPNs, and missing capabilities.

## Related docs

- [SNMP implementation plan](./SNMP_IMPLEMENTATION_PLAN.md) — polling/traps scope
- Main [README](../README.md) — general install
