# Controller integrations

Rackpad can connect directly to Proxmox VE, UniFi Network, TP-Link Omada, and
OPNsense and pull live inventory over their HTTP APIs: devices, VLANs,
networks/subnets, and DHCP ranges. Everything stays review-first — a pull
produces a preview diff against the active lab, and nothing is written until an
administrator applies it.

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

## Mixed environments (Omada/UniFi + OPNsense)

When VLANs live on the switching controller but networks terminate at the
firewall, use the per-connection pull toggles so each source owns what it
terminates:

- Switch controller connection: **Pull VLANs** on, subnets/DHCP off.
- OPNsense connection: **Pull subnets** and **Pull DHCP** on, VLANs off.

The preview reconciles both sources against IPAM by VLAN id and CIDR, so the
same VLAN or subnet reported by two controllers never creates duplicates, and
skipped record kinds are called out in the preview warnings.

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
