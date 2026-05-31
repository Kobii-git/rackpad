# Rackpad 1.5 Beta Issue Map

This tracks the GitHub feedback reviewed for the 1.5 beta branch and what is
implemented in the current beta build.

## Implemented In 1.4 / 1.5 Beta

- #14 Additional Notes: bulk device/port edit, rack and room images, image
  preview/download, cable editing, port deep-linking, dashboard/monitoring
  scrolling, shelf/tray handling, and front/rear rack work were shipped in
  1.4. The 1.5 beta adds a more readable Diagram view, scrollable inspector,
  connected-cable list, and better edge focus.
- #15 Multiple VLAN on same port: resolved by using trunk ports with allowed
  VLANs.
- #16 Discovery auto-map: shipped auto-map for clean discovered hosts, duplicate
  protection, linked-device sync, and IPAM technical-address filtering.
- #17 Shelf/rear visualizer problems: 1.4 separated front/rear and shelf
  devices. 1.5 beta improves the Diagram layout with larger nodes, stacked
  shelf/host child sections, better spacing, and movable saved positions.
- #18 Pyramid/custom schema: 1.4 added Pyramid. 1.5 beta adds the React Flow
  Diagram view as the draw.io-style direction, with draggable nodes, grouped
  sections, minimap, edge highlighting, and better cable inspection.
- #19 Discovery/IPAM gateway: gateway/DNS/reserved technical addresses are now
  recognized during discovery and excluded from active client import.
- #20 Allocate proposing gateway: allocator now blocks gateway/DNS technical
  addresses. DHCP-reservation allocation remains a follow-up.
- #21 IPAM gateway utilization: fixed; gateway/DNS cells are marked reserved in
  utilization.
- #22 Virtual switch on shelf-mounted host: fixed in 1.4.1; physical hosts on
  shelves can own virtual switches.
- #25 IP-like hostname sorting: fixed in 1.5 beta; visualizer sorting now treats
  IP-like hostnames as numeric addresses.
- #26 Discovery endpoint status: 1.5 beta added optional ICMP monitor creation
  when auto-mapping discovered clients.
- #27 Monitoring bulk management: 1.5 beta added selected-device bulk actions to
  enable or disable ICMP monitoring.
- #29 Draw.io-style network schema: started in 1.5 beta with React Flow Diagram
  view. This is the foundation for custom layout and grouped topology work.
- #30 Visualizer inspector too small: 1.5 beta makes the Diagram inspector
  scrollable and adds a connected-cable list for selected devices.
- #33 WiFi AP/SSID visualizer grouping: partially implemented in 1.5 beta for
  Diagram view; wireless clients with associations are grouped by AP and SSID.

## Still Open / Planned

- #20 DHCP reservation workflow: allow allocating inside a DHCP range as a
  reservation instead of a normal static assignment.
- #23 Host-network containers sharing host IP: needs a deliberate network model
  for shared IP assignments and host-mode containers.
- #24 Multiple IPs per device: needs device/port-level IP assignments so
  firewalls, routers, trunks, docker bridges, and virtual IPs can all be
  documented under one device.
- #28 Services per device: intentionally deferred for now.
- #31 Shelf child height greater than 1U: still needs shelf-child sizing rules
  and validation.
- #32 Bulk delete devices and bulk status edit: still planned; needs guardrails
  for linked ports/cables/monitors.
- #34 WiFi port type: still planned; should connect WiFi associations, SSIDs,
  radios, VLAN/IPAM, and endpoint port records.
- #35 SNMP monitoring/traps: larger monitoring feature; likely a separate
  milestone because it affects polling, traps, OIDs, interface state, and
  possible IPAM/VLAN import.
