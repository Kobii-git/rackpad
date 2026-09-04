import { db } from "../db.js";
import { deviceTypeBase } from "./device-types.js";
import {
  asObject,
  optionalEnum,
  optionalInteger,
  optionalNumber,
  optionalString,
  requiredEnum,
  ValidationError,
} from "./validation.js";

const MOUNT_KINDS = ["direct", "shelf", "side", "rack-top", "loose"] as const;
const RACK_FACES = ["front", "rear"] as const;
const RACK_SIDES = ["left", "right"] as const;
const SHELF_ORIENTATIONS = [0, 90] as const;

export interface RackStudioPlacementState {
  mountKind: (typeof MOUNT_KINDS)[number];
  roomId: string | null;
  rackId: string | null;
  parentDeviceId: string | null;
  startU: number | null;
  heightU: number | null;
  face: (typeof RACK_FACES)[number] | null;
  column: number | null;
  columnSpan: number | null;
  shelfX: number | null;
  shelfY: number | null;
  shelfWidth: number | null;
  shelfHeight: number | null;
  orientation: (typeof SHELF_ORIENTATIONS)[number] | null;
  side: (typeof RACK_SIDES)[number] | null;
}

export interface RackStudioDeviceRow extends Record<string, unknown> {
  id: string;
  labId: string;
  hostname: string;
  deviceType: string;
  placement: string | null;
  roomId: string | null;
  rackId: string | null;
  parentDeviceId: string | null;
  startU: number | null;
  heightU: number | null;
  face: string | null;
  rackSlot: string | null;
  rackMountKind: string | null;
  rackColumn: number | null;
  rackColumnSpan: number | null;
  shelfX: number | null;
  shelfY: number | null;
  shelfWidth: number | null;
  shelfHeight: number | null;
  shelfOrientation: number | null;
  rackSide: string | null;
}

interface RackRow {
  id: string;
  labId: string;
  roomId: string | null;
  totalU: number;
}

function rackSlotGeometry(row: RackStudioDeviceRow) {
  const column = row.rackColumn ?? (row.rackSlot === "right" ? 6 : 0);
  const columnSpan =
    row.rackColumnSpan ??
    (row.rackSlot === "left" || row.rackSlot === "right" ? 6 : 12);
  return { column, columnSpan };
}

export function currentRackStudioPlacement(
  row: RackStudioDeviceRow,
): RackStudioPlacementState {
  const storedMountKind = MOUNT_KINDS.includes(
    row.rackMountKind as (typeof MOUNT_KINDS)[number],
  )
    ? (row.rackMountKind as (typeof MOUNT_KINDS)[number])
    : "direct";
  const mountKind =
    row.placement === "shelf"
      ? "shelf"
      : storedMountKind === "side"
        ? "side"
        : storedMountKind === "rack-top" && row.rackId
          ? "rack-top"
          : row.rackId
            ? "direct"
            : "loose";

  if (mountKind === "direct") {
    const geometry = rackSlotGeometry(row);
    return {
      mountKind,
      roomId: row.roomId ?? null,
      rackId: row.rackId,
      parentDeviceId: null,
      startU: row.startU,
      heightU: row.heightU,
      face: row.face === "rear" ? "rear" : "front",
      column: geometry.column,
      columnSpan: geometry.columnSpan,
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
      roomId: row.roomId ?? null,
      rackId: row.rackId,
      parentDeviceId: row.parentDeviceId,
      startU: null,
      heightU: row.heightU ?? 1,
      face: row.face === "rear" ? "rear" : "front",
      column: null,
      columnSpan: null,
      shelfX: row.shelfX,
      shelfY: row.shelfY,
      shelfWidth: row.shelfWidth,
      shelfHeight: row.shelfHeight,
      orientation: row.shelfOrientation === 90 ? 90 : 0,
      side: null,
    };
  }

  if (mountKind === "side") {
    return {
      mountKind,
      roomId: row.roomId ?? null,
      rackId: row.rackId,
      parentDeviceId: null,
      startU: null,
      heightU: row.heightU ?? 1,
      face: row.face === "rear" ? "rear" : "front",
      column: null,
      columnSpan: null,
      shelfX: null,
      shelfY: null,
      shelfWidth: null,
      shelfHeight: null,
      orientation: null,
      side: row.rackSide === "right" ? "right" : "left",
    };
  }

  if (mountKind === "rack-top") {
    const geometry = rackSlotGeometry(row);
    return {
      mountKind,
      roomId: row.roomId ?? null,
      rackId: row.rackId,
      parentDeviceId: null,
      startU: null,
      heightU: row.heightU ?? 1,
      face: row.face === "rear" ? "rear" : "front",
      column: geometry.column,
      columnSpan: geometry.columnSpan,
      shelfX: null,
      shelfY: null,
      shelfWidth: null,
      shelfHeight: null,
      orientation: null,
      side: null,
    };
  }

  return {
    mountKind: "loose",
    roomId: row.roomId ?? null,
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

function requiredNullableString(body: Record<string, unknown>, key: string) {
  if (!(key in body)) {
    throw new ValidationError(`${key} must be included in placement state.`);
  }
  return optionalString(body, key, { maxLength: 120 }) ?? null;
}

function requiredNullableInteger(
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
) {
  if (!(key in body)) {
    throw new ValidationError(`${key} must be included in placement state.`);
  }
  return optionalInteger(body, key, options) ?? null;
}

function requiredNullableNumber(
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
) {
  if (!(key in body)) {
    throw new ValidationError(`${key} must be included in placement state.`);
  }
  return optionalNumber(body, key, options) ?? null;
}

function requiredNullableEnum<T extends readonly string[]>(
  body: Record<string, unknown>,
  key: string,
  values: T,
) {
  if (!(key in body)) {
    throw new ValidationError(`${key} must be included in placement state.`);
  }
  return optionalEnum(body, key, values) ?? null;
}

export function parseRackStudioPlacementState(
  value: unknown,
): RackStudioPlacementState {
  const body = asObject(value);
  const orientation = requiredNullableInteger(body, "orientation", {
    min: 0,
    max: 90,
  });
  if (
    orientation !== null &&
    !SHELF_ORIENTATIONS.includes(
      orientation as (typeof SHELF_ORIENTATIONS)[number],
    )
  ) {
    throw new ValidationError("Shelf orientation must be 0 or 90 degrees.");
  }
  return {
    mountKind: requiredEnum(body, "mountKind", MOUNT_KINDS),
    roomId: requiredNullableString(body, "roomId"),
    rackId: requiredNullableString(body, "rackId"),
    parentDeviceId: requiredNullableString(body, "parentDeviceId"),
    startU: requiredNullableInteger(body, "startU", { min: 1, max: 100 }),
    heightU: requiredNullableInteger(body, "heightU", { min: 1, max: 20 }),
    face: requiredNullableEnum(body, "face", RACK_FACES),
    column: requiredNullableInteger(body, "column", { min: 0, max: 11 }),
    columnSpan: requiredNullableInteger(body, "columnSpan", {
      min: 1,
      max: 12,
    }),
    shelfX: requiredNullableNumber(body, "shelfX", { min: 0, max: 1000 }),
    shelfY: requiredNullableNumber(body, "shelfY", { min: 0, max: 1000 }),
    shelfWidth: requiredNullableNumber(body, "shelfWidth", {
      min: 1,
      max: 1000,
    }),
    shelfHeight: requiredNullableNumber(body, "shelfHeight", {
      min: 1,
      max: 1000,
    }),
    orientation: orientation as RackStudioPlacementState["orientation"],
    side: requiredNullableEnum(body, "side", RACK_SIDES),
  };
}

export function rackStudioPlacementStatesEqual(
  left: RackStudioPlacementState,
  right: RackStudioPlacementState,
) {
  return (Object.keys(left) as Array<keyof RackStudioPlacementState>).every(
    (key) => left[key] === right[key],
  );
}

function getRack(rackId: string, labId: string) {
  const rack = db
    .prepare("SELECT id, labId, roomId, totalU FROM racks WHERE id = ?")
    .get(rackId) as RackRow | undefined;
  if (!rack) throw new ValidationError("Selected rack does not exist.");
  if (rack.labId !== labId) {
    throw new ValidationError("Selected rack must belong to the same lab.");
  }
  return rack;
}

function validateRoom(roomId: string | null, labId: string) {
  if (!roomId) return null;
  const room = db
    .prepare("SELECT labId FROM rooms WHERE id = ?")
    .get(roomId) as { labId: string } | undefined;
  if (!room) throw new ValidationError("Selected room does not exist.");
  if (room.labId !== labId) {
    throw new ValidationError("Selected room must belong to the same lab.");
  }
  return roomId;
}

function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function shelfBounds(state: RackStudioPlacementState) {
  const x = state.shelfX!;
  const y = state.shelfY!;
  const width =
    state.orientation === 90 ? state.shelfHeight! : state.shelfWidth!;
  const height =
    state.orientation === 90 ? state.shelfWidth! : state.shelfHeight!;
  return { x, y, width, height };
}

function assertDirectPlacementAvailable(
  device: RackStudioDeviceRow,
  state: RackStudioPlacementState,
  rack: RackRow,
) {
  if (
    state.startU === null ||
    state.heightU === null ||
    state.face === null ||
    state.column === null ||
    state.columnSpan === null
  ) {
    throw new ValidationError(
      "Direct rack placement requires U, height, face, column, and column span.",
    );
  }
  const endU = state.startU + state.heightU - 1;
  if (endU > rack.totalU) {
    throw new ValidationError(
      `Device would exceed rack height ${rack.totalU}U.`,
    );
  }
  if (state.column + state.columnSpan > 12) {
    throw new ValidationError("Device would exceed the 12-column rack width.");
  }

  const rows = db
    .prepare(
      `
        SELECT *
        FROM devices
        WHERE rackId = ?
          AND COALESCE(face, 'front') = ?
          AND startU IS NOT NULL
          AND heightU IS NOT NULL
          AND COALESCE(rackMountKind, 'direct') = 'direct'
          AND id != ?
      `,
    )
    .all(rack.id, state.face, device.id) as RackStudioDeviceRow[];

  for (const row of rows) {
    const existing = currentRackStudioPlacement(row);
    if (
      existing.startU === null ||
      existing.heightU === null ||
      existing.column === null ||
      existing.columnSpan === null
    ) {
      continue;
    }
    const existingEndU = existing.startU + existing.heightU - 1;
    const uOverlap = !(endU < existing.startU || state.startU > existingEndU);
    const columnOverlap =
      state.column < existing.column + existing.columnSpan &&
      state.column + state.columnSpan > existing.column;
    if (uOverlap && columnOverlap) {
      throw new ValidationError(`Rack position overlaps with ${row.hostname}.`);
    }
  }
}

function resolveDirectPlacement(
  device: RackStudioDeviceRow,
  requested: RackStudioPlacementState,
): RackStudioPlacementState {
  if (!requested.rackId) {
    throw new ValidationError("Direct rack placement requires a rack.");
  }
  const rack = getRack(requested.rackId, device.labId);
  assertDirectPlacementAvailable(device, requested, rack);
  return {
    mountKind: "direct",
    roomId: rack.roomId,
    rackId: rack.id,
    parentDeviceId: null,
    startU: requested.startU,
    heightU: requested.heightU,
    face: requested.face,
    column: requested.column,
    columnSpan: requested.columnSpan,
    shelfX: null,
    shelfY: null,
    shelfWidth: null,
    shelfHeight: null,
    orientation: null,
    side: null,
  };
}

function resolveShelfPlacement(
  device: RackStudioDeviceRow,
  requested: RackStudioPlacementState,
): RackStudioPlacementState {
  if (!requested.parentDeviceId) {
    throw new ValidationError("Shelf placement requires a parent shelf.");
  }
  const parent = db
    .prepare("SELECT * FROM devices WHERE id = ?")
    .get(requested.parentDeviceId) as RackStudioDeviceRow | undefined;
  if (!parent) throw new ValidationError("Selected shelf does not exist.");
  if (parent.id === device.id) {
    throw new ValidationError("A device cannot be its own shelf.");
  }
  if (parent.labId !== device.labId) {
    throw new ValidationError("Selected shelf must belong to the same lab.");
  }
  if (deviceTypeBase(parent.deviceType) !== "rack_shelf") {
    throw new ValidationError(
      "Shelf-mounted gear requires a rack shelf / tray parent.",
    );
  }
  if (!parent.rackId || parent.startU === null) {
    throw new ValidationError("Selected shelf is not mounted in a rack.");
  }
  if (
    requested.shelfX === null ||
    requested.shelfY === null ||
    requested.shelfWidth === null ||
    requested.shelfHeight === null ||
    requested.orientation === null
  ) {
    throw new ValidationError(
      "Shelf placement requires a complete rectangular footprint and orientation.",
    );
  }
  const rack = getRack(parent.rackId, device.labId);
  const resolved: RackStudioPlacementState = {
    mountKind: "shelf",
    roomId: rack.roomId,
    rackId: rack.id,
    parentDeviceId: parent.id,
    startU: null,
    heightU: requested.heightU ?? device.heightU ?? 1,
    face: parent.face === "rear" ? "rear" : "front",
    column: null,
    columnSpan: null,
    shelfX: requested.shelfX,
    shelfY: requested.shelfY,
    shelfWidth: requested.shelfWidth,
    shelfHeight: requested.shelfHeight,
    orientation: requested.orientation,
    side: null,
  };
  const bounds = shelfBounds(resolved);
  if (bounds.x + bounds.width > 1000 || bounds.y + bounds.height > 1000) {
    throw new ValidationError(
      "Shelf footprint exceeds the parent shelf bounds.",
    );
  }

  const siblings = db
    .prepare(
      `
        SELECT *
        FROM devices
        WHERE parentDeviceId = ?
          AND id != ?
          AND (placement = 'shelf' OR rackMountKind = 'shelf')
      `,
    )
    .all(parent.id, device.id) as RackStudioDeviceRow[];
  for (const sibling of siblings) {
    const existing = currentRackStudioPlacement(sibling);
    if (
      existing.shelfX === null ||
      existing.shelfY === null ||
      existing.shelfWidth === null ||
      existing.shelfHeight === null
    ) {
      continue;
    }
    if (rectanglesOverlap(bounds, shelfBounds(existing))) {
      throw new ValidationError(
        `Shelf footprint overlaps with ${sibling.hostname}.`,
      );
    }
  }
  return resolved;
}

function resolveSidePlacement(
  device: RackStudioDeviceRow,
  requested: RackStudioPlacementState,
): RackStudioPlacementState {
  if (!requested.rackId || !requested.face || !requested.side) {
    throw new ValidationError(
      "0U side placement requires a rack, face, and left or right side.",
    );
  }
  const rack = getRack(requested.rackId, device.labId);
  const conflict = db
    .prepare(
      `
        SELECT hostname
        FROM devices
        WHERE rackId = ?
          AND COALESCE(face, 'front') = ?
          AND rackMountKind = 'side'
          AND rackSide = ?
          AND id != ?
        LIMIT 1
      `,
    )
    .get(rack.id, requested.face, requested.side, device.id) as
    { hostname: string } | undefined;
  if (conflict) {
    throw new ValidationError(`Rack side conflicts with ${conflict.hostname}.`);
  }
  return {
    mountKind: "side",
    roomId: rack.roomId,
    rackId: rack.id,
    parentDeviceId: null,
    startU: null,
    heightU: requested.heightU ?? device.heightU ?? 1,
    face: requested.face,
    column: null,
    columnSpan: null,
    shelfX: null,
    shelfY: null,
    shelfWidth: null,
    shelfHeight: null,
    orientation: null,
    side: requested.side,
  };
}

function resolveRackTopPlacement(
  device: RackStudioDeviceRow,
  requested: RackStudioPlacementState,
): RackStudioPlacementState {
  if (
    !requested.rackId ||
    !requested.face ||
    requested.heightU === null ||
    requested.column === null ||
    requested.columnSpan === null
  ) {
    throw new ValidationError(
      "Rack-top placement requires a rack, face, height, column, and column span.",
    );
  }
  if (requested.column + requested.columnSpan > 12) {
    throw new ValidationError(
      "Rack-top equipment would exceed the 12-column rack width.",
    );
  }
  const rack = getRack(requested.rackId, device.labId);
  const occupants = db
    .prepare(
      `
        SELECT *
        FROM devices
        WHERE rackId = ?
          AND rackMountKind = 'rack-top'
          AND id != ?
      `,
    )
    .all(rack.id, device.id) as RackStudioDeviceRow[];
  for (const occupant of occupants) {
    const existing = currentRackStudioPlacement(occupant);
    if (existing.column === null || existing.columnSpan === null) continue;
    if (
      requested.column < existing.column + existing.columnSpan &&
      requested.column + requested.columnSpan > existing.column
    ) {
      throw new ValidationError(
        `Rack-top position overlaps with ${occupant.hostname}.`,
      );
    }
  }
  return {
    mountKind: "rack-top",
    roomId: rack.roomId,
    rackId: rack.id,
    parentDeviceId: null,
    startU: null,
    heightU: requested.heightU,
    face: requested.face,
    column: requested.column,
    columnSpan: requested.columnSpan,
    shelfX: null,
    shelfY: null,
    shelfWidth: null,
    shelfHeight: null,
    orientation: null,
    side: null,
  };
}

function resolveLoosePlacement(
  device: RackStudioDeviceRow,
  requested: RackStudioPlacementState,
): RackStudioPlacementState {
  return {
    mountKind: "loose",
    roomId: validateRoom(requested.roomId, device.labId),
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

export function resolveRackStudioPlacement(
  device: RackStudioDeviceRow,
  requested: RackStudioPlacementState,
) {
  if (requested.mountKind === "direct") {
    return resolveDirectPlacement(device, requested);
  }
  if (requested.mountKind === "shelf") {
    return resolveShelfPlacement(device, requested);
  }
  if (requested.mountKind === "side") {
    return resolveSidePlacement(device, requested);
  }
  if (requested.mountKind === "rack-top") {
    return resolveRackTopPlacement(device, requested);
  }
  return resolveLoosePlacement(device, requested);
}

export function rackSlotForColumns(column: number | null, span: number | null) {
  if (column === 0 && span === 6) return "left";
  if (column === 6 && span === 6) return "right";
  return "full";
}
