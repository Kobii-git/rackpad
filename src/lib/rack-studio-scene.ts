import type {
  Device,
  DevicePhysicalLayout,
  Port,
  Rack,
  RackFace,
  Room,
} from "./types";
import {
  RACK_STUDIO_CANVAS_HEIGHT,
  RACK_STUDIO_CANVAS_WIDTH,
  RACK_STUDIO_RACK_HEIGHT,
  RACK_STUDIO_RACK_WIDTH,
  devicePlacementState,
  rackCanvasState,
} from "./rack-studio";

export interface RackStudioRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RackStudioSceneEquipment {
  id: string;
  device: Device;
  layout: DevicePhysicalLayout;
  rackId: string | null;
  rackFace: RackFace;
  physicalFace: RackFace;
  mountKind: "direct" | "shelf" | "side" | "loose";
  rect: RackStudioRect;
  rotation: 0 | 90;
}

export interface RackStudioScenePortAnchor {
  portId: string;
  deviceId: string;
  roomId: string | null;
  rackId: string | null;
  rackFace: RackFace;
  physicalFace: RackFace;
  x: number;
  y: number;
}

export interface RackStudioScene {
  bounds: { width: number; height: number };
  rackAreaHeight: number;
  rackPlacementAreaHeight: number;
  tray: RackStudioRect | null;
  equipment: RackStudioSceneEquipment[];
  portAnchors: RackStudioScenePortAnchor[];
}

const RACK_COLUMNS = 5;
const RACK_ROW_HEIGHT = 292;
const RACK_MARGIN = 34;
const TRAY_GAP = 28;
const TRAY_HEADER_HEIGHT = 34;
const TRAY_CARD_WIDTH = 214;
const TRAY_CARD_HEIGHT = 88;
const TRAY_CARD_GAP = 18;
const TRAY_COLUMNS = 4;

function rackFaces(face: RackFace | "both"): RackFace[] {
  return face === "both" ? ["front", "rear"] : [face];
}

export function physicalFaceForRackFace(
  device: Device,
  rackFace: RackFace,
): RackFace {
  const state = devicePlacementState(device);
  if (state.mountKind === "loose") return rackFace;
  return state.face === rackFace ? "front" : "rear";
}

export function rackFaceForPhysicalFace(
  device: Device,
  physicalFace: RackFace,
): RackFace {
  const state = devicePlacementState(device);
  if (state.mountKind === "loose") return physicalFace;
  const mountedFace = state.face ?? "front";
  if (physicalFace === "front") return mountedFace;
  return mountedFace === "front" ? "rear" : "front";
}

export function rackStudioCanvasBounds(
  racks: Rack[],
  looseDeviceCount = 0,
) {
  const automaticRows = Math.max(1, Math.ceil(racks.length / RACK_COLUMNS));
  const automaticBottom =
    RACK_MARGIN +
    (automaticRows - 1) * RACK_ROW_HEIGHT +
    RACK_STUDIO_RACK_HEIGHT +
    RACK_MARGIN;
  const positionedBottom = racks.reduce((bottom, rack, index) => {
    const position = rackCanvasState(rack, index);
    return Math.max(
      bottom,
      (position.y ?? 0) + RACK_STUDIO_RACK_HEIGHT + RACK_MARGIN,
    );
  }, 0);
  const rackAreaHeight = Math.max(
    RACK_STUDIO_CANVAS_HEIGHT,
    automaticBottom,
    positionedBottom,
  );
  const rackPlacementAreaHeight = Math.max(
    RACK_STUDIO_CANVAS_HEIGHT,
    automaticBottom,
  );
  if (looseDeviceCount === 0) {
    return {
      width: RACK_STUDIO_CANVAS_WIDTH,
      height: rackAreaHeight,
      rackAreaHeight,
      rackPlacementAreaHeight,
      tray: null,
    };
  }
  const rows = Math.ceil(looseDeviceCount / TRAY_COLUMNS);
  const trayHeight =
    TRAY_HEADER_HEIGHT + rows * TRAY_CARD_HEIGHT + (rows + 1) * TRAY_CARD_GAP;
  const tray: RackStudioRect = {
    x: RACK_MARGIN,
    y: rackAreaHeight + TRAY_GAP,
    width: RACK_STUDIO_CANVAS_WIDTH - RACK_MARGIN * 2,
    height: trayHeight,
  };
  return {
    width: RACK_STUDIO_CANVAS_WIDTH,
    height: tray.y + tray.height + RACK_MARGIN,
    rackAreaHeight,
    rackPlacementAreaHeight,
    tray,
  };
}

function directRect(rack: Rack, rackIndex: number, device: Device) {
  const state = devicePlacementState(device);
  if (state.startU === null || state.heightU === null) return null;
  const canvas = rackCanvasState(rack, rackIndex);
  const frameX = (canvas.x ?? 0) + 20;
  const frameY = (canvas.y ?? 0) + 53;
  const frameWidth = RACK_STUDIO_RACK_WIDTH - 40;
  const frameHeight = 188;
  const height = Math.max(2, (state.heightU / rack.totalU) * frameHeight);
  const bottom =
    frameY +
    frameHeight -
    ((state.startU - 1) / rack.totalU) * frameHeight;
  return {
    x: frameX + ((state.column ?? 0) / 12) * frameWidth,
    y: bottom - height,
    width: ((state.columnSpan ?? 12) / 12) * frameWidth,
    height,
  } satisfies RackStudioRect;
}

function splitRect(rect: RackStudioRect, index: number, count: number) {
  return {
    ...rect,
    x: rect.x + (rect.width / count) * index,
    width: rect.width / count,
  };
}

function addEquipmentFaces(input: {
  target: RackStudioSceneEquipment[];
  device: Device;
  layout: DevicePhysicalLayout;
  rackId: string | null;
  mountKind: RackStudioSceneEquipment["mountKind"];
  rect: RackStudioRect;
  face: RackFace | "both";
  rotation: 0 | 90;
}) {
  const faces = rackFaces(input.face);
  for (const [index, rackFace] of faces.entries()) {
    input.target.push({
      id: `${input.device.id}:${rackFace}`,
      device: input.device,
      layout: input.layout,
      rackId: input.rackId,
      rackFace,
      physicalFace: physicalFaceForRackFace(input.device, rackFace),
      mountKind: input.mountKind,
      rect: splitRect(input.rect, index, faces.length),
      rotation: input.rotation,
    });
  }
}

function portAnchorsForEquipment(
  equipment: RackStudioSceneEquipment[],
  ports: Port[],
) {
  const portById = new Map(ports.map((port) => [port.id, port]));
  const anchors: RackStudioScenePortAnchor[] = [];
  for (const item of equipment) {
    const faceHeight =
      item.layout.snapshot.faces[item.physicalFace].height || 1;
    for (const binding of item.layout.bindings) {
      const port = portById.get(binding.portId);
      const slot = item.layout.snapshot.portSlots.find(
        (candidate) =>
          candidate.id === binding.slotId &&
          candidate.face === item.physicalFace,
      );
      if (!port || !slot) continue;
      const u = (slot.x + slot.width / 2) / 1000;
      const v = (slot.y + slot.height / 2) / faceHeight;
      anchors.push({
        portId: port.id,
        deviceId: item.device.id,
        roomId: item.device.roomId ?? null,
        rackId: item.rackId,
        rackFace: item.rackFace,
        physicalFace: item.physicalFace,
        x:
          item.rotation === 90
            ? item.rect.x + (1 - v) * item.rect.width
            : item.rect.x + u * item.rect.width,
        y:
          item.rotation === 90
            ? item.rect.y + u * item.rect.height
            : item.rect.y + v * item.rect.height,
      });
    }
  }
  return anchors;
}

export function buildRackStudioScene(input: {
  room?: Room;
  face: RackFace | "both";
  racks: Rack[];
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
}): RackStudioScene {
  const layoutByDevice = new Map(
    input.layouts.map((layout) => [layout.deviceId, layout]),
  );
  const rackById = new Map(input.racks.map((rack) => [rack.id, rack]));
  const looseDevices = input.devices
    .filter((device) => {
      const state = devicePlacementState(device);
      return (
        state.mountKind === "loose" &&
        (!input.room || state.roomId === input.room.id)
      );
    })
    .sort(
      (left, right) =>
        left.hostname.localeCompare(right.hostname) || left.id.localeCompare(right.id),
    );
  const bounds = rackStudioCanvasBounds(input.racks, looseDevices.length);
  const equipment: RackStudioSceneEquipment[] = [];
  const directByDevice = new Map<string, RackStudioRect>();

  for (const device of input.devices) {
    const state = devicePlacementState(device);
    const layout = layoutByDevice.get(device.id);
    if (!layout || state.mountKind !== "direct" || !state.rackId) continue;
    const rack = rackById.get(state.rackId);
    if (!rack) continue;
    const rackIndex = input.racks.findIndex((candidate) => candidate.id === rack.id);
    const rect = directRect(rack, Math.max(0, rackIndex), device);
    if (!rect) continue;
    directByDevice.set(device.id, rect);
    addEquipmentFaces({
      target: equipment,
      device,
      layout,
      rackId: rack.id,
      mountKind: "direct",
      rect,
      face: input.face,
      rotation: 0,
    });
  }

  for (const device of input.devices) {
    const state = devicePlacementState(device);
    const layout = layoutByDevice.get(device.id);
    if (!layout || !state.rackId) continue;
    const rack = rackById.get(state.rackId);
    if (!rack) continue;
    const rackIndex = input.racks.findIndex((candidate) => candidate.id === rack.id);
    const canvas = rackCanvasState(rack, Math.max(0, rackIndex));
    if (state.mountKind === "side") {
      addEquipmentFaces({
        target: equipment,
        device,
        layout,
        rackId: rack.id,
        mountKind: "side",
        rect: {
          x:
            (canvas.x ?? 0) +
            (state.side === "right" ? RACK_STUDIO_RACK_WIDTH - 11 : 3),
          y: (canvas.y ?? 0) + 48,
          width: 8,
          height: 198,
        },
        face: input.face,
        rotation: 90,
      });
    } else if (state.mountKind === "shelf" && state.parentDeviceId) {
      const parentRect = directByDevice.get(state.parentDeviceId);
      if (!parentRect) continue;
      const rawWidth = state.shelfWidth ?? 200;
      const rawHeight = state.shelfHeight ?? 200;
      const rotated = state.orientation === 90;
      addEquipmentFaces({
        target: equipment,
        device,
        layout,
        rackId: rack.id,
        mountKind: "shelf",
        rect: {
          x: parentRect.x + ((state.shelfX ?? 0) / 1000) * parentRect.width,
          y: parentRect.y + ((state.shelfY ?? 0) / 1000) * parentRect.height,
          width:
            ((rotated ? rawHeight : rawWidth) / 1000) * parentRect.width,
          height:
            ((rotated ? rawWidth : rawHeight) / 1000) * parentRect.height,
        },
        face: input.face,
        rotation: rotated ? 90 : 0,
      });
    }
  }

  if (bounds.tray) {
    for (const [index, device] of looseDevices.entries()) {
      const layout = layoutByDevice.get(device.id);
      if (!layout) continue;
      const column = index % TRAY_COLUMNS;
      const row = Math.floor(index / TRAY_COLUMNS);
      addEquipmentFaces({
        target: equipment,
        device,
        layout,
        rackId: null,
        mountKind: "loose",
        rect: {
          x:
            bounds.tray.x +
            TRAY_CARD_GAP +
            column * (TRAY_CARD_WIDTH + TRAY_CARD_GAP),
          y:
            bounds.tray.y +
            TRAY_HEADER_HEIGHT +
            TRAY_CARD_GAP +
            row * (TRAY_CARD_HEIGHT + TRAY_CARD_GAP),
          width: TRAY_CARD_WIDTH,
          height: TRAY_CARD_HEIGHT,
        },
        face: input.face,
        rotation: 0,
      });
    }
  }

  const anchors = portAnchorsForEquipment(equipment, input.ports).map(
    (anchor) => ({
      ...anchor,
      roomId:
        anchor.rackId != null
          ? (rackById.get(anchor.rackId)?.roomId ?? anchor.roomId)
          : anchor.roomId,
    }),
  );
  return {
    bounds: { width: bounds.width, height: bounds.height },
    rackAreaHeight: bounds.rackAreaHeight,
    rackPlacementAreaHeight: bounds.rackPlacementAreaHeight,
    tray: bounds.tray,
    equipment,
    portAnchors: anchors,
  };
}

export function buildRackElevationScene(input: {
  rack: Rack;
  rackFace: RackFace;
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  width?: number;
  unitHeight?: number;
}) {
  const width = input.width ?? 1000;
  const unitHeight = input.unitHeight ?? 42;
  const height = input.rack.totalU * unitHeight + 16;
  const layoutByDevice = new Map(
    input.layouts.map((layout) => [layout.deviceId, layout]),
  );
  const equipment: RackStudioSceneEquipment[] = [];
  const directByDevice = new Map<string, RackStudioRect>();
  const rackDevices = input.devices.filter(
    (device) => device.rackId === input.rack.id,
  );

  for (const device of rackDevices) {
    const state = devicePlacementState(device);
    const layout = layoutByDevice.get(device.id);
    if (
      !layout ||
      state.mountKind !== "direct" ||
      state.startU === null ||
      state.heightU === null
    ) {
      continue;
    }
    const topU = Math.min(
      input.rack.totalU,
      state.startU + state.heightU - 1,
    );
    const rect = {
      x: ((state.column ?? 0) / 12) * width,
      y: (input.rack.totalU - topU) * unitHeight + 9,
      width: ((state.columnSpan ?? 12) / 12) * width,
      height: state.heightU * unitHeight - 2,
    };
    directByDevice.set(device.id, rect);
    addEquipmentFaces({
      target: equipment,
      device,
      layout,
      rackId: input.rack.id,
      mountKind: "direct",
      rect,
      face: input.rackFace,
      rotation: 0,
    });
  }

  for (const device of rackDevices) {
    const state = devicePlacementState(device);
    const layout = layoutByDevice.get(device.id);
    if (!layout) continue;
    if (state.mountKind === "side") {
      addEquipmentFaces({
        target: equipment,
        device,
        layout,
        rackId: input.rack.id,
        mountKind: "side",
        rect: {
          x: state.side === "right" ? width - 28 : 0,
          y: 12,
          width: 28,
          height: height - 24,
        },
        face: input.rackFace,
        rotation: 90,
      });
    } else if (state.mountKind === "shelf" && state.parentDeviceId) {
      const parentRect = directByDevice.get(state.parentDeviceId);
      if (!parentRect) continue;
      const rawWidth = state.shelfWidth ?? 200;
      const rawHeight = state.shelfHeight ?? 200;
      const rotated = state.orientation === 90;
      addEquipmentFaces({
        target: equipment,
        device,
        layout,
        rackId: input.rack.id,
        mountKind: "shelf",
        rect: {
          x: parentRect.x + ((state.shelfX ?? 0) / 1000) * parentRect.width,
          y: parentRect.y + ((state.shelfY ?? 0) / 1000) * parentRect.height,
          width:
            ((rotated ? rawHeight : rawWidth) / 1000) * parentRect.width,
          height:
            ((rotated ? rawWidth : rawHeight) / 1000) * parentRect.height,
        },
        face: input.rackFace,
        rotation: rotated ? 90 : 0,
      });
    }
  }

  return {
    width,
    height,
    equipment,
    portAnchors: portAnchorsForEquipment(equipment, input.ports),
  };
}
