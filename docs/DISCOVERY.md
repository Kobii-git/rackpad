# Discovery

Rackpad discovery scans a CIDR from the Rackpad server, records reachable hosts
in a review inbox, and lets you decide which rows become inventory devices. It
does not auto-import scheduled scan results.

## Manual scans

Open `Discovery` and choose one of these targets:

- an IPAM subnet
- all IPAM subnets
- a manually entered CIDR

Rackpad uses ICMP reachability and best-effort enrichment from reverse DNS,
neighbor tables, `arp-scan`, or `nmap` when those are available in the runtime.
Gateway, DNS, reserved, infrastructure, imported, and dismissed rows are kept
out of the normal active queue where possible.

## Scheduled scans

Scheduled scans keep selected CIDRs refreshed without an external cron job.

From the `Scheduled scans` panel you can:

- add one schedule for an IPAM subnet or manual CIDR
- set the interval in minutes
- enable or pause the schedule
- run the schedule immediately
- delete the schedule

Schedules are per lab. They reuse the same scan path as manual discovery and
write results to the normal review inbox. They do not automatically import,
link, or delete devices.

Manual and scheduled scans share one bounded queue. Rackpad runs two scans
globally and one per lab by default, with up to 32 waiting jobs. Override these
limits with `DISCOVERY_SCAN_MAX_ACTIVE`,
`DISCOVERY_SCAN_MAX_ACTIVE_PER_LAB`, and `DISCOVERY_SCAN_MAX_QUEUED`. A full
queue returns HTTP 429 instead of starting unbounded subprocesses.

## Current scan limits

Manual and scheduled scans handle `/24` and smaller CIDRs directly. Larger
CIDRs are expanded into `/24` chunks, up to 16 chunks per run, so `/20` is the
largest accepted discovery range. Rackpad still scans every usable host in the
original accepted CIDR. Split anything larger into smaller scheduled or manual
scans.

Rackpad does not currently provide a long-lived discovery API token for external
schedulers. Use the built-in schedule list for this workflow.

## Docker, LXC, and MAC visibility

ICMP reachability can work even when MAC addresses are unavailable. MAC capture
depends on where Rackpad runs:

- Docker bridge networking may hide local layer-2 data.
- Docker Desktop, VPNs, and routed VLANs often prevent ARP/MAC collection.
- Proxmox LXC deployments may need host networking and Linux capabilities for
  ARP-style tools.

If scans find reachable hosts but no MAC addresses, review the deployment
guides:

- [Discovery deployment](./DISCOVERY_DEPLOYMENT.md)
- [Docker network discovery](./DOCKER_DISCOVERY.md)

## Backup and restore

Admin backups include scheduled discovery scans. Restoring a backup restores the
schedule list along with the normal discovery inbox and inventory data.
