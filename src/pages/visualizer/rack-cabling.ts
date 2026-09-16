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
  rackTopBandOffset,
  physicalFaceForRackFace,
  rackFaceForPhysicalFace,
  type RackStudioRect,
} from "@/lib/rack-studio-scene";
import {
  cableCategoryForPorts,
  defaultCableColor,
  planPhysicalCableRoutes,
  cableRouteMode,
  resolveCableGuidePoints,
  projectCableWaypoints,
  cableGeometryLabelPoint,
  type CablePoint,
  type CableContinuationMarker,
  type CableRouteGeometry,
  type RackStudioCableAnchor,
} from "@/lib/rack-studio-cables";
import { normalizeColorToCss } from "@/lib/utils";
import type { VisualizerRackFaceMode } from "./types";

export type RackCablingRouteStyle = "smooth" | "orthogonal";

export function parseRackCablingRoomSelection(
  value: string | null,
): string[] | null {
  if (value == null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((entry) => typeof entry === "string")
    ) {
      return null;
    }
    return parsed.filter(
      (entry, index) => parsed.indexOf(entry) === index,
    ) as string[];
  } catch {
    return null;
  }
}

export function reconcileRackCablingRoomSelection(input: {
  selection: string[] | null;
  legacyRoomId?: string | null;
  availableRoomIds: string[];
  preferredRoomId?: string | null;
}) {
  const available = new Set(input.availableRoomIds);
  if (input.selection !== null) {
    return input.selection.filter(
      (id, index, values) => available.has(id) && values.indexOf(id) === index,
    );
  }
  if (input.legacyRoomId && available.has(input.legacyRoomId)) {
    return [input.legacyRoomId];
  }
  const preferred =
    input.preferredRoomId && available.has(input.preferredRoomId)
      ? input.preferredRoomId
      : input.availableRoomIds[0];
  return preferred ? [preferred] : [];
}

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
  roomId: string;
  rackId: string | null;
  rackFace: RackFace;
  physicalFace: RackFace;
  x: number;
  y: number;
  kind: "physical" | "loose-handoff" | "handoff";
}

export interface RackCablingFaceFrame {
  rackOffsetY: number;
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

export interface RackCablingLooseTray {
  roomId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expanded: boolean;
  deviceCount: number;
}

export interface RackCablingRoomFrame {
  room: Room;
  x: number;
  y: number;
  width: number;
  height: number;
  racks: RackCablingRackFrame[];
  looseCards: RackCablingLooseCard[];
  looseSummaries: Array<{
    device: Device;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  looseTray: RackCablingLooseTray | null;
  equipment: RackCablingEquipment[];
  anchors: RackCablingAnchor[];
}

export interface RackCablingScene {
  looseSummaries: Array<{
    device: Device;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  rooms: RackCablingRoomFrame[];
  width: number;
  height: number;
  racks: RackCablingRackFrame[];
  looseCards: RackCablingLooseCard[];
  looseTray: RackCablingLooseTray | null;
  looseTrays: RackCablingLooseTray[];
  equipment: RackCablingEquipment[];
  anchors: RackCablingAnchor[];
}

export interface RackCablingRoute {
  link: PortLink;
  path: string;
  geometry: CableRouteGeometry;
  labelPoint: CablePoint;
  continuations: CableContinuationMarker[];
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
  rackFace: RackFace;
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
      ...scene.looseSummaries.map((item) => item.device.id),
      ...scene.equipment.map((item) => item.device.id),
      ...scene.looseCards.map((item) => item.device.id),
      ...routes.flatMap((route) =>
        route.handoffs.map((handoff) => handoff.deviceId),
      ),
      ...scene.anchors.map((anchor) => anchor.deviceId),
    ]),
    portIds: new Set([
      ...routes.flatMap((route) => [
        route.link.fromPortId,
        route.link.toPortId,
      ]),
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
const ROOM_SECTION_HEADER_HEIGHT = 38;
const ROOM_SECTION_GAP = 64;

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

function buildRackCablingRoomScene(input: {
  room: Room;
  racks: Rack[];
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  faceMode: VisualizerRackFaceMode;
  rackOrder?: string[];
  looseExpanded?: boolean;
}): RackCablingRoomFrame {
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
      rackTopBandOffset(
        rack.id,
        roomDevices.filter((device) => device.rackId === rack.id),
        RACK_CABLING_UNIT_HEIGHT,
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
    const rackOffsetY = rackTopBandOffset(
      rack.id,
      rackDevices,
      RACK_CABLING_UNIT_HEIGHT,
    );
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
            roomId: input.room.id,
            rackId: rack.id,
            rackFace: anchor.rackFace,
            physicalFace: anchor.physicalFace,
            x: faceX + anchor.x,
            y: faceY + anchor.y,
            kind: "physical" as const,
          })),
      );
      faceFrames.push({
        rackOffsetY,
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
  const looseSummaries: RackCablingScene["looseSummaries"] = [];
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
              roomId: input.room.id,
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
    const columns = Math.max(
      1,
      Math.floor((baseWidth - CANVAS_PADDING * 2) / 220),
    );
    const cellWidth = (baseWidth - CANVAS_PADDING * 2) / columns;
    const rowHeight = 52;
    trayHeight =
      TRAY_HEADER_HEIGHT +
      16 +
      Math.ceil(looseDevices.length / columns) * rowHeight;
    looseDevices.forEach((device, deviceIndex) => {
      const x = CANVAS_PADDING + (deviceIndex % columns) * cellWidth;
      const y =
        trayY +
        TRAY_HEADER_HEIGHT +
        8 +
        Math.floor(deviceIndex / columns) * rowHeight;
      looseSummaries.push({
        device,
        x,
        y,
        width: cellWidth,
        height: rowHeight,
      });
      for (const port of portsByDeviceId.get(device.id) ?? []) {
        anchors.push({
          portId: port.id,
          deviceId: device.id,
          roomId: input.room.id,
          rackId: null,
          rackFace: port.face === "rear" ? "rear" : "front",
          physicalFace: port.face === "rear" ? "rear" : "front",
          x: x + cellWidth / 2,
          y,
          kind: "loose-handoff",
        });
      }
    });
  }

  return {
    room: input.room,
    x: 0,
    y: 0,
    width: baseWidth,
    height:
      looseDevices.length > 0
        ? trayY + trayHeight + CANVAS_PADDING
        : CANVAS_PADDING * 2 + RACK_HEADER_HEIGHT + tallestBody,
    racks: rackFrames,
    looseCards,
    looseSummaries,
    looseTray:
      looseDevices.length > 0
        ? {
            roomId: input.room.id,
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

function translateRect(rect: RackStudioRect, x: number, y: number) {
  return { ...rect, x: rect.x + x, y: rect.y + y };
}

function translateRoomScene(
  scene: RackCablingRoomFrame,
  y: number,
  width: number,
): RackCablingRoomFrame {
  const contentY = y + ROOM_SECTION_HEADER_HEIGHT;
  const racks = scene.racks.map((rack) => ({
    ...rack,
    y: rack.y + contentY,
    faces: rack.faces.map((face) => ({
      ...face,
      y: face.y + contentY,
      equipment: face.equipment.map((item) => ({
        ...item,
        rect: translateRect(item.rect, 0, contentY),
      })),
    })),
  }));
  const equipment = scene.equipment.map((item) => ({
    ...item,
    rect: translateRect(item.rect, 0, contentY),
  }));
  const looseCards = scene.looseCards.map((card) => ({
    ...card,
    y: card.y + contentY,
    faces: card.faces.map((face) => ({ ...face, y: face.y + contentY })),
  }));
  const looseSummaries = scene.looseSummaries.map((summary) => ({
    ...summary,
    y: summary.y + contentY,
  }));
  const looseTray = scene.looseTray
    ? { ...scene.looseTray, y: scene.looseTray.y + contentY }
    : null;
  const anchors = scene.anchors.map((anchor) => ({
    ...anchor,
    y: anchor.y + contentY,
  }));
  return {
    ...scene,
    x: 0,
    y,
    width,
    height: scene.height + ROOM_SECTION_HEADER_HEIGHT,
    racks,
    equipment,
    looseCards,
    looseSummaries,
    looseTray,
    anchors,
  };
}

export function buildRackCablingScene(input: {
  rooms?: Room[];
  room?: Room;
  racks: Rack[];
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  faceMode: VisualizerRackFaceMode;
  rackOrder?: string[];
  looseExpanded?: boolean;
}): RackCablingScene {
  const selectedRooms = [...(input.rooms ?? (input.room ? [input.room] : []))]
    .filter(
      (room, index, values) =>
        values.findIndex((candidate) => candidate.id === room.id) === index,
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, undefined, { numeric: true }) ||
        left.id.localeCompare(right.id),
    );
  const roomScenes = selectedRooms.map((room) =>
    buildRackCablingRoomScene({ ...input, room }),
  );
  const width = Math.max(760, ...roomScenes.map((scene) => scene.width));
  let nextY = 0;
  const rooms = roomScenes.map((roomScene) => {
    const translated = translateRoomScene(roomScene, nextY, width);
    nextY += translated.height + ROOM_SECTION_GAP;
    return translated;
  });
  const height = rooms.length
    ? nextY - ROOM_SECTION_GAP
    : Math.max(520, CANVAS_PADDING * 2);
  const looseTrays = rooms.flatMap((room) =>
    room.looseTray ? [room.looseTray] : [],
  );
  return {
    rooms,
    width,
    height,
    racks: rooms.flatMap((room) => room.racks),
    looseCards: rooms.flatMap((room) => room.looseCards),
    looseSummaries: rooms.flatMap((room) => room.looseSummaries),
    looseTray: rooms.length === 1 ? (rooms[0]?.looseTray ?? null) : null,
    looseTrays,
    equipment: rooms.flatMap((room) => room.equipment),
    anchors: rooms.flatMap((room) => room.anchors),
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
  const room =
    scene.rooms.find((frame) => frame.room.id === local.roomId) ??
    scene.rooms[0];
  const left = room?.x ?? 0;
  const right = left + (room?.width ?? scene.width);
  const top = room?.y ?? 0;
  const bottom = top + (room?.height ?? scene.height);
  const exitRight = local.x >= (left + right) / 2;
  return {
    ...local,
    portId: `${linkId}:handoff:${endpoint}`,
    deviceId: `${linkId}:handoff:${endpoint}`,
    rackId: null,
    x: exitRight ? right - 8 : left + 8,
    y: Math.max(
      top + 18,
      Math.min(bottom - 18, local.y + stableHandoffLane(linkId) * 9),
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
  const roomId =
    input.scene.rooms.find(
      (room) =>
        room.equipment.some((item) => item.device.id === input.deviceId) ||
        room.looseCards.some((item) => item.device.id === input.deviceId),
    )?.room.id ?? "";
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const exitLeft = input.peer
    ? input.peer.x < centerX
    : input.endpoint === "from";
  return {
    portId: `${input.linkId}:handoff:${input.endpoint}`,
    deviceId: input.deviceId,
    roomId,
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
  measuredWidths: ReadonlyMap<string, number> = new Map(),
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
          const columnIndex =
            packingColumn === "left" ? 0 : packingColumn === "center" ? 1 : 2;
          const width =
            measuredWidths.get(`${route.link.id}:${handoff.endpoint}`) ?? 0;
          const leftExtent =
            placement.textAnchor === "end"
              ? width
              : placement.textAnchor === "middle"
                ? width / 2
                : 0;
          const rightExtent = width - leftExtent;
          const boundedX = width
            ? Math.max(
                (columnIndex * scene.width) / 3 + 12 + leftExtent,
                Math.min(
                  ((columnIndex + 1) * scene.width) / 3 - 12 - rightExtent,
                  placement.x,
                ),
              )
            : placement.x;
          return {
            id: `${route.link.id}:${handoff.endpoint}`,
            linkId: route.link.id,
            endpoint: handoff.endpoint,
            lane: placement.lane,
            packingColumn,
            anchorX: anchor.x,
            anchorY: anchor.y,
            x: boundedX,
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

export interface RackCablingAnnotationInput {
  id: string;
  linkId: string;
  kind: "cable" | "handoff";
  text: string;
  priority: number;
  anchor: CablePoint;
  geometry?: CableRouteGeometry;
  preferredPoint?: CablePoint;
}

export interface RackCablingAnnotationGeometry {
  id: string;
  linkId: string;
  kind: "cable" | "handoff";
  x: number;
  y: number;
  width: number;
  height: number;
  textX: number;
  textY: number;
  leaderPath: string | null;
  inRail: boolean;
}

export interface RackCablingAnnotationLayout {
  annotations: RackCablingAnnotationGeometry[];
  width: number;
  height: number;
}

interface AnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function annotationRectsOverlap(left: AnnotationRect, right: AnnotationRect) {
  const gap = 2;
  return !(
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  );
}

function geometryPolyline(geometry: CableRouteGeometry): CablePoint[] {
  if (geometry.kind === "segmented") {
    return (
      geometry.segments.map(geometryPolyline).sort((left, right) => {
        const length = (points: CablePoint[]) =>
          points
            .slice(1)
            .reduce(
              (sum, point, index) =>
                sum +
                Math.hypot(
                  point.x - points[index]!.x,
                  point.y - points[index]!.y,
                ),
              0,
            );
        return length(right) - length(left);
      })[0] ?? []
    );
  }
  if (geometry.kind === "polyline") return geometry.points;
  return Array.from({ length: 17 }, (_, index) => {
    const t = index / 16;
    const inverse = 1 - t;
    return {
      x:
        inverse ** 3 * geometry.from.x +
        3 * inverse ** 2 * t * geometry.control1.x +
        3 * inverse * t ** 2 * geometry.control2.x +
        t ** 3 * geometry.to.x,
      y:
        inverse ** 3 * geometry.from.y +
        3 * inverse ** 2 * t * geometry.control1.y +
        3 * inverse * t ** 2 * geometry.control2.y +
        t ** 3 * geometry.to.y,
    };
  });
}

function pointAndTangentAt(geometry: CableRouteGeometry, fraction: number) {
  const points = geometryPolyline(geometry);
  if (points.length < 2) {
    return { point: points[0] ?? { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
  }
  const lengths = points
    .slice(1)
    .map((point, index) =>
      Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
    );
  const target =
    lengths.reduce((sum, length) => sum + length, 0) *
    Math.max(0, Math.min(1, fraction));
  let consumed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (consumed + length < target && index < lengths.length - 1) {
      consumed += length;
      continue;
    }
    const from = points[index]!;
    const to = points[index + 1]!;
    const ratio = length ? (target - consumed) / length : 0;
    return {
      point: {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
      },
      tangent: {
        x: length ? (to.x - from.x) / length : 1,
        y: length ? (to.y - from.y) / length : 0,
      },
    };
  }
  return { point: points.at(-1)!, tangent: { x: 1, y: 0 } };
}

/**
 * Places all visible Rack Cabling annotations in one deterministic pass. Labels
 * prefer their cable or handoff, then move into a dedicated rail rather than
 * becoming unreadable when the scene is dense.
 */
export function layoutRackCablingAnnotations(
  scene: RackCablingScene,
  inputs: RackCablingAnnotationInput[],
): RackCablingAnnotationLayout {
  const height = 18;
  const blockers: AnnotationRect[] = [
    ...scene.rooms.map((room) => ({
      x: room.x,
      y: room.y,
      width: room.width,
      height: ROOM_SECTION_HEADER_HEIGHT,
    })),
    ...scene.racks.map((rack) => ({
      x: rack.x,
      y: rack.y,
      width: rack.width,
      height: RACK_HEADER_HEIGHT,
    })),
    ...scene.looseTrays.map((tray) => ({
      x: tray.x,
      y: tray.y,
      width: tray.width,
      height: TRAY_HEADER_HEIGHT,
    })),
    ...scene.looseSummaries,
    ...scene.looseCards,
  ];
  const placed: AnnotationRect[] = [];
  const annotations: RackCablingAnnotationGeometry[] = [];
  const rail: Array<{ input: RackCablingAnnotationInput; width: number }> = [];
  const sorted = [...inputs].sort(
    (left, right) =>
      left.priority - right.priority || left.id.localeCompare(right.id),
  );

  for (const input of sorted) {
    const width = Math.max(40, Math.min(240, input.text.length * 6 + 12));
    const candidates: CablePoint[] = [];
    if (input.geometry) {
      for (const fraction of [0.5, 0.35, 0.65]) {
        const sample = pointAndTangentAt(input.geometry, fraction);
        const normal = { x: -sample.tangent.y, y: sample.tangent.x };
        for (const offset of [0, 16, -16, 32, -32]) {
          candidates.push({
            x: sample.point.x + normal.x * offset,
            y: sample.point.y + normal.y * offset,
          });
        }
      }
    } else {
      const preferred = input.preferredPoint ?? input.anchor;
      for (const offset of [0, 16, -16, 32, -32]) {
        candidates.push({ x: preferred.x, y: preferred.y + offset });
      }
    }
    const candidate = candidates
      .map((point) => ({
        point,
        rect: {
          x: point.x - width / 2,
          y: point.y - height / 2,
          width,
          height,
        },
      }))
      .find(
        ({ rect }) =>
          rect.x >= 8 &&
          rect.y >= 8 &&
          rect.x + rect.width <= scene.width - 8 &&
          rect.y + rect.height <= scene.height - 8 &&
          !blockers.some((blocker) => annotationRectsOverlap(rect, blocker)) &&
          !placed.some((existing) => annotationRectsOverlap(rect, existing)),
      );
    if (!candidate) {
      rail.push({ input, width });
      continue;
    }
    placed.push(candidate.rect);
    const moved = Math.hypot(
      candidate.point.x - input.anchor.x,
      candidate.point.y - input.anchor.y,
    );
    annotations.push({
      id: input.id,
      linkId: input.linkId,
      kind: input.kind,
      ...candidate.rect,
      textX: candidate.rect.x + candidate.rect.width / 2,
      textY: candidate.rect.y + 12,
      leaderPath:
        moved > 10
          ? `M ${input.anchor.x.toFixed(2)} ${input.anchor.y.toFixed(2)} L ${candidate.point.x.toFixed(2)} ${candidate.point.y.toFixed(2)}`
          : null,
      inRail: false,
    });
  }

  const railWidth = Math.max(0, ...rail.map((entry) => entry.width));
  rail.forEach(({ input, width }, index) => {
    const rect = {
      x: scene.width + 16,
      y: 8 + index * 20,
      width,
      height,
    };
    annotations.push({
      id: input.id,
      linkId: input.linkId,
      kind: input.kind,
      ...rect,
      textX: rect.x + rect.width / 2,
      textY: rect.y + 12,
      leaderPath: `M ${input.anchor.x.toFixed(2)} ${input.anchor.y.toFixed(2)} L ${rect.x.toFixed(2)} ${(rect.y + rect.height / 2).toFixed(2)}`,
      inRail: true,
    });
  });

  return {
    annotations: annotations.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    width: rail.length ? scene.width + railWidth + 32 : scene.width,
    height: Math.max(scene.height, rail.length ? 16 + rail.length * 20 : 0),
  };
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
    (input.rooms ?? input.scene.rooms.map((frame) => frame.room)).map(
      (room) => [room.id, room],
    ),
  );
  const selectedRoomIds = new Set(
    input.scene.rooms.map((frame) => frame.room.id),
  );
  const routes: Array<
    Omit<RackCablingRoute, "geometry" | "path" | "labelPoint" | "continuations">
  > = [];

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
    const fromLocal = Boolean(fromRoomId && selectedRoomIds.has(fromRoomId));
    const toLocal = Boolean(toRoomId && selectedRoomIds.has(toRoomId));
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
        rackFace: device
          ? rackFaceForPhysicalFace(
              device,
              port.face === "rear" ? "rear" : "front",
            )
          : port.face === "rear"
            ? "rear"
            : "front",
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
    const hiddenLooseAnchor = (
      port: Port,
      peer: RackCablingAnchor | undefined,
    ) => {
      const card = input.scene.looseCards.find(
        (card) => card.device.id === port.deviceId,
      );
      if (!card) return undefined;
      return {
        rackFace: peer?.rackFace ?? card.faces[0]?.face ?? "front",
        portId: port.id,
        deviceId: port.deviceId,
        roomId:
          input.scene.rooms.find((room) =>
            room.looseCards.some((item) => item.device.id === port.deviceId),
          )?.room.id ?? "",
        rackId: null,
        x: card.x + card.width / 2,
        y: card.y,
        physicalFace:
          port.face === "rear" ? ("rear" as const) : ("front" as const),
        kind: "handoff" as const,
      };
    };
    if (!from) {
      const hidden = hiddenLooseAnchor(fromPort, to);
      if (hidden) {
        from = hidden;
        addHandoff(
          "from",
          "hidden-face",
          hidden,
          fromDevice,
          fromPort,
          fromRoomId,
        );
      }
    }
    if (!to) {
      const hidden = hiddenLooseAnchor(toPort, from);
      if (hidden) {
        to = hidden;
        addHandoff("to", "hidden-face", hidden, toDevice, toPort, toRoomId);
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
      color: normalizeColorToCss(link.color) ?? defaultCableColor(category),
      label: link.label || link.cableType || category,
      handoffs,
    });
  }
  const anchor = (value: RackCablingAnchor): RackStudioCableAnchor => ({
    ...value,
    face: value.physicalFace,
  });
  const rackFramesForRoom = (roomId: string | null) =>
    input.scene.rooms
      .find((frame) => frame.room.id === roomId)
      ?.racks.flatMap((rack) =>
        rack.faces.map((face) => ({
          rackId: rack.rack.id,
          face: face.face,
          rect: {
            x: face.x,
            y: face.y + face.rackOffsetY + 8,
            width: face.width,
            height: rack.rack.totalU * RACK_CABLING_UNIT_HEIGHT,
          },
        })),
      ) ?? [];
  const roomFaces = (roomId: string | null) =>
    input.scene.rooms
      .find((frame) => frame.room.id === roomId)
      ?.racks.flatMap((rack) => rack.faces.map((face) => face.face)) ?? [];
  const guidePointsForRoute = (
    route: (typeof routes)[number],
    reverse: boolean,
  ) => {
    let guideIncomplete = false;
    const guidePoints = (route.link.routeGuides ?? []).flatMap((guide) => {
      const resolved = resolveCableGuidePoints({
        link: { ...route.link, routeGuides: [guide] },
        equipment: input.scene.equipment,
        devices: input.devices,
        roomId: guide.roomId,
        faces: roomFaces(guide.roomId),
      });
      guideIncomplete ||= Boolean(resolved.guideIncomplete);
      return resolved.guidePoints ?? [];
    });
    return {
      guidePoints: reverse ? guidePoints.reverse() : guidePoints,
      guideIncomplete,
    };
  };
  const manualPointsForRoute = (route: (typeof routes)[number]) =>
    (route.link.routeWaypoints ?? []).flatMap((point) =>
      projectCableWaypoints(
        { ...route.link, routeWaypoints: [point] },
        input.racks,
        rackFramesForRoom(point.roomId),
        point.roomId,
      ),
    );
  const geometryById = new Map(
    planPhysicalCableRoutes(
      routes.map((route) => {
        const hidden = route.handoffs.find(
          (handoff) => handoff.reason === "hidden-face",
        );
        const local = hidden?.endpoint === "from" ? route.to : route.from;
        const continuation =
          Boolean(route.from.rackId && route.to.rackId) &&
          route.from.roomId === route.to.roomId &&
          hidden &&
          hidden.rackFace !== local.rackFace &&
          (cableRouteMode(route.link) !== "manual" ||
            !route.link.routeWaypoints?.length) &&
          route.handoffs.every((handoff) => handoff.reason === "hidden-face");
        return {
          id: route.link.id,
          routeMode: cableRouteMode(route.link),
          ...guidePointsForRoute(
            route,
            Boolean(continuation && local.portId !== route.link.fromPortId),
          ),
          from: anchor(continuation ? local : route.from),
          to: continuation ? undefined : anchor(route.to),
          hiddenEndpoint: continuation
            ? { portId: hidden.portId, rackFace: hidden.rackFace }
            : undefined,
          manualPoints: manualPointsForRoute(route),
          allowContinuation:
            Boolean(route.from.rackId && route.to.rackId) &&
            route.from.roomId === route.to.roomId &&
            (cableRouteMode(route.link) !== "manual" ||
              !route.link.routeWaypoints?.length) &&
            route.handoffs.every((handoff) => handoff.reason === "hidden-face"),
          allowDirect:
            route.handoffs.length === 0 &&
            (cableRouteMode(route.link) !== "manual" ||
              !route.link.routeWaypoints?.length),
        };
      }),
      {
        width: input.scene.width,
        height: input.scene.height,
        racks: input.scene.racks.flatMap((rack) =>
          rack.faces.map((face) => ({
            id: rack.rack.id,
            face: face.face,
            rect: face,
            unitHeight: RACK_CABLING_UNIT_HEIGHT,
          })),
        ),
        obstacles: input.scene.equipment.map((item) => ({
          id: item.device.id,
          rackId: item.rackId,
          face: item.rackFace,
          parentDeviceId: item.device.parentDeviceId,
          rect: item.rect,
        })),
      },
      input.style,
    ).map((route) => [route.id, route]),
  );
  return routes.map((route) => {
    const planned = geometryById.get(route.link.id)!;
    const hidden = route.handoffs.find(
      (handoff) => handoff.reason === "hidden-face",
    );
    const marker = planned.continuations.find(
      (marker) => marker.destinationPortId === hidden?.portId,
    );
    return {
      ...route,
      ...(hidden && marker
        ? {
            [hidden.endpoint]: {
              ...route[hidden.endpoint],
              x: marker.x,
              y: marker.y,
            },
          }
        : {}),
      path: planned.path,
      geometry: planned.geometry,
      continuations: planned.continuations,
      labelPoint: cableGeometryLabelPoint(planned.geometry),
    };
  });
}
