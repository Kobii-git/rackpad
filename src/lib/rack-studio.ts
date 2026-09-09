import type {
  Device,
  Rack,
  RackStudioPlacementState,
  RackStudioRackCanvasState,
} from "./types";

export const RACK_STUDIO_CANVAS_WIDTH = 1000;
export const RACK_STUDIO_CANVAS_HEIGHT = 620;
export const RACK_STUDIO_RACK_WIDTH = 158;
export const RACK_STUDIO_RACK_HEIGHT = 278;

export function clampRackStudioValue(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function automaticRackCanvasPosition(index: number) {
  const columns = 5;
  return {
    x: 30 + (index % columns) * 190,
    y: 34 + Math.floor(index / columns) * 292,
  };
}

export function rackCanvasState(
  rack: Rack,
  fallbackIndex = 0,
): RackStudioRackCanvasState {
  const fallback = automaticRackCanvasPosition(fallbackIndex);
  return {
    roomId: rack.roomId ?? null,
    x: rack.studioX ?? fallback.x,
    y: rack.studioY ?? fallback.y,
  };
}

export function storedRackCanvasState(rack: Rack): RackStudioRackCanvasState {
  return {
    roomId: rack.roomId ?? null,
    x: rack.studioX ?? null,
    y: rack.studioY ?? null,
  };
}

export function devicePlacementState(device: Device): RackStudioPlacementState {
  const storedMountKind = device.rackMountKind ?? "direct";
  const mountKind: RackStudioPlacementState["mountKind"] =
    device.placement === "shelf"
      ? "shelf"
      : storedMountKind === "side"
        ? "side"
        : storedMountKind === "rack-top" && device.rackId
          ? "rack-top"
          : device.rackId
            ? "direct"
            : "loose";
  if (mountKind === "direct") {
    return {
      mountKind,
      roomId: device.roomId ?? null,
      rackId: device.rackId ?? null,
      parentDeviceId: null,
      startU: device.startU ?? null,
      heightU: device.heightU ?? 1,
      face: device.face ?? "front",
      column: device.rackColumn ?? (device.rackSlot === "right" ? 6 : 0),
      columnSpan:
        device.rackColumnSpan ??
        (device.rackSlot === "left" || device.rackSlot === "right" ? 6 : 12),
      shelfX: null,
      shelfY: null,
      shelfWidth: null,
      shelfHeight: null,
      orientation: null,
      side: null,
    };
  }
  if (mountKind === "shelf") {
    return {
      mountKind,
      roomId: device.roomId ?? null,
      rackId: device.rackId ?? null,
      parentDeviceId: device.parentDeviceId ?? null,
      startU: null,
      heightU: device.heightU ?? 1,
      face: device.face ?? "front",
      column: null,
      columnSpan: null,
      shelfX: device.shelfX ?? null,
      shelfY: device.shelfY ?? null,
      shelfWidth: device.shelfWidth ?? null,
      shelfHeight: device.shelfHeight ?? null,
      orientation: device.shelfOrientation === 90 ? 90 : 0,
      side: null,
    };
  }
  if (mountKind === "side") {
    return {
      mountKind,
      roomId: device.roomId ?? null,
      rackId: device.rackId ?? null,
      parentDeviceId: null,
      startU: null,
      heightU: device.heightU ?? 1,
      face: device.face ?? "front",
      column: null,
      columnSpan: null,
      shelfX: null,
      shelfY: null,
      shelfWidth: null,
      shelfHeight: null,
      orientation: null,
      side: device.rackSide ?? "left",
    };
  }
  if (mountKind === "rack-top") {
    return {
      mountKind,
      roomId: device.roomId ?? null,
      rackId: device.rackId ?? null,
      parentDeviceId: null,
      startU: null,
      heightU: device.heightU ?? 1,
      face: device.face ?? "front",
      column: device.rackColumn ?? (device.rackSlot === "right" ? 6 : 0),
      columnSpan:
        device.rackColumnSpan ??
        (device.rackSlot === "left" || device.rackSlot === "right" ? 6 : 12),
      shelfX: null,
      shelfY: null,
      shelfWidth: null,
      shelfHeight: null,
      orientation: null,
      side: null,
    };
  }
  return loosePlacementState(device.roomId ?? null);
}

export function loosePlacementState(
  roomId: string | null,
): RackStudioPlacementState {
  return {
    mountKind: "loose",
    roomId,
    rackId: null,
    parentDeviceId: null,
    startU: null,
    heightU: null,
    face: null,
    column: null,
    columnSpan: null,
    shelfX: null,
    shelfY: null,
    shelfWidth: null,
    shelfHeight: null,
    orientation: null,
    side: null,
  };
}

export function directPlacementState(input: {
  roomId: string | null;
  rackId: string;
  startU: number;
  heightU: number;
  face: "front" | "rear";
  column: number;
  columnSpan: number;
}): RackStudioPlacementState {
  return {
    ...loosePlacementState(input.roomId),
    mountKind: "direct",
    rackId: input.rackId,
    startU: input.startU,
    heightU: input.heightU,
    face: input.face,
    column: input.column,
    columnSpan: input.columnSpan,
  };
}

export function rackTopPlacementState(input: {
  roomId: string | null;
  rackId: string;
  heightU: number;
  face?: "front" | "rear";
  column?: number;
  columnSpan?: number;
}): RackStudioPlacementState {
  return {
    ...loosePlacementState(input.roomId),
    mountKind: "rack-top",
    rackId: input.rackId,
    heightU: input.heightU,
    face: input.face ?? "front",
    column: input.column ?? 0,
    columnSpan: input.columnSpan ?? 12,
  };
}

export function validateRackTopPlacementPreview(input: {
  targetDeviceId: string;
  next: RackStudioPlacementState;
  rack: Rack;
  devices: Device[];
}) {
  const { next, rack } = input;
  if (
    next.mountKind !== "rack-top" ||
    next.rackId !== rack.id ||
    next.heightU === null ||
    next.face === null ||
    next.column === null ||
    next.columnSpan === null
  ) {
    return { valid: false, reason: "Rack-top placement is incomplete." };
  }
  if (next.column + next.columnSpan > 12) {
    return { valid: false, reason: "Placement exceeds rack width." };
  }
  for (const device of input.devices) {
    if (device.id === input.targetDeviceId) continue;
    const existing = devicePlacementState(device);
    if (
      existing.mountKind !== "rack-top" ||
      existing.rackId !== rack.id ||
      existing.column === null ||
      existing.columnSpan === null
    ) {
      continue;
    }
    if (
      rangesOverlap(
        next.column,
        next.columnSpan,
        existing.column,
        existing.columnSpan,
      )
    ) {
      return {
        valid: false,
        reason: `Placement overlaps with ${device.hostname}.`,
      };
    }
  }
  return { valid: true, reason: null };
}

export function shelfPlacementBounds(state: RackStudioPlacementState) {
  if (
    state.shelfX === null ||
    state.shelfY === null ||
    state.shelfWidth === null ||
    state.shelfHeight === null
  ) {
    return null;
  }
  return {
    x: state.shelfX,
    y: state.shelfY,
    width: state.orientation === 90 ? state.shelfHeight : state.shelfWidth,
    height: state.orientation === 90 ? state.shelfWidth : state.shelfHeight,
  };
}

function rangesOverlap(
  startA: number,
  sizeA: number,
  startB: number,
  sizeB: number,
) {
  return startA < startB + sizeB && startA + sizeA > startB;
}

export function validateDirectPlacementPreview(input: {
  targetDeviceId: string;
  next: RackStudioPlacementState;
  rack: Rack;
  devices: Device[];
}) {
  const { next, rack } = input;
  if (
    next.mountKind !== "direct" ||
    next.startU === null ||
    next.heightU === null ||
    next.face === null ||
    next.column === null ||
    next.columnSpan === null
  ) {
    return { valid: false, reason: "Direct placement is incomplete." };
  }
  if (next.startU + next.heightU - 1 > rack.totalU) {
    return { valid: false, reason: "Placement exceeds rack height." };
  }
  if (next.column + next.columnSpan > 12) {
    return { valid: false, reason: "Placement exceeds rack width." };
  }
  for (const device of input.devices) {
    if (device.id === input.targetDeviceId) continue;
    const existing = devicePlacementState(device);
    if (
      existing.mountKind !== "direct" ||
      existing.rackId !== rack.id ||
      existing.face !== next.face ||
      existing.startU === null ||
      existing.heightU === null ||
      existing.column === null ||
      existing.columnSpan === null
    ) {
      continue;
    }
    if (
      rangesOverlap(
        next.startU,
        next.heightU,
        existing.startU,
        existing.heightU,
      ) &&
      rangesOverlap(
        next.column,
        next.columnSpan,
        existing.column,
        existing.columnSpan,
      )
    ) {
      return {
        valid: false,
        reason: `Placement overlaps with ${device.hostname}.`,
      };
    }
  }
  return { valid: true, reason: null };
}

export function isRackStudioPhysicalDevice(device: Device) {
  return device.placement !== "virtual" && device.placement !== "wireless";
}
