# Controller integrations

Rackpad can connect directly to Proxmox VE, UniFi Network, TP-Link Omada,
OPNsense, and Dockhand and pull live inventory over their HTTP APIs: devices,
VLANs, networks/subnets, DHCP ranges, and containers. Everything stays
review-first — a pull produces a preview diff against the active lab, and
nothing is written until an administrator applies it.

The panel lives in **Imports → Integrations**.

## Requirements

- `RACKPAD_SECRET_KEY` must be set on the server before connections can be
  saved. Credentials are encrypted at rest with AES-256-GCM using the same
  key that protects SNMPv3 credentials (`openssl rand -hex 32` generates a
  good value). Rotating the key invalidates stored secrets — re-enter them
  after a change.
- The Rackpad server (or container) must be able to reach the controller on
  the LAN. Requests are DNS-pinned and refuse loopback, link-local, and other
  reserved destinations, the same policy as HTTP monitors.
- Self-signed controllers work: untick **Verify TLS certificate** on the
  connection. Prefer installing a trusted certificate where you can.

## Per-provider setup

### Proxmox VE

1. Create an API token: Datacenter → Permissions → API Tokens, e.g.
   `rackpad@pam!inventory` with **Privilege Separation** enabled.
2. Give the token read access: Permissions → Add → API Token Permission,
   path `/`, role `PVEAuditor`, propagate on.
3. In Rackpad, add a Proxmox VE connection with the URL
   (`https://pve.example:8006`), the token ID (`rackpad@pam!inventory`), and
   the token secret.

- **Test** reports the version, cluster name, node list, and workload counts.
- **Pull inventory** previews bridge/VLAN-interface subnets and Proxmox SDN
  vnets/subnets (including SDN DHCP ranges) for IPAM, plus a read-only list
  of nodes, VMs, containers, and bridges.
- **Stage import** fetches the full node inventory over the API in the same
  format as `collect-proxmox.sh` and stages it in the Proxmox import wizard
  below — the same host mapping, VM/container review, virtual switch, port,
  VLAN, and IP handling as a file upload, no shell access required. For
  clusters, pick the node to stage; run once per node.

### UniFi Network

Two auth options:

- **API key** (recommended, UniFi OS consoles / Network 9+): create a key
  under Settings → Control Plane → Integrations, and use the console URL
  (`https://unifi.example`). Networks/VLANs over this API need Network 10+;
  on 9.x Rackpad imports devices and tells you to use username/password for
  networks.
- **Username / password**: a local view-only admin works against both UniFi
  OS consoles and classic self-hosted controllers (`https://host:8443`).
  Rackpad detects the flavor automatically and only issues read-only calls.

Pulls map corporate/VLAN-only networks to VLANs and subnets, DHCP server
ranges to preview-only scopes, and list switches, APs, and gateways with
model, MAC, IP, state, and firmware. WAN and VPN networks are excluded from
IPAM. The optional **Site** field selects a site by name or id.

### TP-Link Omada

1. Controller v5.15+ (software controller or OC300; the OC200 does not
   support the Open API).
2. Create an Open API client: Global View → Settings → Platform Integration →
   Open API → Add New App, mode **Client Credentials**, role **Viewer**.
3. Add the connection with the controller URL (`https://omada.example:8043`),
   the Client ID, and the Client Secret. The `omadacId` is discovered
   automatically.

Pulls map LAN networks/interfaces to VLANs and subnets, DHCP server ranges to
preview-only scopes, and list switches, gateways, and APs per site.

### OPNsense

1. Create an API key: System → Access → Users → (user) → API keys. A
   dedicated user with only the relevant read privileges (or Viewer-style
   access) is recommended.
2. Add the connection with the firewall URL and the key/secret pair.

Pulls map VLAN definitions and interface IPv4 networks to VLANs and subnets,
and Kea DHCPv4 pools plus Dnsmasq ranges to preview-only scopes. Legacy ISC
dhcpd does not expose its ranges over the API — Rackpad warns instead of
silently omitting them. Both pre- and post-25.7 API URL casings are handled.

### Dockhand

1. Dockhand v1.0.25+ with authentication enabled. Generate an API token on
   your profile page (Profile → API tokens → Generate API token; local users
   re-enter their password).
2. Add the connection with the Dockhand URL (`http://dockhand.example:3000`
   by default — Dockhand usually sits behind a reverse proxy if you use
   HTTPS) and the `dh_...` token as the API key.
3. The optional environment field limits the pull to a single Dockhand
   environment by name or id; the default pulls all of them.

Pulls list each Docker environment as a host (online state, running/total
containers, stacks), every container (image, IP, state/health, compose
stack), and Docker networks with their drivers and subnets. Container
plumbing is deliberately kept out of IPAM — Docker networks appear as
read-only previews only. Offline environments are skipped with a warning
rather than reported as empty. On the free edition any valid token has admin
scope, so treat Dockhand tokens with the same care as the other credentials.

## Mixed environments (Omada/UniFi + OPNsense)

When VLANs live on the switching controller but networks terminate at the
firewall, use the per-connection pull toggles so each source owns what it
terminates:

- Switch controller connection: **Pull VLANs** on, subnets/DHCP off.
- OPNsense connection: **Pull subnets** and **Pull DHCP** on, VLANs off.

The preview reconciles both sources against IPAM by VLAN id and CIDR, so the
same VLAN or subnet reported by two controllers never creates duplicates, and
skipped record kinds are called out in the preview warnings.

## What runs automatically vs. manually

- **Automatic (background):** connection status. Every
  `INTEGRATION_STATUS_SYNC_INTERVAL_MS` (default 5 minutes, `0` disables)
  Rackpad re-runs each enabled connection's lightweight test call and updates
  the status badge, product/version summary, and last error on the
  Integrations panel. Disabled connections are skipped. Docker/Portainer
  container *status* refresh has its own loop
  (`DOCKER_STATUS_SYNC_INTERVAL_MS`).
- **Automatic (opt-in): scheduled inventory sync.** See below.
- **Manual (default):** inventory. Pulling VLANs, subnets, DHCP ranges, and
  device previews — and applying them to IPAM — is a human action behind the
  review diff unless an administrator explicitly schedules a connection.

## Scheduled auto-sync (opt-in)

The **Auto-sync** tab on the Integrations panel schedules inventory sync per
connection. It is off by default and only administrators can configure it,
because scheduled runs write without a per-run review.

- **Schedule:** pick a basic preset (every 15/30 minutes, hourly, every
  6 hours, daily, weekly) or switch to **Custom cron (advanced)** for a
  five-field cron expression (`minute hour day-of-month month day-of-week`).
  The scheduler ticks once a minute and catches up runs missed by short
  stalls.
- **Mode:**
  - **Merge** adds missing VLANs/subnets only.
  - **Overwrite** adds and updates records to match the controller. Deletes
    are never automatic — removals stay a manual, confirmed decision.
  - **Skip** computes the diff and reports drift without writing anything —
    useful as a change detector.
- **Target labs:** a checkbox multi-select. One connection can populate
  several labs with the same controller data; the default is the
  connection's own lab. The same per-connection VLAN/subnet/DHCP pull
  toggles apply.
- **Errors without instability:** failures are recorded on the connection
  (status badge plus the exact error message in the Auto-sync tab — nothing
  modal) and audited. Consecutive failures back off exponentially (5m, 10m,
  20m, ... capped at 6 hours), runs are strictly sequential, and overlapping
  ticks are skipped, so a dead or slow controller cannot pile up work or
  hammer the network. Saving the schedule again clears the backoff, and
  **Run now** executes the configured sync immediately for testing.

## Safety model

- Preview/apply reuses the SNMP inventory sync engine: **merge** (default)
  only adds missing records; **mirror** also updates and can delete, but
  deletes require an explicit confirmation and are blocked for VLANs/subnets
  that ports, assignments, or DHCP scopes still reference.
- DHCP scopes are preview-only, matching SNMP sync v1.
- Applying requires an administrator; editors can save connections, test, and
  preview. Viewers are read-only.
- All applies are written to the audit log as `integration.sync.*` entries.
- API responses are never trusted blindly: secrets never leave the server,
  list endpoints are size-capped, and connection URLs cannot carry embedded
  credentials.
