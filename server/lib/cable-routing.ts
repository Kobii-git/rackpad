import { ValidationError } from "./validation.js";

export const MAX_CABLE_ROUTE_WAYPOINTS = 32;
export const CABLE_ROUTE_CANVAS_WIDTH = 1000;
export const CABLE_ROUTE_CANVAS_HEIGHT = 100_000;

const PHYSICAL_PORT_KINDS = new Set([
  "rj45",
  "sfp",
  "sfp_plus",
  "qsfp",
  "fiber",
  "power",
  "console",
  "usb",
  "sff",
  "other",
]);

const OPTICAL_PORT_KINDS = new Set(["sfp", "sfp_plus", "fiber"]);

export interface CableRouteWaypoint {
  id: string;
  roomId: string;
  face: "front" | "rear";
  x: number;
  y: number;
}

export function isPhysicalCableEndpoint(kind: string, portRole?: string | null) {
  return portRole !== "aggregate" && PHYSICAL_PORT_KINDS.has(kind);
}

export function physicalConnectorPairIsUsual(fromKind: string, toKind: string) {
  if (fromKind === toKind) return true;
  return OPTICAL_PORT_KINDS.has(fromKind) && OPTICAL_PORT_KINDS.has(toKind);
}

export function parseCableRouteWaypoints(
  value: unknown,
  key = "routeWaypoints",
): CableRouteWaypoint[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError(`${key} must be an array.`);
  }
  if (value.length > MAX_CABLE_ROUTE_WAYPOINTS) {
    throw new ValidationError(
      `${key} must contain ${MAX_CABLE_ROUTE_WAYPOINTS} points or fewer.`,
    );
  }

  const waypointIds = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ValidationError(`${key}[${index}] must be an object.`);
    }
    const point = entry as Record<string, unknown>;
    const unknownKeys = Object.keys(point).filter(
      (field) => !["id", "roomId", "face", "x", "y"].includes(field),
    );
    if (unknownKeys.length > 0) {
      throw new ValidationError(
        `${key}[${index}] contains unsupported fields: ${unknownKeys.join(", ")}.`,
      );
    }
    const id = typeof point.id === "string" ? point.id.trim() : "";
    const roomId =
      typeof point.roomId === "string" ? point.roomId.trim() : "";
    const face = point.face;
    const x = point.x;
    const y = point.y;
    if (!id || id.length > 80) {
      throw new ValidationError(
        `${key}[${index}].id must be between 1 and 80 characters.`,
      );
    }
    if (waypointIds.has(id)) {
      throw new ValidationError(`${key} must contain unique waypoint IDs.`);
    }
    waypointIds.add(id);
    if (!roomId || roomId.length > 80) {
      throw new ValidationError(
        `${key}[${index}].roomId must be between 1 and 80 characters.`,
      );
    }
    if (face !== "front" && face !== "rear") {
      throw new ValidationError(
        `${key}[${index}].face must be front or rear.`,
      );
    }
    if (
      typeof x !== "number" ||
      !Number.isFinite(x) ||
      x < 0 ||
      x > CABLE_ROUTE_CANVAS_WIDTH
    ) {
      throw new ValidationError(
        `${key}[${index}].x must be between 0 and ${CABLE_ROUTE_CANVAS_WIDTH}.`,
      );
    }
    if (
      typeof y !== "number" ||
      !Number.isFinite(y) ||
      y < 0 ||
      y > CABLE_ROUTE_CANVAS_HEIGHT
    ) {
      throw new ValidationError(
        `${key}[${index}].y must be between 0 and ${CABLE_ROUTE_CANVAS_HEIGHT}.`,
      );
    }
    return { id, roomId, face, x, y };
  });
}

export function decodeCableRouteWaypoints(value: unknown) {
  try {
    const decoded = typeof value === "string" ? JSON.parse(value) : value;
    return parseCableRouteWaypoints(decoded);
  } catch {
    return [];
  }
}
