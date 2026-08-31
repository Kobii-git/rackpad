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
} from "./rack-studio";
import {
  buildRackStudioScene,
  rackFaceForPhysicalFace,
  type RackStudioScene,
} from "./rack-studio-scene";

export type PhysicalCableCategory =
  | "network"
  | "fiber"
  | "power"
  | "console"
  | "usb"
  | "storage"
  | "other";

export interface RackStudioCableAnchor {
  portId: string;
  deviceId: string;
  roomId: string | null;
  rackId: string | null;
  face: RackFace;
  x: number;
  y: number;
}

export interface RackStudioCableRoute {
  link: PortLink;
  category: PhysicalCableCategory;
  color: string;
  points: Array<{ x: number; y: number }>;
  path: string;
  label: string;
  crossRoom: boolean;
  handoff?: "cross-room" | "hidden-face";
  handoffFace?: RackFace;
  remoteRoomId?: string;
}

const OPTICAL_KINDS = new Set<PortKind>([
  "sfp",
  "sfp_plus",
  "fiber",
]);

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

function stableLane(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % 12;
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
        x: anchor.x,
        y: anchor.y,
      }
    : null;
}

function orthogonalPath(
  from: RackStudioCableAnchor,
  to: RackStudioCableAnchor,
  linkId: string,
  canvasWidth: number,
) {
  const lane = 12 + stableLane(linkId) * 5;
  if (from.rackId === to.rackId) {
    const direction = from.face === "rear" ? -1 : 1;
    const gutterX = bound(
      (from.x + to.x) / 2 + direction * lane,
      4,
      canvasWidth - 4,
    );
    return [
      { x: from.x, y: from.y },
      { x: gutterX, y: from.y },
      { x: gutterX, y: to.y },
      { x: to.x, y: to.y },
    ];
  }
  const midpointX = bound(
    (from.x + to.x) / 2 + (stableLane(linkId) - 6) * 4,
    4,
    canvasWidth - 4,
  );
  return [
    { x: from.x, y: from.y },
    { x: midpointX, y: from.y },
    { x: midpointX, y: to.y },
    { x: to.x, y: to.y },
  ];
}

export function cablePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ");
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

  const routes: RackStudioCableRoute[] = [];
  for (const link of input.links) {
    if (link.visible === false) continue;
    const fromPort = portById.get(link.fromPortId);
    const toPort = portById.get(link.toPortId);
    const category = cableCategoryForPorts(fromPort, toPort);
    if (input.category && input.category !== "all" && category !== input.category) {
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
    let points: Array<{ x: number; y: number }>;
    let remoteRoomId: string | undefined;
    let handoff: RackStudioCableRoute["handoff"];
    let handoffFace: RackFace | undefined;

    if (fromLocal && toLocal && from && to) {
      const manual = (link.routeWaypoints ?? []).filter(
        (point) =>
          point.roomId === input.room!.id &&
          (input.face === "both" || point.face === input.face),
      );
      points =
        manual.length > 0
          ? [
              { x: from.x, y: from.y },
              ...manual.map((point) => ({ x: point.x, y: point.y })),
              { x: to.x, y: to.y },
            ]
          : orthogonalPath(from, to, link.id, scene.bounds.width);
    } else {
      const local = (fromLocal ? from : to)!;
      const remote = fromLocal ? to : from;
      const remotePort = fromLocal ? toPort : fromPort;
      const remoteBelongsToRoom = fromLocal
        ? toBelongsToRoom
        : fromBelongsToRoom;
      const exitRight = local.x < scene.bounds.width / 2;
      const laneOffset = (stableLane(link.id) - 6) * 5;
      points = [
        { x: local.x, y: local.y },
        {
          x: exitRight ? scene.bounds.width - 4 : 4,
          y: bound(
            local.y + laneOffset,
            6,
            scene.bounds.height - 6,
          ),
        },
      ];
      if (remoteBelongsToRoom) {
        handoff = "hidden-face";
        handoffFace = hiddenRackFace(remotePort);
      } else {
        handoff = "cross-room";
        remoteRoomId = remote?.roomId ?? portRoomId(remotePort) ?? undefined;
      }
    }

    routes.push({
      link,
      category,
      color,
      points,
      path: cablePath(points),
      label,
      crossRoom,
      handoff,
      handoffFace,
      remoteRoomId,
    });
  }
  return routes;
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
    x: bound(input.x ?? RACK_STUDIO_CANVAS_WIDTH / 2, 0, RACK_STUDIO_CANVAS_WIDTH),
    y: bound(input.y ?? RACK_STUDIO_CANVAS_HEIGHT / 2, 0, RACK_STUDIO_CANVAS_HEIGHT),
  };
}
