# Visualizer

The Visualizer is Rackpad's read-only physical topology workspace. It renders
existing inventory records as grouped rack and room zones, then overlays the
documented cable paths between ports.

Open Rackpad -> `Visualizer`.

## What It Shows

- Rack-mounted equipment grouped in the left rack-elevation zone, with racks
  separated into their assigned Rooms.
- Loose, room, shelf, WiFi, hosted VM, and virtual-context devices grouped in
  the right zone with room context.
- Room/loose groups by Room first, then matching IPAM subnet when subnets exist,
  otherwise by device type or virtual host.
- Cable paths from existing `Cables` records, including cable color, type, and length.
- Device health from inventory status and enabled monitor targets.
- Port strips on device cards using the real port order from each device template.
- Direct neighbors, port context, and trace paths in the inspector.

The visualizer does not infer hidden links. Add devices, ports, rack placement,
rooms, IPAM subnets, monitor targets, and cables first for the richest view.

## Controls

- `Health` recolors device stripes by monitor rollup: green online, amber warning, red down, neutral unknown.
- `Trace mode` lets you click two ports and highlights the documented L1 path between them.
- Cable type filter limits the canvas to one cable type.
- Type chips fade non-matching devices and unrelated cables.
- Shift-click type chips to multi-select device types.
- Search matches hostnames, IPs, MACs from discovery, cable color, cable notes, and cable endpoints.
- Click a device to isolate its direct neighborhood.
- Click a cable to highlight both endpoints and inspect metadata.
- Click an empty area to clear the current selection.

## Keyboard Shortcuts

- `/` focuses Visualizer search.
- `Enter` selects the top search match.
- `Up` / `Down` cycles search matches.
- `F` fits both zones to the viewport.
- `R` resets zoom to 100%.
- `1` toggles the health overlay.
- `2` toggles trace mode.
- `Esc` clears selection, exits trace mode, and closes search.

## Pan And Zoom

- Scroll the canvas background to zoom between 50% and 200%.
- Click-drag an empty canvas area to pan.
- Scrollable inspector panes keep normal vertical scrolling.

## Cable Rendering

- Cable color comes from the documented cable color.
- Unknown colors fall back to neutral gray.
- Up links render thicker.
- Unknown, down, or disabled links render as thinner dashed paths.
- Cables between two online devices get a subtle low-contrast dash pulse.
- Hovering or selecting a cable fades unrelated cables and highlights endpoint devices.

## Port Strips

Each device card shows a compact port strip on the right edge:

- Linked ports are filled amber, or the actual cable color when available.
- Unlinked ports are outline-only.
- SFP, SFP+, QSFP, and fiber ports render as slot-like shapes.
- Hover a port for name, kind, speed, link state, VLAN summary, bridge membership, and patched destination.
- In trace mode, click a first port and then a second port to compute the documented path.

## Trace Mode

Trace mode follows documented `PortLink` records across rooms, racks, loose
devices, and hosted VMs. You can trace from `Room A -> Rack 1 -> Switch port 1`
to a port in another room as long as each hop is documented as a cable or
patch-panel handoff. Patch panels also bridge matching front/rear ports with
the same port name and kind. This is read-only: it does not create cables or
modify port records.

If no path exists, Rackpad shows that no documented path was found. Usually this
means one or more cable links or patch-panel pass-through records are missing.

## Empty States

- If no devices exist, the Visualizer shows links to `Racks` and `Cables`.
- If devices exist but no cables are documented, the devices still render and a dismissible banner explains how to add links.
- Loading uses skeleton zone panels instead of a spinner.

## Current Limits

- The Visualizer is a topology map, not an editor.
- It does not scan the network or infer cables automatically.
- It stays on the physical view for now; L2/L3, WiFi, Compute, snapshots, and exports are separate passes.
- SVG rendering is intended for current homelab and small lab datasets. Very large deployments may need future virtualization.
