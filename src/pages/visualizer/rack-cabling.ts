import type {
  Device,
  DevicePhysicalLayout,
  Port,
  PortLink,
  Rack,
  RackFace,
  Room,
} from "@/lib/types";
import {
  devicePlacementState,
  isRackStudioPhysicalDevice,
  rackCanvasState,
} from "@/lib/rack-studio";
import {
  buildRackElevationScene,
  physicalFaceForRackFace,
  type RackStudioRect,
} from "@/lib/rack-studio-scene";
import {
  cableCategoryForPorts,
  defaultCableColor,
} from "@/lib/rack-studio-cables";
import { normalizeColorToCss } from "@/lib/utils";
import type { VisualizerRackFaceMode } from "./types";

export type RackCablingRouteStyle = "smooth" | "orthogonal";

export type RackCablingFallbackReason =
  "missing-layout" | "unavailable-position";

export interface RackCablingEquipment {
  id: string;
  device: Device;
  layout?: DevicePhysicalLayout;
  rackId: string | null;
  rackFace: RackFace;
  physicalFace: RackFace;
  rect: RackStudioRect;
  rotation: 0 | 90;
  fallbackReason: RackCablingFallbackReason | null;
}

export interface RackCablingAnchor {
  portId: string;
  deviceId: string;
  rackId: string | null;
  rackFace: RackFace;
  physicalFace: RackFace;
  x: number;
  y: number;
  kind: "physical" | "loose-handoff" | "handoff";
}

export interface RackCablingFaceFrame {
  face: RackFace;
  x: number;
  y: number;
  width: number;
  height: number;
  equipment: RackCablingEquipment[];
}

export interface RackCablingRackFrame {
  rack: Rack;
  x: number;
  y: number;
  width: number;
  height: number;
  faces: RackCablingFaceFrame[];
}

export interface RackCablingLooseCard {
  device: Device;
  layout?: DevicePhysicalLayout;
  fallbackReason: "missing-layout" | null;
  x: number;
  y: number;
  width: number;
  height: number;
  faces: Array<{
    face: RackFace;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface RackCablingScene {
  room: Room;
  width: number;
  height: number;
  racks: RackCablingRackFrame[];
  looseCards: RackCablingLooseCard[];
  looseTray: {
    x: number;
    y: number;
    width: number;
    height: number;
    expanded: boolean;
    deviceCount: number;
  } | null;
  equipment: RackCablingEquipment[];
  anchors: RackCablingAnchor[];
}

export interface RackCablingRoute {
  link: PortLink;
  path: string;
  color: string;
  label: string;
  from: RackCablingAnchor;
  to: RackCablingAnchor;
  handoffs: RackCablingHandoff[];
}

export interface RackCablingHandoff {
  reason: "cross-room" | "hidden-face" | "unavailable" | "loose-tray";
  endpoint: "from" | "to";
  anchorPortId: string;
  deviceId: string;
  deviceLabel: string;
  portId: string;
  portLabel: string;
  roomId: string | null;
  roomLabel: string | null;
  physicalFace: RackFace;
  fallbackReason?: RackCablingFallbackReason;
}

export interface RackCablingHandoffLabelGeometry {
  id: string;
  linkId: string;
  endpoint: "from" | "to";
  lane: string;
  packingColumn: "left" | "center" | "right";
  anchorX: number;
  anchorY: number;
  x: number;
  y: number;
  textAnchor: "start" | "middle" | "end";
  leaderPath: string | null;
}

export interface RackCablingScope {
  rackIds: Set<string>;
  deviceIds: Set<string>;
  portIds: Set<string>;
  cableIds: Set<string>;
}

export function buildRackCablingScope(
  scene: RackCablingScene,
  routes: RackCablingRoute[],
): RackCablingScope {
  return {
    rackIds: new Set(scene.racks.map((entry) => entry.rack.id)),
    deviceIds: new Set([
      ...scene.equipment.map((item) => item.device.id),
      ...scene.looseCards.map((item) => item.device.id),
      ...scene.anchors.map((anchor) => anchor.deviceId),
    ]),
    portIds: new Set([
      ...scene.anchors.map((anchor) => anchor.portId),
      ...scene.equipment.flatMap((item) =>
        item.fallbackReason && item.layout
          ? item.layout.bindings
              .filter((binding) =>
                item.layout?.snapshot.portSlots.some(
                  (slot) =>
                    slot.id === binding.slotId &&
                    slot.face === item.physicalFace,
                ),
              )
              .map((binding) => binding.portId)
          : [],
      ),
    ]),
    cableIds: new Set(routes.map((route) => route.link.id)),
  };
}

export function rackCablingSelectionIsInScope(
  selection: { kind: "rack" | "device" | "port" | "cable"; id: string } | null,
  scope: RackCablingScope,
) {
  if (!selection) return true;
  if (selection.kind === "rack") return scope.rackIds.has(selection.id);
  if (selection.kind === "device") return scope.deviceIds.has(selection.id);
  if (selection.kind === "port") return scope.portIds.has(selection.id);
  return scope.cableIds.has(selection.id);
}

export const RACK_CABLING_UNIT_HEIGHT = 18;
export const RACK_CABLING_BODY_WIDTH = 320;

const CANVAS_PADDING = 52;
const RACK_HEADER_HEIGHT = 38;
const RACK_GUTTER = 28;
const FACE_GAP = 26;
const RACK_GAP = 104;
const TRAY_GAP = 54;
const TRAY_HEADER_HEIGHT = 42;
const LOOSE_CARD_WIDTH = 268;
const LOOSE_CARD_GAP = 22;
const LOOSE_FACE_HEIGHT = 58;

function facesForMode(mode: VisualizerRackFaceMode): RackFace[] {
  return mode === "both" ? ["front", "rear"] : [mode];
}

function compareRacks(order: string[]) {
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  return (left: Rack, right: Rack) => {
    const leftOrder = orderIndex.get(left.id);
    const rightOrder = orderIndex.get(right.id);
    if (leftOrder != null || rightOrder != null) {
      if (leftOrder == null) return 1;
      if (rightOrder == null) return -1;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    }
    const leftCanvas = rackCanvasState(left);
    const rightCanvas = rackCanvasState(right);
    return (
      (leftCanvas.y ?? 0) - (rightCanvas.y ?? 0) ||
      (leftCanvas.x ?? 0) - (rightCanvas.x ?? 0) ||
      left.name.localeCompare(right.name, undefined, { numeric: true }) ||
      left.id.localeCompare(right.id)
    );
  };
}

function rackTopOffset(rack: Rack, devices: Device[]) {
  const height = devices.reduce((maximum, device) => {
    const state = devicePlacementState(device);
    return state.mountKind === "rack-top" && state.rackId === rack.id
      ? Math.max(maximum, (state.heightU ?? 1) * RACK_CABLING_UNIT_HEIGHT - 2)
      : maximum;
  }, 0);
  return height > 0 ? height + 12 : 0;
}

function fallbackRect(
  rack: Rack,
  device: Device,
  directRects: Map<string, RackStudioRect>,
  rackOffsetY: number,
): RackStudioRect | null {
  const state = devicePlacementState(device);
  const rackHeight = rackOffsetY + rack.totalU * RACK_CABLING_UNIT_HEIGHT + 16;
  const bound = (rect: RackStudioRect): RackStudioRect => {
    const width = Math.max(
      8,
      Math.min(
        RACK_CABLING_BODY_WIDTH,
        Number.isFinite(rect.width) ? rect.width : 8,
      ),
    );
    const height = Math.max(
      8,
      Math.min(rackHeight - 8, Number.isFinite(rect.height) ? rect.height : 8),
    );
    return {
      x: Math.max(
        0,
        Math.min(
          RACK_CABLING_BODY_WIDTH - width,
          Number.isFinite(rect.x) ? rect.x : 0,
        ),
      ),
      y: Math.max(
        0,
        Math.min(rackHeight - height, Number.isFinite(rect.y) ? rect.y : 0),
      ),
      width,
      height,
    };
  };
  if (state.mountKind === "direct") {
    const startU = Math.max(1, Math.min(rack.totalU, state.startU ?? 1));
    const heightU = Math.max(
      1,
      Math.min(state.heightU ?? 1, rack.totalU - startU + 1),
    );
    const topU = Math.min(rack.totalU, startU + heightU - 1);
    const columnSpan = Math.max(1, Math.min(12, state.columnSpan ?? 12));
    const column = Math.max(0, Math.min(12 - columnSpan, state.column ?? 0));
    const rect = bound({
      x: (column / 12) * RACK_CABLING_BODY_WIDTH,
      y: rackOffsetY + (rack.totalU - topU) * RACK_CABLING_UNIT_HEIGHT + 9,
      width: (columnSpan / 12) * RACK_CABLING_BODY_WIDTH,
      height: heightU * RACK_CABLING_UNIT_HEIGHT - 2,
    });
    directRects.set(device.id, rect);
    return rect;
  }
  if (state.mountKind === "rack-top") {
    const height = (state.heightU ?? 1) * RACK_CABLING_UNIT_HEIGHT - 2;
    const columnSpan = Math.max(1, Math.min(12, state.columnSpan ?? 12));
    const column = Math.max(0, Math.min(12 - columnSpan, state.column ?? 0));
    return {
      x: (column / 12) * RACK_CABLING_BODY_WIDTH,
      y: Math.max(0, rackOffsetY - height - 4),
      width: (columnSpan / 12) * RACK_CABLING_BODY_WIDTH,
      height,
    };
  }
  if (state.mountKind === "side") {
    return {
      x: state.side === "right" ? RACK_CABLING_BODY_WIDTH - 24 : 0,
      y: rackOffsetY + 12,
      width: 24,
      height: rack.totalU * RACK_CABLING_UNIT_HEIGHT - 8,
    };
  }
  if (state.mountKind === "shelf" && state.parentDeviceId) {
    const parent = directRects.get(state.parentDeviceId);
    if (parent) {
      const rawWidth = state.shelfWidth ?? 200;
      const rawHeight = state.shelfHeight ?? 200;
      const rotated = state.orientation === 90;
      return bound({
        x: parent.x + ((state.shelfX ?? 0) / 1000) * parent.width,
        y: parent.y + ((state.shelfY ?? 0) / 1000) * parent.height,
        width: ((rotated ? rawHeight : rawWidth) / 1000) * parent.width,
        height: ((rotated ? rawWidth : rawHeight) / 1000) * parent.height,
      });
    }
  }
  const fallbackU = stableLane(device.id) % Math.max(1, rack.totalU);
  return {
    x: 0,
    y: rackOffsetY + fallbackU * RACK_CABLING_UNIT_HEIGHT + 9,
    width: RACK_CABLING_BODY_WIDTH,
    height: RACK_CABLING_UNIT_HEIGHT - 2,
  };
}

function hasUsableRackPlacement(
  device: Device,
  rack: Rack,
  rackDevices: Device[],
): boolean {
  const state = devicePlacementState(device);
  if (state.mountKind === "direct") {
    return Boolean(
      state.rackId === rack.id &&
      state.startU != null &&
      state.heightU != null &&
      state.column != null &&
      state.columnSpan != null &&
      state.startU >= 1 &&
      state.heightU >= 1 &&
      state.startU + state.heightU - 1 <= rack.totalU &&
      state.column >= 0 &&
      state.columnSpan >= 1 &&
      state.column + state.columnSpan <= 12,
    );
  }
  if (state.mountKind === "side") {
    return state.rackId === rack.id && state.side != null;
  }
  if (state.mountKind === "rack-top") {
    return Boolean(
      state.rackId === rack.id &&
      state.heightU != null &&
      state.heightU >= 1 &&
      state.column != null &&
      state.columnSpan != null &&
      state.column >= 0 &&
      state.columnSpan >= 1 &&
      state.column + state.columnSpan <= 12,
    );
  }
  if (state.mountKind !== "shelf" || !state.parentDeviceId) return false;
  const parent = rackDevices.find(
    (candidate) => candidate.id === state.parentDeviceId,
  );
  if (!parent || !hasUsableRackPlacement(parent, rack, [])) return false;
  if (
    state.shelfX == null ||
    state.shelfY == null ||
    state.shelfWidth == null ||
    state.shelfHeight == null
  ) {
    return false;
  }
  const width = state.orientation === 90 ? state.shelfHeight : state.shelfWidth;
  const height =
    state.orientation === 90 ? state.shelfWidth : state.shelfHeight;
  return (
    state.shelfX >= 0 &&
    state.shelfY >= 0 &&
    width > 0 &&
    height > 0 &&
    state.shelfX + width <= 1000 &&
    state.shelfY + height <= 1000
  );
}

function deviceRoomId(device: Device | undefined, rackById: Map<string, Rack>) {
  if (!device) return null;
  return (
    device.roomId ??
    (device.rackId ? rackById.get(device.rackId)?.roomId : null) ??
    null
  );
}

export function buildRackCablingScene(input: {
  room: Room;
  racks: Rack[];
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  faceMode: VisualizerRackFaceMode;
  rackOrder?: string[];
  looseExpanded?: boolean;
}): RackCablingScene {
  const roomRacks = input.racks
    .filter((rack) => rack.roomId === input.room.id)
    .sort(compareRacks(input.rackOrder ?? []));
  const roomRackIds = new Set(roomRacks.map((rack) => rack.id));
  const roomDevices = input.devices
    .filter(
      (device) =>
        roomRackIds.has(device.rackId ?? "") ||
        (!device.rackId && device.roomId === input.room.id),
    )
    .sort(
      (left, right) =>
        left.hostname.localeCompare(right.hostname, undefined, {
          numeric: true,
        }) || left.id.localeCompare(right.id),
    );
  const layoutByDeviceId = new Map(
    input.layouts.map((layout) => [layout.deviceId, layout]),
  );
  const faceList = facesForMode(input.faceMode);
  const rackBodyHeights = roomRacks.map(
    (rack) =>
      rackTopOffset(
        rack,
        roomDevices.filter((device) => device.rackId === rack.id),
      ) +
      rack.totalU * RACK_CABLING_UNIT_HEIGHT +
      16,
  );
  const tallestBody = Math.max(0, ...rackBodyHeights);
  const rackGroupWidths = roomRacks.map(
    () =>
      faceList.length * (RACK_CABLING_BODY_WIDTH + RACK_GUTTER * 2) +
      (faceList.length - 1) * FACE_GAP,
  );
  const rackAreaWidth = rackGroupWidths.reduce(
    (total, width, index) => total + width + (index > 0 ? RACK_GAP : 0),
    0,
  );
  const baseWidth = Math.max(760, CANVAS_PADDING * 2 + rackAreaWidth);
  const rackFrames: RackCablingRackFrame[] = [];
  const equipment: RackCablingEquipment[] = [];
  const anchors: RackCablingAnchor[] = [];
  let nextX = CANVAS_PADDING;

  for (const [rackIndex, rack] of roomRacks.entries()) {
    const bodyHeight = rackBodyHeights[rackIndex];
    const groupWidth = rackGroupWidths[rackIndex];
    const rackY = CANVAS_PADDING + tallestBody - bodyHeight;
    const faceFrames: RackCablingFaceFrame[] = [];
    const directRects = new Map<string, RackStudioRect>();
    const rackDevices = roomDevices.filter(
      (candidate) => candidate.rackId === rack.id,
    );
    const rackOffsetY = rackTopOffset(rack, rackDevices);
    for (const device of rackDevices.filter(
      (candidate) => devicePlacementState(candidate).mountKind === "direct",
    )) {
      fallbackRect(rack, device, directRects, rackOffsetY);
    }
    for (const device of rackDevices.filter(
      (candidate) => devicePlacementState(candidate).mountKind !== "direct",
    )) {
      fallbackRect(rack, device, directRects, rackOffsetY);
    }

    for (const [faceIndex, face] of faceList.entries()) {
      const faceX =
        nextX +
        faceIndex * (RACK_CABLING_BODY_WIDTH + RACK_GUTTER * 2 + FACE_GAP) +
        RACK_GUTTER;
      // Frame coordinates use the inside edge of the rack rails so physical
      // faceplates and their cable anchors share the same coordinate system.
      const faceY = rackY + RACK_HEADER_HEIGHT + 8;
      const elevation = buildRackElevationScene({
        rack,
        rackFace: face,
        devices: roomDevices,
        layouts: input.layouts,
        ports: input.ports,
        width: RACK_CABLING_BODY_WIDTH,
        unitHeight: RACK_CABLING_UNIT_HEIGHT,
      });
      const usableDeviceIds = new Set(
        rackDevices
          .filter((device) => hasUsableRackPlacement(device, rack, rackDevices))
          .map((device) => device.id),
      );
      const frameEquipment: RackCablingEquipment[] = elevation.equipment
        .filter((item) => usableDeviceIds.has(item.device.id))
        .map((item) => ({
          id: item.id,
          device: item.device,
          layout: item.layout,
          rackId: rack.id,
          rackFace: item.rackFace,
          physicalFace: item.physicalFace,
          rect: {
            x: faceX + item.rect.x,
            y: faceY + item.rect.y,
            width: item.rect.width,
            height: item.rect.height,
          },
          rotation: item.rotation,
          fallbackReason: null,
        }));
      const renderedIds = new Set(frameEquipment.map((item) => item.device.id));
      for (const device of rackDevices) {
        if (renderedIds.has(device.id)) continue;
        const rect = fallbackRect(rack, device, directRects, rackOffsetY);
        if (!rect) continue;
        const layout = layoutByDeviceId.get(device.id);
        frameEquipment.push({
          id: `${device.id}:${face}:fallback`,
          device,
          layout,
          rackId: rack.id,
          rackFace: face,
          physicalFace: physicalFaceForRackFace(device, face),
          rect: {
            x: faceX + rect.x,
            y: faceY + rect.y,
            width: rect.width,
            height: rect.height,
          },
          rotation: devicePlacementState(device).orientation === 90 ? 90 : 0,
          fallbackReason: layout ? "unavailable-position" : "missing-layout",
        });
      }
      equipment.push(...frameEquipment);
      anchors.push(
        ...elevation.portAnchors
          .filter((anchor) => usableDeviceIds.has(anchor.deviceId))
          .map((anchor) => ({
            portId: anchor.portId,
            deviceId: anchor.deviceId,
            rackId: rack.id,
            rackFace: anchor.rackFace,
            physicalFace: anchor.physicalFace,
            x: faceX + anchor.x,
            y: faceY + anchor.y,
            kind: "physical" as const,
          })),
      );
      faceFrames.push({
        face,
        x: faceX,
        y: faceY,
        width: RACK_CABLING_BODY_WIDTH,
        height: bodyHeight,
        equipment: frameEquipment,
      });
    }
    rackFrames.push({
      rack,
      x: nextX,
      y: rackY,
      width: groupWidth,
      height: RACK_HEADER_HEIGHT + bodyHeight,
      faces: faceFrames,
    });
    nextX += groupWidth + RACK_GAP;
  }

  const looseDevices = roomDevices
    .filter(
      (device) =>
        !device.rackId &&
        isRackStudioPhysicalDevice(device) &&
        devicePlacementState(device).mountKind === "loose",
    )
    .sort(
      (left, right) =>
        left.hostname.localeCompare(right.hostname, undefined, {
          numeric: true,
        }) || left.id.localeCompare(right.id),
    );
  const looseExpanded = Boolean(input.looseExpanded);
  const trayY = CANVAS_PADDING + RACK_HEADER_HEIGHT + tallestBody + TRAY_GAP;
  const looseCards: RackCablingLooseCard[] = [];
  let trayHeight =
    looseDevices.length > 0 ? TRAY_HEADER_HEIGHT + (looseExpanded ? 0 : 26) : 0;
  if (looseDevices.length > 0 && looseExpanded) {
    const columns = Math.max(
      1,
      Math.floor(
        (baseWidth - CANVAS_PADDING * 2 + LOOSE_CARD_GAP) /
          (LOOSE_CARD_WIDTH + LOOSE_CARD_GAP),
      ),
    );
    const cardHeight =
      30 + faceList.length * LOOSE_FACE_HEIGHT + (faceList.length - 1) * 8;
    for (const [index, device] of looseDevices.entries()) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cardX =
        CANVAS_PADDING + column * (LOOSE_CARD_WIDTH + LOOSE_CARD_GAP);
      const cardY =
        trayY + TRAY_HEADER_HEIGHT + 16 + row * (cardHeight + LOOSE_CARD_GAP);
      const layout = layoutByDeviceId.get(device.id);
      const faces = faceList.map((face, faceIndex) => ({
        face,
        x: cardX + 10,
        y: cardY + 26 + faceIndex * (LOOSE_FACE_HEIGHT + 8),
        width: LOOSE_CARD_WIDTH - 20,
        height: LOOSE_FACE_HEIGHT,
      }));
      looseCards.push({
        device,
        layout,
        fallbackReason: layout ? null : "missing-layout",
        x: cardX,
        y: cardY,
        width: LOOSE_CARD_WIDTH,
        height: cardHeight,
        faces,
      });
      if (layout) {
        for (const faceFrame of faces) {
          const definition = layout.snapshot.faces[faceFrame.face];
          for (const binding of layout.bindings) {
            const slot = layout.snapshot.portSlots.find(
              (candidate) =>
                candidate.id === binding.slotId &&
                candidate.face === faceFrame.face,
            );
            if (!slot) continue;
            anchors.push({
              portId: binding.portId,
              deviceId: device.id,
              rackId: null,
              rackFace: faceFrame.face,
              physicalFace: faceFrame.face,
              x:
                faceFrame.x +
                ((slot.x + slot.width / 2) / 1000) * faceFrame.width,
              y:
                faceFrame.y +
                ((slot.y + slot.height / 2) / (definition.height || 1)) *
                  faceFrame.height,
              kind: "physical",
            });
          }
        }
      }
    }
    const rows = Math.ceil(looseDevices.length / columns);
    trayHeight =
      TRAY_HEADER_HEIGHT +
      16 +
      rows * cardHeight +
      (rows - 1) * LOOSE_CARD_GAP +
      16;
  } else if (looseDevices.length > 0) {
    const portsByDeviceId = new Map<string, Port[]>();
    for (const port of [...input.ports].sort(
      (left, right) =>
        left.deviceId.localeCompare(right.deviceId) ||
        left.position - right.position ||
        left.id.localeCompare(right.id),
    )) {
      const list = portsByDeviceId.get(port.deviceId) ?? [];
      list.push(port);
      portsByDeviceId.set(port.deviceId, list);
    }
    looseDevices.forEach((device, deviceIndex) => {
      for (const port of portsByDeviceId.get(device.id) ?? []) {
        anchors.push({
          portId: port.id,
          deviceId: device.id,
          rackId: null,
          rackFace: port.face === "rear" ? "rear" : "front",
          physicalFace: port.face === "rear" ? "rear" : "front",
          x:
            CANVAS_PADDING +
            ((deviceIndex + 1) / (looseDevices.length + 1)) *
              (baseWidth - CANVAS_PADDING * 2),
          y: trayY + TRAY_HEADER_HEIGHT + 13,
          kind: "loose-handoff",
        });
      }
    });
  }

  return {
    room: input.room,
    width: baseWidth,
    height:
      looseDevices.length > 0
        ? trayY + trayHeight + CANVAS_PADDING
        : CANVAS_PADDING * 2 + RACK_HEADER_HEIGHT + tallestBody,
    racks: rackFrames,
    looseCards,
    looseTray:
      looseDevices.length > 0
        ? {
            x: CANVAS_PADDING,
            y: trayY,
            width: baseWidth - CANVAS_PADDING * 2,
            height: trayHeight,
            expanded: looseExpanded,
            deviceCount: looseDevices.length,
          }
        : null,
    equipment,
    anchors,
  };
}

function stableLane(id: string) {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 13;
}

function stableHandoffLane(id: string) {
  let hash = 5381;
  for (const character of id) {
    hash = Math.imul(hash, 33) ^ character.charCodeAt(0);
  }
  return (Math.abs(hash) % 37) - 18;
}

function physicalPort(port: Port | undefined) {
  return Boolean(
    port &&
    port.portRole !== "aggregate" &&
    port.kind !== "virtual" &&
    port.kind !== "wifi",
  );
}

function sceneEdgeHandoffAnchor(
  local: RackCablingAnchor,
  scene: RackCablingScene,
  linkId: string,
  endpoint: "from" | "to",
): RackCablingAnchor {
  const exitRight = local.x >= scene.width / 2;
  return {
    ...local,
    portId: `${linkId}:handoff:${endpoint}`,
    deviceId: `${linkId}:handoff:${endpoint}`,
    rackId: null,
    x: exitRight ? scene.width - 8 : 8,
    y: Math.max(
      18,
      Math.min(scene.height - 18, local.y + stableHandoffLane(linkId) * 9),
    ),
    kind: "handoff",
  };
}

function rackEdgeHandoffAnchor(
  local: RackCablingAnchor,
  rack: RackCablingRackFrame,
  linkId: string,
  endpoint: "from" | "to",
): RackCablingAnchor {
  const center = rack.x + rack.width / 2;
  return {
    ...local,
    portId: `${linkId}:handoff:${endpoint}`,
    deviceId: `${linkId}:handoff:${endpoint}`,
    rackId: rack.rack.id,
    x: local.x < center ? rack.x - 8 : rack.x + rack.width + 8,
    y: Math.max(
      rack.y + 18,
      Math.min(
        rack.y + rack.height - 18,
        local.y + stableHandoffLane(linkId) * 5,
      ),
    ),
    kind: "handoff",
  };
}

function unavailableHandoffAnchor(input: {
  scene: RackCablingScene;
  deviceId: string;
  physicalFace: RackFace;
  peer?: RackCablingAnchor;
  linkId: string;
  endpoint: "from" | "to";
}): RackCablingAnchor | undefined {
  const fallbackEquipment = input.scene.equipment.filter(
    (item) => item.device.id === input.deviceId && item.fallbackReason != null,
  );
  const equipment =
    fallbackEquipment.find(
      (item) => item.physicalFace === input.physicalFace,
    ) ?? fallbackEquipment[0];
  const looseCard = input.scene.looseCards.find(
    (item) => item.device.id === input.deviceId && !item.layout,
  );
  const rect = equipment?.rect ?? looseCard;
  if (!rect) return undefined;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const exitLeft = input.peer
    ? input.peer.x < centerX
    : input.endpoint === "from";
  return {
    portId: `${input.linkId}:handoff:${input.endpoint}`,
    deviceId: input.deviceId,
    rackId: equipment?.rackId ?? null,
    rackFace: equipment?.rackFace ?? input.physicalFace,
    physicalFace: input.physicalFace,
    x: exitLeft ? rect.x : rect.x + rect.width,
    y: Math.max(
      rect.y + 3,
      Math.min(
        rect.y + rect.height - 3,
        centerY + stableHandoffLane(input.linkId) * 2,
      ),
    ),
    kind: "handoff",
  };
}

function fallbackReasonForEndpoint(
  scene: RackCablingScene,
  deviceId: string,
  physicalFace: RackFace,
) {
  return (
    scene.equipment.find(
      (item) =>
        item.device.id === deviceId &&
        item.physicalFace === physicalFace &&
        item.fallbackReason,
    )?.fallbackReason ??
    scene.equipment.find(
      (item) => item.device.id === deviceId && item.fallbackReason,
    )?.fallbackReason ??
    scene.looseCards.find(
      (item) => item.device.id === deviceId && item.fallbackReason,
    )?.fallbackReason ??
    undefined
  );
}

const HANDOFF_LABEL_MIN_Y = 16;
const HANDOFF_LABEL_MIN_GAP = 14;

function handoffLabelLane(input: {
  scene: RackCablingScene;
  route: RackCablingRoute;
  handoff: RackCablingHandoff;
  anchor: RackCablingAnchor;
}) {
  const { scene, route, handoff, anchor } = input;
  if (handoff.reason === "cross-room") {
    const side = anchor.x < scene.width / 2 ? "left" : "right";
    return {
      lane: `scene-edge:${side}`,
      x: side === "left" ? 12 : scene.width - 12,
      textAnchor: side === "left" ? ("start" as const) : ("end" as const),
    };
  }
  if (handoff.reason === "hidden-face") {
    const rack = scene.racks.find((entry) => entry.rack.id === anchor.rackId);
    const side = rack && anchor.x < rack.x + rack.width / 2 ? "left" : "right";
    return {
      lane: `rack-edge:${rack?.rack.id ?? handoff.deviceId}:${side}`,
      x: rack
        ? side === "left"
          ? Math.max(12, rack.x - 12)
          : Math.min(scene.width - 12, rack.x + rack.width + 12)
        : anchor.x,
      textAnchor: side === "left" ? ("end" as const) : ("start" as const),
    };
  }
  if (handoff.reason === "loose-tray") {
    return {
      lane: `loose-tray:${handoff.deviceId}`,
      x: anchor.x,
      textAnchor: "middle" as const,
    };
  }
  const fallbackEquipment = scene.equipment.filter(
    (item) =>
      item.device.id === handoff.deviceId && item.fallbackReason != null,
  );
  const equipment =
    fallbackEquipment.find(
      (item) => item.physicalFace === handoff.physicalFace,
    ) ?? fallbackEquipment[0];
  const looseCard = scene.looseCards.find(
    (item) => item.device.id === handoff.deviceId && item.fallbackReason,
  );
  const rect = equipment?.rect ?? looseCard;
  const side = rect && anchor.x <= rect.x + rect.width / 2 ? "left" : "right";
  const peer = handoff.endpoint === "from" ? route.to : route.from;
  const effectiveSide = rect ? side : peer.x < anchor.x ? "left" : "right";
  return {
    lane: `fallback-equipment:${handoff.deviceId}:${effectiveSide}`,
    x: Math.max(
      12,
      Math.min(
        scene.width - 12,
        anchor.x + (effectiveSide === "left" ? -4 : 4),
      ),
    ),
    textAnchor:
      effectiveSide === "left" ? ("end" as const) : ("start" as const),
  };
}

/**
 * Packs handoff labels without changing their physical cable anchors. The
 * stable route/endpoint key is the final tie-breaker, so inventory input order
 * cannot cause labels to jump between renders.
 */
export function layoutRackCablingHandoffLabels(
  scene: RackCablingScene,
  routes: RackCablingRoute[],
): RackCablingHandoffLabelGeometry[] {
  const maxY = Math.max(HANDOFF_LABEL_MIN_Y, scene.height - 16);
  const entries = [...routes]
    .sort((left, right) => left.link.id.localeCompare(right.link.id))
    .flatMap((route) =>
      [...route.handoffs]
        .sort(
          (left, right) =>
            left.endpoint.localeCompare(right.endpoint) ||
            left.anchorPortId.localeCompare(right.anchorPortId),
        )
        .map((handoff) => {
          const anchor = handoff.endpoint === "from" ? route.from : route.to;
          const placement = handoffLabelLane({
            scene,
            route,
            handoff,
            anchor,
          });
          const packingColumn =
            placement.x < scene.width / 3
              ? ("left" as const)
              : placement.x > (scene.width * 2) / 3
                ? ("right" as const)
                : ("center" as const);
          return {
            id: `${route.link.id}:${handoff.endpoint}`,
            linkId: route.link.id,
            endpoint: handoff.endpoint,
            lane: placement.lane,
            packingColumn,
            anchorX: anchor.x,
            anchorY: anchor.y,
            x: placement.x,
            desiredY: Math.max(
              HANDOFF_LABEL_MIN_Y,
              Math.min(maxY, anchor.y - 7),
            ),
            textAnchor: placement.textAnchor,
          };
        }),
    );

  const result: RackCablingHandoffLabelGeometry[] = [];
  for (const packingColumn of ["left", "center", "right"] as const) {
    const column = entries
      .filter((entry) => entry.packingColumn === packingColumn)
      .sort(
        (left, right) =>
          left.desiredY - right.desiredY || left.id.localeCompare(right.id),
      );
    if (column.length === 0) continue;
    const gap =
      column.length === 1
        ? HANDOFF_LABEL_MIN_GAP
        : Math.min(
            HANDOFF_LABEL_MIN_GAP,
            (maxY - HANDOFF_LABEL_MIN_Y) / (column.length - 1),
          );
    const y = column.map((entry) => entry.desiredY);
    for (let index = 1; index < y.length; index += 1) {
      y[index] = Math.max(y[index], y[index - 1] + gap);
    }
    if (y[y.length - 1] > maxY) {
      y[y.length - 1] = maxY;
      for (let index = y.length - 2; index >= 0; index -= 1) {
        y[index] = Math.min(y[index], y[index + 1] - gap);
      }
    }
    if (y[0] < HANDOFF_LABEL_MIN_Y) {
      y[0] = HANDOFF_LABEL_MIN_Y;
      for (let index = 1; index < y.length; index += 1) {
        y[index] = Math.max(y[index], y[index - 1] + gap);
      }
    }
    column.forEach((entry, index) => {
      const moved = Math.abs(y[index] - entry.desiredY) > 2;
      result.push({
        id: entry.id,
        linkId: entry.linkId,
        endpoint: entry.endpoint,
        lane: entry.lane,
        packingColumn: entry.packingColumn,
        anchorX: entry.anchorX,
        anchorY: entry.anchorY,
        x: entry.x,
        y: y[index],
        textAnchor: entry.textAnchor,
        leaderPath: moved
          ? `M ${entry.anchorX.toFixed(2)} ${entry.anchorY.toFixed(2)} L ${entry.x.toFixed(2)} ${y[index].toFixed(2)}`
          : null,
      });
    });
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

export function rackCablingPath(
  from: Pick<RackCablingAnchor, "x" | "y">,
  to: Pick<RackCablingAnchor, "x" | "y">,
  linkId: string,
  style: RackCablingRouteStyle,
) {
  const lane = stableLane(linkId) - 6;
  if (style === "orthogonal") {
    const midpoint = (from.x + to.x) / 2 + lane * 7;
    return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} L ${midpoint.toFixed(2)} ${from.y.toFixed(2)} L ${midpoint.toFixed(2)} ${to.y.toFixed(2)} L ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
  }
  const direction = to.x >= from.x ? 1 : -1;
  const span = Math.abs(to.x - from.x);
  const pull = Math.max(54, Math.min(220, span * 0.46));
  const bend = lane * 8;
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} C ${(from.x + direction * pull).toFixed(2)} ${(from.y + bend).toFixed(2)}, ${(to.x - direction * pull).toFixed(2)} ${(to.y + bend).toFixed(2)}, ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
}

export function buildRackCablingRoutes(input: {
  scene: RackCablingScene;
  rooms?: Room[];
  racks: Rack[];
  devices: Device[];
  ports: Port[];
  links: PortLink[];
  cableType?: string;
  style: RackCablingRouteStyle;
}): RackCablingRoute[] {
  const anchorByPortId = new Map(
    input.scene.anchors.map((anchor) => [anchor.portId, anchor]),
  );
  const portById = new Map(input.ports.map((port) => [port.id, port]));
  const deviceById = new Map(
    input.devices.map((device) => [device.id, device]),
  );
  const rackById = new Map(input.racks.map((rack) => [rack.id, rack]));
  const roomById = new Map(
    (input.rooms ?? [input.scene.room]).map((room) => [room.id, room]),
  );
  const routes: RackCablingRoute[] = [];

  for (const link of [...input.links].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (link.visible === false) continue;
    const fromPort = portById.get(link.fromPortId);
    const toPort = portById.get(link.toPortId);
    if (
      !fromPort ||
      !toPort ||
      !physicalPort(fromPort) ||
      !physicalPort(toPort)
    ) {
      continue;
    }
    if (
      input.cableType &&
      input.cableType !== "all" &&
      (link.cableType || "Unknown") !== input.cableType
    ) {
      continue;
    }
    const fromDevice = fromPort ? deviceById.get(fromPort.deviceId) : undefined;
    const toDevice = toPort ? deviceById.get(toPort.deviceId) : undefined;
    const fromRoomId = deviceRoomId(fromDevice, rackById);
    const toRoomId = deviceRoomId(toDevice, rackById);
    const fromLocal = fromRoomId === input.scene.room.id;
    const toLocal = toRoomId === input.scene.room.id;
    if (!fromLocal && !toLocal) continue;
    let from = anchorByPortId.get(link.fromPortId);
    let to = anchorByPortId.get(link.toPortId);
    const handoffs: RackCablingHandoff[] = [];
    const addHandoff = (
      endpoint: "from" | "to",
      reason: RackCablingHandoff["reason"],
      anchor: RackCablingAnchor,
      device: Device | undefined,
      port: Port,
      roomId: string | null,
    ) => {
      handoffs.push({
        reason,
        endpoint,
        anchorPortId: anchor.portId,
        deviceId: port.deviceId,
        deviceLabel: device?.hostname ?? port.deviceId,
        portId: port.id,
        portLabel: port.name,
        roomId,
        roomLabel: roomId ? (roomById.get(roomId)?.name ?? null) : null,
        physicalFace: port.face === "rear" ? "rear" : "front",
        fallbackReason:
          reason === "unavailable"
            ? fallbackReasonForEndpoint(
                input.scene,
                port.deviceId,
                port.face === "rear" ? "rear" : "front",
              )
            : undefined,
      });
    };

    if (!from) {
      const unavailable = unavailableHandoffAnchor({
        scene: input.scene,
        deviceId: fromPort.deviceId,
        physicalFace: fromPort.face === "rear" ? "rear" : "front",
        peer: to,
        linkId: link.id,
        endpoint: "from",
      });
      if (unavailable) {
        from = unavailable;
        addHandoff(
          "from",
          "unavailable",
          from,
          fromDevice,
          fromPort,
          fromRoomId,
        );
      }
    }
    if (!to) {
      const unavailable = unavailableHandoffAnchor({
        scene: input.scene,
        deviceId: toPort.deviceId,
        physicalFace: toPort.face === "rear" ? "rear" : "front",
        peer: from,
        linkId: link.id,
        endpoint: "to",
      });
      if (unavailable) {
        to = unavailable;
        addHandoff("to", "unavailable", to, toDevice, toPort, toRoomId);
      }
    }
    if (!from && to) {
      const rackFrame = fromDevice?.rackId
        ? input.scene.racks.find((entry) => entry.rack.id === fromDevice.rackId)
        : undefined;
      from =
        fromLocal && rackFrame
          ? rackEdgeHandoffAnchor(to, rackFrame, link.id, "from")
          : sceneEdgeHandoffAnchor(to, input.scene, link.id, "from");
      addHandoff(
        "from",
        fromLocal ? "hidden-face" : "cross-room",
        from,
        fromDevice,
        fromPort,
        fromRoomId,
      );
    } else if (!to && from) {
      const rackFrame = toDevice?.rackId
        ? input.scene.racks.find((entry) => entry.rack.id === toDevice.rackId)
        : undefined;
      to =
        toLocal && rackFrame
          ? rackEdgeHandoffAnchor(from, rackFrame, link.id, "to")
          : sceneEdgeHandoffAnchor(from, input.scene, link.id, "to");
      addHandoff(
        "to",
        toLocal ? "hidden-face" : "cross-room",
        to,
        toDevice,
        toPort,
        toRoomId,
      );
    }
    if (!from || !to) continue;
    if (from.kind === "loose-handoff") {
      addHandoff("from", "loose-tray", from, fromDevice, fromPort, fromRoomId);
    }
    if (to.kind === "loose-handoff") {
      addHandoff("to", "loose-tray", to, toDevice, toPort, toRoomId);
    }
    const category = cableCategoryForPorts(fromPort, toPort);
    routes.push({
      link,
      from,
      to,
      path: rackCablingPath(from, to, link.id, input.style),
      color: normalizeColorToCss(link.color) ?? defaultCableColor(category),
      label: link.label || link.cableType || category,
      handoffs,
    });
  }
  return routes;
}
