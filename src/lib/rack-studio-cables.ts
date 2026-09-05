import type {
  CableRouteWaypoint,
  Device,
  DevicePhysicalLayout,
  Port,
  PortKind,
  PortLink,
  Rack,
  RackFace,
  Room,
} from "./types";
import {
  RACK_STUDIO_CANVAS_HEIGHT,
  RACK_STUDIO_CANVAS_WIDTH,
  RACK_STUDIO_RACK_HEIGHT,
  RACK_STUDIO_RACK_WIDTH,
  rackCanvasState,
} from "./rack-studio";
import {
  buildRackElevationScene,
  buildRackStudioScene,
  rackFaceForPhysicalFace,
  type RackStudioRect,
  type RackStudioScene,
} from "./rack-studio-scene";

export type RackStudioCableRouteStyle = "smooth" | "orthogonal";

export const RACK_STUDIO_ROUTE_STYLE_STORAGE_KEY =
  "rackpad.rack-studio.route-style";
export const RACK_STUDIO_SHOW_LABELS_STORAGE_KEY =
  "rackpad.rack-studio.show-all-labels";

export function rackStudioRouteStylePreference(
  value: string | null | undefined,
): RackStudioCableRouteStyle {
  return value === "orthogonal" ? "orthogonal" : "smooth";
}

export function rackStudioShowLabelsPreference(
  value: string | null | undefined,
) {
  return value === "true";
}

export type PhysicalCableCategory =
  "network" | "fiber" | "power" | "console" | "usb" | "storage" | "other";

export interface RackStudioCableAnchor {
  portId: string;
  deviceId: string;
  roomId: string | null;
  rackId: string | null;
  face: RackFace;
  rackFace: RackFace;
  x: number;
  y: number;
}

export interface RackStudioCableRoute {
  link: PortLink;
  category: PhysicalCableCategory;
  color: string;
  points: Array<{ x: number; y: number }>;
  manualPointIndexes: number[];
  path: string;
  geometry: CableRouteGeometry;
  label: string;
  crossRoom: boolean;
  handoff?: "cross-room" | "hidden-face";
  handoffFace?: RackFace;
  remoteRoomId?: string;
}

interface PendingCableRoute {
  route: Omit<
    RackStudioCableRoute,
    "points" | "path" | "manualPointIndexes" | "geometry"
  >;
  from: RackStudioCableAnchor;
  to?: RackStudioCableAnchor;
  manualPoints: Array<{ x: number; y: number }>;
}

export type CablePoint = { x: number; y: number };
export type CableRouteGeometry =
  | {
      kind: "polyline";
      points: CablePoint[];
      style: RackStudioCableRouteStyle;
      manualPointIndexes: number[];
    }
  | {
      kind: "cubic";
      from: CablePoint;
      control1: CablePoint;
      control2: CablePoint;
      to: CablePoint;
    };

export interface CableRoutingInput {
  id: string;
  from: RackStudioCableAnchor;
  to?: RackStudioCableAnchor;
  manualPoints: CablePoint[];
  allowDirect?: boolean;
}

export interface RoutePlanningContext {
  width: number;
  height: number;
  racks: Array<{
    id: string;
    rect: RackStudioRect;
    unitHeight: number;
    face?: RackFace;
  }>;
  obstacles: Array<{
    id: string;
    rackId: string | null;
    rect: RackStudioRect;
    face?: RackFace;
    parentDeviceId?: string;
  }>;
}

const OPTICAL_KINDS = new Set<PortKind>(["sfp", "sfp_plus", "fiber"]);

export function portSupportsPhysicalPatching(port: Port) {
  return (
    port.portRole !== "aggregate" &&
    port.kind !== "virtual" &&
    port.kind !== "wifi"
  );
}

export function connectorPairIsUsual(from: Port, to: Port) {
  if (from.kind === to.kind) return true;
  return OPTICAL_KINDS.has(from.kind) && OPTICAL_KINDS.has(to.kind);
}

export function cableCategoryForPorts(
  from: Port | undefined,
  to: Port | undefined,
): PhysicalCableCategory {
  const kinds = new Set([from?.kind, to?.kind]);
  if (kinds.has("power")) return "power";
  if (kinds.has("console")) return "console";
  if (kinds.has("usb")) return "usb";
  if (kinds.has("sff")) return "storage";
  if (
    kinds.has("fiber") ||
    kinds.has("sfp") ||
    kinds.has("sfp_plus") ||
    kinds.has("qsfp")
  ) {
    return "fiber";
  }
  if (kinds.has("rj45")) return "network";
  return "other";
}

export function defaultCableMetadata(from: Port, to: Port) {
  const category = cableCategoryForPorts(from, to);
  const defaults: Record<
    PhysicalCableCategory,
    { cableType: string; color: string }
  > = {
    network: { cableType: "Cat6A", color: "#22d3ee" },
    fiber: { cableType: "Fiber", color: "#a78bfa" },
    power: { cableType: "Power", color: "#f59e0b" },
    console: { cableType: "Console", color: "#f472b6" },
    usb: { cableType: "USB", color: "#60a5fa" },
    storage: { cableType: "SAS", color: "#34d399" },
    other: { cableType: "Other", color: "#94a3b8" },
  };
  return defaults[category];
}

export function defaultCableColor(category: PhysicalCableCategory) {
  return {
    network: "#22d3ee",
    fiber: "#a78bfa",
    power: "#f59e0b",
    console: "#f472b6",
    usb: "#60a5fa",
    storage: "#34d399",
    other: "#94a3b8",
  }[category];
}

function bound(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function resolveRackStudioPortAnchor(input: {
  port: Port;
  devices: Device[];
  racks: Rack[];
  layouts: DevicePhysicalLayout[];
  face?: RackFace | "both";
}): RackStudioCableAnchor | null {
  const scene = buildRackStudioScene({
    face: input.face ?? "both",
    racks: input.racks,
    devices: input.devices,
    layouts: input.layouts,
    ports: [input.port],
  });
  const anchor = scene.portAnchors.find(
    (candidate) => candidate.portId === input.port.id,
  );
  return anchor
    ? {
        portId: anchor.portId,
        deviceId: anchor.deviceId,
        roomId: anchor.roomId,
        rackId: anchor.rackId,
        face: anchor.physicalFace,
        rackFace: anchor.rackFace,
        x: anchor.x,
        y: anchor.y,
      }
    : null;
}

const ROUTE_CLEARANCE = 10;
const ROUTE_LANE_GAP = 6;

class IntervalLaneAllocator {
  private readonly lanes = new Map<string, Array<Array<[number, number]>>>();

  allocate(group: string, start: number, end: number) {
    const interval: [number, number] = [
      Math.min(start, end),
      Math.max(start, end),
    ];
    const lanes = this.lanes.get(group) ?? [];
    let lane = lanes.findIndex((occupied) =>
      occupied.every(
        ([occupiedStart, occupiedEnd]) =>
          interval[1] + ROUTE_LANE_GAP <= occupiedStart ||
          interval[0] >= occupiedEnd + ROUTE_LANE_GAP,
      ),
    );
    if (lane < 0) {
      lane = lanes.length;
      lanes.push([]);
    }
    lanes[lane]!.push(interval);
    this.lanes.set(group, lanes);
    return lane;
  }
}

function compactRoutePoints(points: Array<{ x: number; y: number }>) {
  return points.filter(
    (point, index) =>
      index === 0 ||
      point.x !== points[index - 1]!.x ||
      point.y !== points[index - 1]!.y,
  );
}

function rackRectForAnchor(
  anchor: RackStudioCableAnchor,
  context: RoutePlanningContext,
) {
  return context.racks.find(
    (rack) =>
      rack.id === anchor.rackId &&
      (!rack.face || rack.face === anchor.rackFace),
  )?.rect;
}

function routeSide(
  rect: RackStudioRect,
  width: number,
  peerX?: number,
): "left" | "right" {
  if (peerX != null && peerX < rect.x) return "left";
  if (peerX != null && peerX > rect.x + rect.width) return "right";
  return rect.x >= width - (rect.x + rect.width) ? "left" : "right";
}

function gutterX(rect: RackStudioRect, side: "left" | "right", lane: number) {
  const offset = ROUTE_CLEARANCE + lane * ROUTE_LANE_GAP;
  return side === "left" ? rect.x - offset : rect.x + rect.width + offset;
}

function segmentIntersectsRect(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: RackStudioRect,
) {
  const left = rect.x - 2;
  const right = rect.x + rect.width + 2;
  const top = rect.y - 2;
  const bottom = rect.y + rect.height + 2;
  if (from.x === to.x) {
    return (
      from.x > left &&
      from.x < right &&
      Math.max(from.y, to.y) > top &&
      Math.min(from.y, to.y) < bottom
    );
  }
  if (from.y === to.y) {
    return (
      from.y > top &&
      from.y < bottom &&
      Math.max(from.x, to.x) > left &&
      Math.min(from.x, to.x) < right
    );
  }
  return false;
}

function routeAvoidsUnrelatedObstacles(
  points: Array<{ x: number; y: number }>,
  pending: CableRoutingInput,
  context: RoutePlanningContext,
) {
  return context.obstacles.every((obstacle) => {
    if (
      obstacle.id === pending.from.deviceId ||
      obstacle.id === pending.to?.deviceId ||
      obstacle.id === `rack:${pending.from.rackId}` ||
      obstacle.id === `rack:${pending.to?.rackId}`
    ) {
      return true;
    }
    return points
      .slice(1)
      .every(
        (point, index) =>
          !segmentIntersectsRect(points[index]!, point, obstacle.rect),
      );
  });
}

function automaticRoutePoints(
  pending: CableRoutingInput,
  context: RoutePlanningContext,
  allocator: IntervalLaneAllocator,
) {
  const { from, to } = pending;
  const fromRack = rackRectForAnchor(from, context);
  const toRack = to ? rackRectForAnchor(to, context) : undefined;

  if (!to) {
    const side = fromRack
      ? routeSide(fromRack, context.width)
      : from.x < context.width / 2
        ? "left"
        : "right";
    const lane = allocator.allocate(
      `handoff:${side}`,
      from.y,
      from.y + ROUTE_LANE_GAP,
    );
    const exitX = side === "left" ? 4 : context.width - 4;
    const escapeX = fromRack
      ? gutterX(fromRack, side, lane)
      : from.x + (side === "left" ? -ROUTE_CLEARANCE : ROUTE_CLEARANCE);
    const targetY = bound(
      from.y + (lane % 2 === 0 ? lane : -lane) * ROUTE_LANE_GAP,
      6,
      context.height - 6,
    );
    return compactRoutePoints([
      from,
      { x: escapeX, y: from.y },
      { x: escapeX, y: targetY },
      { x: exitX, y: targetY },
    ]);
  }

  if (fromRack && toRack && from.rackId === to.rackId) {
    const preferred = routeSide(fromRack, context.width);
    const sides = [preferred, preferred === "left" ? "right" : "left"] as const;
    let fallback: Array<{ x: number; y: number }> | undefined;
    for (const side of sides) {
      const lane = allocator.allocate(
        `rack:${from.rackId}:${side}`,
        from.y,
        to.y,
      );
      const x = gutterX(fromRack, side, lane);
      const points = compactRoutePoints([
        from,
        { x, y: from.y },
        { x, y: to.y },
        to,
      ]);
      fallback ??= points;
      if (routeAvoidsUnrelatedObstacles(points, pending, context))
        return points;
    }
    return fallback!;
  }

  if (fromRack && toRack) {
    const fromSide = routeSide(fromRack, context.width, to.x);
    const toSide = routeSide(toRack, context.width, from.x);
    const lane = allocator.allocate(
      `room:${fromSide}:${toSide}`,
      Math.min(fromRack.x, toRack.x),
      Math.max(fromRack.x + fromRack.width, toRack.x + toRack.width),
    );
    const fromEscapeX = gutterX(fromRack, fromSide, lane);
    const toEscapeX = gutterX(toRack, toSide, lane);
    const routeLeft = Math.min(fromEscapeX, toEscapeX);
    const routeRight = Math.max(fromEscapeX, toEscapeX);
    const intersectingRackRects = context.racks
      .map((rack) => rack.rect)
      .filter((rect) => rect.x < routeRight && rect.x + rect.width > routeLeft);
    const bottom = Math.max(
      fromRack.y + fromRack.height,
      toRack.y + toRack.height,
      ...intersectingRackRects.map((rect) => rect.y + rect.height),
    );
    const top = Math.min(
      fromRack.y,
      toRack.y,
      ...intersectingRackRects.map((rect) => rect.y),
    );
    const bottomY = bottom + ROUTE_CLEARANCE + lane * ROUTE_LANE_GAP;
    const topY = top - ROUTE_CLEARANCE - lane * ROUTE_LANE_GAP;
    const corridorY =
      bottomY <= context.height - 4
        ? bottomY
        : topY >= 4
          ? topY
          : bound(bottomY, 4, context.height - 4);
    const candidates = [
      [fromSide, toSide],
      [fromSide === "left" ? "right" : "left", toSide],
      [fromSide, toSide === "left" ? "right" : "left"],
    ] as const;
    for (const [candidateFromSide, candidateToSide] of candidates) {
      const candidateFromX = gutterX(fromRack, candidateFromSide, lane);
      const candidateToX = gutterX(toRack, candidateToSide, lane);
      const points = compactRoutePoints([
        from,
        { x: candidateFromX, y: from.y },
        { x: candidateFromX, y: corridorY },
        { x: candidateToX, y: corridorY },
        { x: candidateToX, y: to.y },
        to,
      ]);
      if (routeAvoidsUnrelatedObstacles(points, pending, context))
        return points;
    }
    return compactRoutePoints([
      from,
      { x: fromEscapeX, y: from.y },
      { x: fromEscapeX, y: corridorY },
      { x: toEscapeX, y: corridorY },
      { x: toEscapeX, y: to.y },
      to,
    ]);
  }

  const lane = allocator.allocate("unracked", from.x, to.x);
  const corridorY = bound(
    Math.max(from.y, to.y) + ROUTE_CLEARANCE + lane * ROUTE_LANE_GAP,
    4,
    context.height - 4,
  );
  return compactRoutePoints([
    from,
    { x: from.x, y: corridorY },
    { x: to.x, y: corridorY },
    to,
  ]);
}

function routeSortKey(pending: CableRoutingInput) {
  const endpoints = [
    pending.from.portId,
    pending.to?.portId ?? "handoff",
  ].sort();
  return `${endpoints[0]}:${endpoints[1]}:${pending.id}`;
}

function pointPair(point: CablePoint) {
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
}

function roundedPath(
  points: Array<{ x: number; y: number }>,
  fixedIndexes: Set<number>,
  format: (point: CablePoint) => string,
) {
  if (points.length < 2) return "";
  const commands = [`M ${format(points[0]!)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    const next = points[index + 1]!;
    if (fixedIndexes.has(index)) {
      commands.push(`L ${format(point)}`);
      continue;
    }
    const incoming = Math.hypot(point.x - previous.x, point.y - previous.y);
    const outgoing = Math.hypot(next.x - point.x, next.y - point.y);
    const radius = Math.min(10, incoming / 3, outgoing / 3);
    if (radius <= 0) continue;
    const entry = {
      x: point.x + ((previous.x - point.x) / incoming) * radius,
      y: point.y + ((previous.y - point.y) / incoming) * radius,
    };
    const exit = {
      x: point.x + ((next.x - point.x) / outgoing) * radius,
      y: point.y + ((next.y - point.y) / outgoing) * radius,
    };
    commands.push(`L ${format(entry)} Q ${format(point)} ${format(exit)}`);
  }
  const last = points.at(-1)!;
  commands.push(`L ${format(last)}`);
  return commands.join(" ");
}

function serializeCablePoints(
  points: Array<{ x: number; y: number }>,
  style: RackStudioCableRouteStyle = "orthogonal",
  manualPointIndexes: number[] = [],
  format: (point: CablePoint) => string = pointPair,
) {
  if (style === "smooth") {
    return roundedPath(points, new Set(manualPointIndexes), format);
  }
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${format(point)}`)
    .join(" ");
}

export function cablePath(
  points: CablePoint[],
  style: RackStudioCableRouteStyle = "orthogonal",
  manualPointIndexes: number[] = [],
) {
  return serializeCablePoints(points, style, manualPointIndexes);
}

/** Geometry is the source of truth for both live strokes and translated exports. */
export function renderCableGeometry(
  geometry: CableRouteGeometry,
  offset: CablePoint = { x: 0, y: 0 },
  scale: CablePoint = { x: 1, y: 1 },
) {
  const shift = (point: CablePoint) => ({
    x: point.x * scale.x + offset.x,
    y: point.y * scale.y + offset.y,
  });
  const pair = (point: CablePoint) => {
    const value = shift(point);
    return `${value.x.toFixed(2)} ${value.y.toFixed(2)}`;
  };
  return geometry.kind === "cubic"
    ? `M ${pair(geometry.from)} C ${pair(geometry.control1)} ${pair(geometry.control2)} ${pair(geometry.to)}`
    : serializeCablePoints(
        geometry.points,
        geometry.style,
        geometry.manualPointIndexes,
        pair,
      );
}

/** A stable on-path label/focus point, without browser-only SVG measurement. */
export function cableGeometryLabelPoint(
  geometry: CableRouteGeometry,
): CablePoint {
  if (geometry.kind === "cubic") {
    return {
      x:
        (geometry.from.x +
          3 * geometry.control1.x +
          3 * geometry.control2.x +
          geometry.to.x) /
        8,
      y:
        (geometry.from.y +
          3 * geometry.control1.y +
          3 * geometry.control2.y +
          geometry.to.y) /
        8,
    };
  }
  let longest = -1;
  let result = geometry.points[0] ?? { x: 0, y: 0 };
  for (let index = 1; index < geometry.points.length; index += 1) {
    const from = geometry.points[index - 1]!;
    const to = geometry.points[index]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    if (
      length < longest ||
      (length === longest &&
        (midpoint.y > result.y ||
          (midpoint.y === result.y && midpoint.x >= result.x)))
    )
      continue;
    longest = length;
    // Rounded corners trim at most a third of each segment, leaving its
    // midpoint on the straight section in both Smooth and Orthogonal modes.
    result = midpoint;
  }
  return result;
}

function directCurve(
  pending: CableRoutingInput,
  context: RoutePlanningContext,
): CableRouteGeometry | null {
  const { from, to } = pending;
  if (
    !to ||
    pending.allowDirect === false ||
    pending.manualPoints.length ||
    !from.rackId ||
    from.rackId !== to.rackId ||
    from.rackFace !== to.rackFace ||
    from.deviceId === to.deviceId
  )
    return null;
  const rack = context.racks.find(
    (entry) =>
      entry.id === from.rackId && (!entry.face || entry.face === from.rackFace),
  );
  if (!rack || Math.abs(from.y - to.y) > rack.unitHeight * 4) return null;

  // Canonical endpoint order gives the same physical curve when a link is reversed.
  const reverse =
    from.y > to.y ||
    (from.y === to.y &&
      (from.x > to.x || (from.x === to.x && from.portId > to.portId)));
  const [top, bottom] = reverse ? [to, from] : [from, to];
  const ignored = new Set([from.deviceId, to.deviceId, `rack:${from.rackId}`]);
  // Shelf/container faceplates contain their child devices; they are not obstacles.
  for (const endpoint of [from.deviceId, to.deviceId]) {
    let parent = context.obstacles.find(
      (entry) => entry.id === endpoint,
    )?.parentDeviceId;
    while (parent && !ignored.has(parent)) {
      ignored.add(parent);
      parent = context.obstacles.find(
        (entry) => entry.id === parent,
      )?.parentDeviceId;
    }
  }
  const obstacles = context.obstacles.filter(
    (entry) =>
      !ignored.has(entry.id) && (!entry.face || entry.face === from.rackFace),
  );
  const deltaY = bottom.y - top.y;
  const bow = Math.min(
    rack.rect.width * 0.045,
    Math.max(rack.unitHeight * 0.65, deltaY * 0.3),
  );
  const deviceRects = context.obstacles.filter(
    (entry) =>
      (entry.id === from.deviceId || entry.id === to.deviceId) &&
      (!entry.face || entry.face === from.rackFace),
  );
  const center = deviceRects.length
    ? deviceRects.reduce(
        (sum, entry) => sum + entry.rect.x + entry.rect.width / 2,
        0,
      ) / deviceRects.length
    : rack.rect.x + rack.rect.width / 2;
  const preferred = center <= rack.rect.x + rack.rect.width / 2 ? 1 : -1;
  for (const direction of [preferred, -preferred]) {
    const control1 = { x: top.x + direction * bow, y: top.y + deltaY / 3 };
    const control2 = {
      x: bottom.x + direction * bow,
      y: bottom.y - deltaY / 3,
    };
    const hull = [top, control1, control2, bottom];
    const left = Math.min(...hull.map((point) => point.x));
    const right = Math.max(...hull.map((point) => point.x));
    const upper = Math.min(...hull.map((point) => point.y));
    const lower = Math.max(...hull.map((point) => point.y));
    if (
      left < rack.rect.x ||
      right > rack.rect.x + rack.rect.width ||
      upper < 0 ||
      lower > context.height
    )
      continue;
    // A Bezier stays within its control-point hull. Conservatively rejecting a
    // padded hull intersection avoids missed collisions from curve sampling.
    const padding = Math.min(2, rack.unitHeight * 0.08);
    if (
      obstacles.some(
        ({ rect }) =>
          right > rect.x - padding &&
          left < rect.x + rect.width + padding &&
          lower > rect.y - padding &&
          upper < rect.y + rect.height + padding,
      )
    )
      continue;
    return {
      kind: "cubic",
      from,
      control1: reverse ? control2 : control1,
      control2: reverse ? control1 : control2,
      to,
    };
  }
  return null;
}

export function planPhysicalCableRoutes(
  inputs: CableRoutingInput[],
  context: RoutePlanningContext,
  style: RackStudioCableRouteStyle,
) {
  const allocator = new IntervalLaneAllocator();
  return [...inputs]
    .sort((left, right) =>
      routeSortKey(left).localeCompare(routeSortKey(right)),
    )
    .map((pending) => {
      const manualPointIndexes = pending.to
        ? pending.manualPoints.map((_, index) => index + 1)
        : [];
      const curve = style === "smooth" ? directCurve(pending, context) : null;
      const points =
        curve && pending.to
          ? [pending.from, pending.to]
          : pending.to && pending.manualPoints.length
            ? [pending.from, ...pending.manualPoints, pending.to]
            : automaticRoutePoints(pending, context, allocator);
      const geometry: CableRouteGeometry = curve ?? {
        kind: "polyline",
        points,
        style,
        manualPointIndexes,
      };
      return {
        id: pending.id,
        points,
        manualPointIndexes,
        geometry,
        path: renderCableGeometry(geometry),
      };
    });
}

function planPendingRoutes(
  pendingRoutes: PendingCableRoute[],
  context: RoutePlanningContext,
  style: RackStudioCableRouteStyle,
): RackStudioCableRoute[] {
  const routes = new Map(
    pendingRoutes.map((pending) => [pending.route.link.id, pending.route]),
  );
  return planPhysicalCableRoutes(
    pendingRoutes.map((pending) => ({
      id: pending.route.link.id,
      from: pending.from,
      to: pending.to,
      manualPoints: pending.manualPoints,
      allowDirect:
        !pending.route.handoff && !pending.route.link.routeWaypoints?.length,
    })),
    context,
    style,
  ).map(({ id, ...geometry }) => ({ ...routes.get(id)!, ...geometry }));
}

export function buildRackStudioCableRoutes(input: {
  room?: Room;
  face: RackFace | "both";
  devices: Device[];
  racks: Rack[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  links: PortLink[];
  category?: PhysicalCableCategory | "all";
  style?: RackStudioCableRouteStyle;
  scene?: RackStudioScene;
}) {
  if (!input.room) return [];
  const scene =
    input.scene ??
    buildRackStudioScene({
      room: input.room,
      face: input.face,
      devices: input.devices,
      racks: input.racks,
      layouts: input.layouts,
      ports: input.ports,
    });
  const portById = new Map(input.ports.map((port) => [port.id, port]));
  const deviceById = new Map(
    input.devices.map((device) => [device.id, device]),
  );
  const rackById = new Map(input.racks.map((rack) => [rack.id, rack]));
  const sceneAnchorByPort = new Map(
    scene.portAnchors.map((anchor) => [anchor.portId, anchor]),
  );
  const anchors = new Map<string, RackStudioCableAnchor | null>();
  for (const port of input.ports) {
    const anchor = sceneAnchorByPort.get(port.id);
    anchors.set(
      port.id,
      anchor
        ? {
            portId: anchor.portId,
            deviceId: anchor.deviceId,
            roomId: anchor.roomId,
            rackId: anchor.rackId,
            face: anchor.physicalFace,
            rackFace: anchor.rackFace,
            x: anchor.x,
            y: anchor.y,
          }
        : null,
    );
  }

  const portRoomId = (port: Port | undefined) => {
    if (!port) return null;
    const device = deviceById.get(port.deviceId);
    if (!device) return null;
    return (
      device.roomId ??
      (device.rackId ? rackById.get(device.rackId)?.roomId : null) ??
      null
    );
  };
  const hiddenRackFace = (port: Port | undefined): RackFace | undefined => {
    if (!port) return undefined;
    const device = deviceById.get(port.deviceId);
    if (!device) return undefined;
    const physicalFace = port.face === "rear" ? "rear" : "front";
    return rackFaceForPhysicalFace(device, physicalFace);
  };

  const pendingRoutes: PendingCableRoute[] = [];
  for (const link of [...input.links].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (link.visible === false) continue;
    const fromPort = portById.get(link.fromPortId);
    const toPort = portById.get(link.toPortId);
    const category = cableCategoryForPorts(fromPort, toPort);
    if (
      input.category &&
      input.category !== "all" &&
      category !== input.category
    ) {
      continue;
    }
    const from = anchors.get(link.fromPortId) ?? null;
    const to = anchors.get(link.toPortId) ?? null;
    const fromBelongsToRoom = portRoomId(fromPort) === input.room.id;
    const toBelongsToRoom = portRoomId(toPort) === input.room.id;
    const fromLocal = fromBelongsToRoom && Boolean(from);
    const toLocal = toBelongsToRoom && Boolean(to);
    if (!fromLocal && !toLocal) continue;
    const label = link.label || link.cableType || category;
    const color = link.color || defaultCableColor(category);
    const crossRoom = !(fromBelongsToRoom && toBelongsToRoom);
    let toAnchor: RackStudioCableAnchor | undefined;
    let fromAnchor: RackStudioCableAnchor;
    let manualPoints: Array<{ x: number; y: number }> = [];
    let remoteRoomId: string | undefined;
    let handoff: RackStudioCableRoute["handoff"];
    let handoffFace: RackFace | undefined;

    if (fromLocal && toLocal && from && to) {
      manualPoints = (link.routeWaypoints ?? [])
        .filter(
          (point) =>
            point.roomId === input.room!.id &&
            (input.face === "both" || point.face === input.face),
        )
        .map((point) => ({ x: point.x, y: point.y }));
      fromAnchor = from;
      toAnchor = to;
    } else {
      const local = (fromLocal ? from : to)!;
      const remote = fromLocal ? to : from;
      const remotePort = fromLocal ? toPort : fromPort;
      const remoteBelongsToRoom = fromLocal
        ? toBelongsToRoom
        : fromBelongsToRoom;
      fromAnchor = local;
      if (remoteBelongsToRoom) {
        handoff = "hidden-face";
        handoffFace = hiddenRackFace(remotePort);
      } else {
        handoff = "cross-room";
        remoteRoomId = remote?.roomId ?? portRoomId(remotePort) ?? undefined;
      }
    }

    pendingRoutes.push({
      from: fromAnchor,
      to: toAnchor,
      manualPoints,
      route: {
        link,
        category,
        color,
        label,
        crossRoom,
        handoff,
        handoffFace,
        remoteRoomId,
      },
    });
  }
  const rackRects = input.racks.map((rack, index) => {
    const canvas = rackCanvasState(rack, index);
    return {
      id: rack.id,
      unitHeight: 188 / rack.totalU,
      rect: {
        x: canvas.x ?? 0,
        y: canvas.y ?? 0,
        width: RACK_STUDIO_RACK_WIDTH,
        height: RACK_STUDIO_RACK_HEIGHT,
      },
    };
  });
  return planPendingRoutes(
    pendingRoutes,
    {
      width: scene.bounds.width,
      height: scene.bounds.height,
      racks: rackRects,
      obstacles: [
        ...rackRects.map((rack) => ({
          id: `rack:${rack.id}`,
          rackId: rack.id,
          rect: rack.rect,
        })),
        ...scene.equipment.map((item) => ({
          id: item.device.id,
          rackId: item.rackId,
          face: item.rackFace,
          parentDeviceId: item.device.parentDeviceId,
          rect: item.rect,
        })),
      ],
    },
    input.style ?? "smooth",
  );
}

export function buildRackElevationCableRoutes(input: {
  rack: Rack;
  face: RackFace;
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  links: PortLink[];
  category?: PhysicalCableCategory | "all";
  style?: RackStudioCableRouteStyle;
  width?: number;
  unitHeight?: number;
}) {
  const width = input.width ?? 1000;
  const scene = buildRackElevationScene({
    rack: input.rack,
    rackFace: input.face,
    devices: input.devices,
    layouts: input.layouts,
    ports: input.ports,
    width,
    unitHeight: input.unitHeight,
  });
  const anchorByPort = new Map(
    scene.portAnchors.map((anchor) => [
      anchor.portId,
      {
        portId: anchor.portId,
        deviceId: anchor.deviceId,
        roomId: anchor.roomId,
        rackId: anchor.rackId,
        face: anchor.physicalFace,
        rackFace: anchor.rackFace,
        x: anchor.x,
        y: anchor.y,
      } satisfies RackStudioCableAnchor,
    ]),
  );
  const portById = new Map(input.ports.map((port) => [port.id, port]));
  const deviceById = new Map(
    input.devices.map((device) => [device.id, device]),
  );
  const pendingRoutes: PendingCableRoute[] = [];
  for (const link of [...input.links].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    if (link.visible === false) continue;
    const fromPort = portById.get(link.fromPortId);
    const toPort = portById.get(link.toPortId);
    const category = cableCategoryForPorts(fromPort, toPort);
    if (
      input.category &&
      input.category !== "all" &&
      input.category !== category
    ) {
      continue;
    }
    const from = anchorByPort.get(link.fromPortId);
    const to = anchorByPort.get(link.toPortId);
    if (!from && !to) continue;
    const local = (from ?? to)!;
    const remotePort = from ? toPort : fromPort;
    const remoteDevice = remotePort
      ? deviceById.get(remotePort.deviceId)
      : undefined;
    const handoffFace =
      !from || !to
        ? remoteDevice?.rackId === input.rack.id && remotePort
          ? rackFaceForPhysicalFace(
              remoteDevice,
              remotePort.face === "rear" ? "rear" : "front",
            )
          : undefined
        : undefined;
    pendingRoutes.push({
      from: from ?? local,
      to: from && to ? to : undefined,
      manualPoints: [],
      route: {
        link,
        category,
        color: link.color || defaultCableColor(category),
        label: link.label || link.cableType || category,
        crossRoom: Boolean((!from || !to) && !handoffFace),
        handoff:
          !from || !to
            ? handoffFace
              ? "hidden-face"
              : "cross-room"
            : undefined,
        handoffFace,
      },
    });
  }
  const rackRect = {
    x: 0,
    y: scene.rackOffsetY,
    width,
    height: scene.height - scene.rackOffsetY,
  };
  return {
    scene,
    routes: planPendingRoutes(
      pendingRoutes,
      {
        width,
        height: scene.height,
        racks: [
          {
            id: input.rack.id,
            rect: rackRect,
            unitHeight: input.unitHeight ?? 42,
          },
        ],
        obstacles: scene.equipment.map((item) => ({
          id: item.device.id,
          rackId: item.rackId,
          face: item.rackFace,
          parentDeviceId: item.device.parentDeviceId,
          rect: item.rect,
        })),
      },
      input.style ?? "smooth",
    ),
  };
}

export function nextManualWaypoint(input: {
  link: PortLink;
  roomId: string;
  face: RackFace;
  x?: number;
  y?: number;
}): CableRouteWaypoint {
  const existingIds = new Set(
    (input.link.routeWaypoints ?? []).map((point) => point.id),
  );
  let index = (input.link.routeWaypoints?.length ?? 0) + 1;
  while (existingIds.has(`route-${input.link.id}-${index}`)) index += 1;
  return {
    id: `route-${input.link.id}-${index}`,
    roomId: input.roomId,
    face: input.face,
    x: bound(
      input.x ?? RACK_STUDIO_CANVAS_WIDTH / 2,
      0,
      RACK_STUDIO_CANVAS_WIDTH,
    ),
    y: bound(
      input.y ?? RACK_STUDIO_CANVAS_HEIGHT / 2,
      0,
      RACK_STUDIO_CANVAS_HEIGHT,
    ),
  };
}
