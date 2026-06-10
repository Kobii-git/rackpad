# Rackpad 1.5 Beta Issue And Comment Map

This tracks the GitHub issues and follow-up comments reviewed for the 1.5 beta
branch. It records what was requested, what Rackpad currently does to address
it, and what remains open.

Reviewed against GitHub issues on 2026-05-31.

## Latest Comment Review

### #14 Additional Notes

- Original request: bulk edit devices/ports, rack and room pictures, larger
  image viewing/downloads, shelf/tray rack documentation, monitoring layout,
  dashboard scrollability, visualizer links, port pane scrolling, cable editing,
  port deep-links, and trace usability.
- Latest comments: dhop90 reported that after rear-device support, visualizer
  device names became too hard to read. They also suggested front/back toggling
  and later posted that their shelf implementation looked good.
- What was done: v1.4 shipped the broad Additional Notes work: bulk edit,
  rack/room reference images, image preview/download, cable editing, port
  deep-links, dashboard/monitoring/ports/visualizer usability fixes,
  shelf/tray support, and front/rear rack handling. The 1.5 beta Diagram pass
  improves name readability with larger cards, more spacing, stacked shelf
  sections, scrollable inspection, and connected-cable lists.
- Still open: the original rack-stack visualizer can still use more polish for
  dense rear/front rack views. The Diagram view is the cleaner path for dense
  topology review.

### #15 Multiple VLAN On Same Port

- Latest comment: M4v3r1cK87 confirmed the issue is resolved by using a trunk
  port type instead of an access port.
- What was done: no code change needed for 1.5; this is documented as an
  existing workflow.

### #16 Discovery Clients Not Auto-Mapped As Devices

- Original request: discovery should turn clients into devices and map them to
  the correct subnet/VLAN context.
- Latest owner reply: v1.4 added Auto-map, duplicate protection, linked-device
  sync, and technical-address filtering.
- What was done: current beta keeps this behavior. Discovery can create
  inventory devices from clean discovered hosts and keep duplicate/technical
  rows out of the normal import path.

### #17 Shelf Devices And Rear Rack Devices In Visualizer

- Original request: shelf devices, rear-mounted devices, and rack/shelf
  connections were confusing or hidden.
- Latest comment: M4v3r1cK87 tested 1.4.1 and said visualizer devices were too
  close together, labels were truncated, shelf children should be visibly
  stacked, and pyramid/custom layout needs manual movement to reduce overlap.
- What was done: v1.4 separated front/rear and shelf devices. The 1.5 beta
  Diagram view adds larger nodes, wider spacing, better edge routing, stacked
  shelf/hosted child sections, selectable edge focus, connected-cable lists, and
  saved draggable node positions. The follow-up Diagram pass also lets a whole
  rack, room, WiFi, shelf, or hosted-device section move as one group.
- Still open: the older grouped rack layout still needs more refinement for
  extremely dense physical views. Shelf child height greater than 1U is tracked
  separately in #31.

### #18 Pyramid View

- Original request: add a pyramid/master-to-endpoint view for dense networks.
- Latest comments: dhop90 was not a fan of the first pyramid output.
  M4v3r1cK87 clarified that the useful version is more like a custom/star or
  draw.io-style layout with manual reordering and grouped VLAN/service areas.
- What was done: v1.4 added Pyramid. The 1.5 beta adds a React Flow Diagram
  view as the better long-term draw.io-style direction, with draggable saved
  positions, grouped sections, minimap, edge highlighting, and inspector
  details. Diagram now also supports device-type filtering and whole-section
  movement, which covers the first pass of custom reordering.
- Still open: VLAN/service grouping inside Diagram is not complete yet.
  Services per device are deferred under #28.

### #19 Discovery And IPAM Gateway

- Original request: discovery was importing gateway/DNS/technical IPs as normal
  clients, dismissed/imported rows stayed visible, and linked duplicate rows did
  not sync from the existing device.
- Latest comment: M4v3r1cK87 later reported another gateway technical IP still
  appeared during reconciliation, asked about IPAM utilization width, WiFi client
  counts, and DHCP pool capacity display.
- What was done: v1.4/v1.5 improve technical-address detection, discovery row
  dismissal/linking, and IPAM utilization handling for gateways, DNS, reserved
  addresses, and DHCP scope usage.
- Still open: the later gateway reconciliation edge case needs another pass if
  it is still reproducible on the 1.5 beta. WiFi client totals and DHCP
  capacity visualization are separate follow-ups.

### #20 Allocate Proposes Gateway IP

- Original request: allocator proposed the DHCP gateway address as available.
- Latest comments: gateway/DNS allocation was confirmed fixed, but
  M4v3r1cK87 asked for allocation inside DHCP scope to create a DHCP reservation
  instead of a static assignment.
- What was done: allocator blocks gateway/DNS technical addresses and marks them
  reserved in utilization.
- Still open: DHCP-reservation allocation toggle/workflow is not implemented
  yet.

### #21 IPAM Gateway Not Reserved In Utilization

- Latest comment: M4v3r1cK87 confirmed gateway/DNS allocation works and the
  issue can be closed.
- What was done: gateway/DNS cells are reserved/occupied in utilization with a
  clearer tooltip.

### #22 Virtual Switch On Shelf-Mounted Raspberry Pi

- Latest comments: M4v3r1cK87 confirmed the 1.4.1 fix works.
- What was done: shelf-mounted physical hosts can own virtual switches/bridges.
  VMs and containers are still blocked from owning bridges.

### #23 Host-Network Containers Sharing Host IP

- Request: host-network Docker containers need to share the host IP without
  being blocked as duplicate assignments.
- Current status: open. Needs a shared-IP/host-network model so containers can
  reference the parent host IP intentionally.

### #24 Multiple IPs Per Device

- Request: a host/firewall/router needs multiple IPs across interfaces, VLANs,
  virtual networks, and gateway addresses.
- Current status: open. Needs device-level and port-level IP assignments so one
  physical device can own multiple documented addresses.

### #25 IP-Like Hostname Sorting

- Latest comment: owner noted the current sorting was text-based and needed a
  fix.
- What was done: 1.5 beta sorts IP-like hostnames and management IPs
  numerically in the visualizer model, so addresses like 192.168.0.3 sort before
  192.168.0.21.

### #26 Discovery Endpoint Status

- Request: discovered endpoints should not all remain Unknown if discovery
  proved they responded.
- What was done: 1.5 beta adds an optional ICMP monitor toggle during discovery
  auto-map. It does not automatically create monitors for every discovered host
  unless selected.

### #27 Monitoring Bulk Management

- Request: bulk enable/disable monitoring for selected devices and choose the
  monitoring service.
- What was done: 1.5 beta adds selected-device bulk actions for enabling and
  disabling ICMP monitoring.
- Still open: broader monitor-type bulk setup beyond ICMP can be extended later.

### #28 Services Per Device

- Request: model services such as DHCP, DNS, VPN, SSH, databases, Grafana,
  syslog, and hosted services per device.
- Current status: intentionally deferred for now. This should be a separate
  feature because it affects device detail, monitoring, dashboard, visualizer,
  and hosted workload modeling.

### #29 Draw.io-Style Network Schema

- Request: build a richer architectural diagram using a graph library such as
  Cytoscape, React Flow, GoJS, or D3, with grouped VLAN/device/service areas.
- What was done: 1.5 beta uses React Flow for the new Diagram view. It includes
  grouped sections, draggable/saved positions, minimap, cable highlighting, and
  direct device/cable inspection. The latest pass adds device-type filters,
  theme-correct zoom controls, group dragging for whole rooms/racks/sections,
  and virtual NIC/vSwitch links in the inspector.
- Still open: more draw.io-like grouping, VLAN coloring, and manual group
  management remain future improvements.

### #30 Visualizer Inspector Too Small

- Request: selected item details and connected cables were cut off in the
  bottom-right inspector with no useful scroll.
- What was done: 1.5 beta makes the Diagram inspector scrollable and shows a
  connected-cable list for selected devices.

### #31 Shelf Child Height Greater Than 1U

- Request: devices assigned to a shelf should be allowed to visually fill more
  than 1U of shelf space.
- Current status: open. Needs shelf-child sizing rules and validation.

### #32 Bulk Delete Selected Devices

- Request: add bulk delete for selected devices and bulk status editing.
- Current status: open. Needs guardrails for linked ports, cables, monitors,
  child devices, and monitored statuses.

### #33 WiFi AP/SSID Section In Visualizer

- Request: show WiFi AP and SSID sections in Visualizer and place clients under
  their documented SSID instead of loose inventory.
- What was done: 1.5 beta partially implements this in the Diagram view by
  grouping wireless client associations by AP and SSID.
- Still open: automatic WiFi port assignment and richer SSID/radio modeling are
  tracked in #34.

### #34 WiFi Port Type

- Request: add WiFi as a port type, link devices to SSID/radio/subnet, and
  auto-assign WiFi ports for discovered WiFi endpoints.
- Current status: open. This should connect WiFi associations, SSIDs, radios,
  VLAN/IPAM, discovery, and endpoint port records.

### #35 SNMP Monitoring And Traps

- Request: add SNMP-based monitoring for device and individual port/interface
  status, with possible future OID-driven VLAN/IPAM discovery.
- **Current status (dev branch, 2026-06):** **Mostly shipped** — Phases 1–5 v1
  are in the 1.6 line, with SNMPv3 traps added in the 1.6.2 beta. See
  [`docs/SNMP_IMPLEMENTATION_PLAN.md`](SNMP_IMPLEMENTATION_PLAN.md) for full
  status and **Outstanding work**.
- **Shipped on dev/beta:** IF-MIB discover/import, SNMPv3 credentials,
  v1/v2c/v3 traps (UDP 1162), port linkState sync, SNMP verified badges,
  VLAN/subnet sync preview/apply (`SNMP_INVENTORY_SYNC=1`).
- **Still outstanding:** pfSense/vendor profile, DHCP scope apply, scheduled
  sync, manual lab validation, Phase 6 scale items.

## Shipped In 1.5 Beta

- React Flow Diagram visualizer foundation.
- Larger readable Diagram cards and improved dense topology spacing.
- Draggable node positions saved per device.
- Whole-section Diagram dragging for racks, rooms, shelves, WiFi groups, and
  hosted-device groups.
- Diagram device-type filters.
- WiFi AP/SSID-aware Diagram grouping for associated wireless clients.
- Shelf/hosted child grouping in Diagram.
- Virtual NIC/vSwitch inspection with links to guest devices and specific NICs.
- Dark-mode Diagram zoom-control color fix.
- Better cable edge routing, edge focus, and selected-node highlighting.
- Scrollable Diagram inspector with connected-cable details.
- IP-like hostname sorting in visualizer.
- Optional ICMP monitor creation during discovery auto-map.
- Bulk ICMP monitor enable/disable for selected devices.
- Improved discovery/IPAM handling for technical addresses and DHCP scope usage.

## Still Planned After 1.5 Beta

- DHCP reservation allocation workflow (#20).
- Shared-IP/host-network container modeling (#23).
- Multiple IP assignments per device/port (#24).
- Services per device (#28).
- Better VLAN/service/group drawing in Diagram (#18, #29).
- Shelf child height greater than 1U (#31).
- Bulk device delete and status edit (#32).
- Full WiFi port type and SSID/radio assignment workflow (#34).
- SNMP monitoring/traps and interface state (#35) — **partial on dev**; see
  [`docs/SNMP_IMPLEMENTATION_PLAN.md`](SNMP_IMPLEMENTATION_PLAN.md).
