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
  Room,
} from "../../src/lib/types";

/** Synthetic two-device, 24-cord acceptance fixture; contains no operator data. */
export function rackCableFixture(prefix = "routing") {
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
    fromPortId: `${devices[0]!.id}-ports:front-${index + 1}`,
    toPortId: `${devices[1]!.id}-ports:front-${index + 1}`,
    cableType: "Cat6A",
    color: "#22c55e",
    visible: true,
    routeWaypoints: [],
  }));
  return { room, rack, devices, ports, layouts, links, template };
}
