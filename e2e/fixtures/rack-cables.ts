import {
  createStarterTemplate,
  templateToResolvedLayout,
  replacePortBlock,
  type PortBlockDefinition,
} from "../../src/lib/hardware-template-builder";
import type {
  Device,
  DevicePhysicalLayout,
  Port,
  PortLink,
  Rack,
  RackFace,
  Room,
} from "../../src/lib/types";

/** Synthetic two-device, 24-cord acceptance fixture; contains no operator data. */
export function rackCableFixture(
  prefix = "routing",
  fromFace: RackFace = "front",
  toFace: RackFace = fromFace,
) {
  const room: Room = {
    id: `${prefix}-room`,
    labId: "lab_home",
    name: `${prefix} room`,
  };
  const rack: Rack = {
    id: `${prefix}-rack`,
    labId: room.labId,
    roomId: room.id,
    name: `${prefix} rack`,
    totalU: 12,
    studioX: 80,
    studioY: 70,
  };
  const devices: Device[] = ["panel", "switch"].map((name, index) => ({
    id: `${prefix}-${name}`,
    labId: room.labId,
    roomId: room.id,
    rackId: rack.id,
    hostname: `${prefix}-${name}`,
    deviceType: index ? "switch" : "patch_panel",
    status: "online",
    placement: "rack",
    rackMountKind: "direct",
    startU: index ? 9 : 10,
    heightU: 1,
    face: "front",
    rackColumn: 0,
    rackColumnSpan: 12,
  }));
  let template = createStarterTemplate(
    "patch-panel",
    `${prefix}-template`,
    `${prefix} template`,
  );
  template.deviceTypes = ["patch_panel", "switch"];
  for (const face of ["front", "rear"] as const) {
    const block = template.portBlueprints.find(
      (entry) => entry.face === face,
    ) as unknown as PortBlockDefinition;
    template = replacePortBlock(template, { ...block, rows: 1, columns: 24 });
  }
  const ports: Port[] = devices.flatMap((device) =>
    template.portSlots.map((slot, index) => ({
      id: `${device.id}-${slot.id}`,
      deviceId: device.id,
      name: slot.label!,
      position: index + 1,
      kind: "rj45",
      face: slot.face,
      mode: "access",
      linkState: "up",
      portRole: "physical",
    })),
  );
  const layouts: DevicePhysicalLayout[] = devices.map((device) => ({
    deviceId: device.id,
    sourceTemplateId: template.id,
    snapshot: templateToResolvedLayout(template),
    effectiveStatus: "accurate",
    portFingerprint: "fixture",
    currentPortFingerprint: "fixture",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    status: "accurate",
    unmappedPortIds: [],
    bindings: ports
      .filter((port) => port.deviceId === device.id)
      .map((port) => ({
        portId: port.id,
        slotId: port.id.slice(device.id.length + 1),
      })),
  }));
  const links: PortLink[] = Array.from({ length: 24 }, (_, index) => ({
    id: `${prefix}-cord-${index + 1}`,
    fromPortId: `${devices[0]!.id}-ports:${fromFace}-${index + 1}`,
    toPortId: `${devices[1]!.id}-ports:${toFace}-${index + 1}`,
    cableType: "Cat6A",
    color: "#22c55e",
    visible: true,
    routeWaypoints: [],
  }));
  return { room, rack, devices, ports, layouts, links, template };
}


/** Approximate public screenshot geometry, with synthetic inventory and links. */
export function rackShelfCableFixture() {
  const base = rackCableFixture("shelves");
  const devices: Device[] = [
    { ...base.devices[1]!, id: "shelves-switch", hostname: "shelf-switch", startU: 7, rackColumn: 7, rackColumnSpan: 4 },
    ...[5, 3, 1].map(u => ({ ...base.devices[1]!, id: `shelves-server-${u}`, hostname: `server-${u}`,
      deviceType: "server", startU: u, rackColumn: 6, rackColumnSpan: 5 })),
    ...[6, 4, 2].map(u => ({ ...base.devices[0]!, id: `shelves-shelf-${u}`, hostname: `shelf-${u}`,
      deviceType: "rack_shelf", startU: u, rackColumn: 7, rackColumnSpan: 4 })),
    { ...base.devices[0]!, id: "shelves-top", hostname: "rack-top-switch", startU: undefined, rackMountKind: "rack-top", rackColumnSpan: 6 },
    { ...base.devices[0]!, id: "shelves-parent", hostname: "vertical-shelf", startU: 1, heightU: 7, rackColumnSpan: 4, deviceType: "rack_shelf" },
    { ...base.devices[1]!, id: "shelves-vertical", hostname: "vertical-ups", placement: "shelf", rackMountKind: "shelf",
      parentDeviceId: "shelves-parent", startU: undefined, shelfX: 50, shelfY: 50, shelfWidth: 850, shelfHeight: 850,
      shelfOrientation: 90, deviceType: "ups" },
  ];
  const ports = devices.flatMap(device => base.ports.filter(port => port.deviceId === base.devices[1]!.id)
    .map(port => ({ ...port, id: `${device.id}-${port.face}-${port.position}`, deviceId: device.id })));
  const layouts = devices.map(device => ({ ...base.layouts[1]!, deviceId: device.id,
    snapshot: { ...base.layouts[1]!.snapshot, faces: templateToResolvedLayout(createStarterTemplate(
      device.deviceType === "server" ? "server-1u" : device.deviceType === "rack_shelf" ? "shelf" : device.deviceType === "ups" ? "ups" : "switch-8",
      `shelves-art-${device.id}`, device.hostname)).faces },
    bindings: ports.filter(port => port.deviceId === device.id).map(port => ({portId: port.id,
      slotId: base.layouts[1]!.bindings.find(binding => base.ports.find(p => p.id === binding.portId)?.position === port.position)!.slotId })) }));
  const endpoint = (deviceId: string, face: RackFace, index: number) => ports.filter(port => port.deviceId === deviceId && port.face === face)[index]!.id;
  const links: PortLink[] = (["front", "rear"] as const).flatMap(face => [5,3,1].map((u,index) => ({
    id: `shelves-${face}-${u}`, fromPortId: endpoint("shelves-switch", face, index),
    toPortId: endpoint(`shelves-server-${u}`, face, 0), color: ["#22c55e", "#60a5fa", "#eab308"][index], visible: true,
  })));
  links.push({ id: "shelves-mixed", fromPortId: endpoint("shelves-top", "front", 5), toPortId: endpoint("shelves-server-1", "rear", 5), color: "#c084fc" });
  return { ...base, devices, ports, layouts, links };
}
