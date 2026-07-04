import { deviceTypeBase } from "./device-types";
import type {
  Device,
  DeviceType,
  DeviceTypeDefinition,
  Port,
  PortLink,
} from "./types";

export type CablingMapMode = "direct" | "active" | "full";

export interface CablingMapLine {
  portId: string;
  portName: string;
  text: string;
  status:
    | "linked"
    | "spare"
    | "aggregate-member"
    | "passive-endpoint"
    | "loop"
    | "unknown";
}

export interface CablingMapInput {
  deviceId: string;
  devices: Device[];
  ports: Port[];
  portLinks: PortLink[];
  deviceTypes?: DeviceTypeDefinition[];
  effectiveDeviceTypeByDeviceId?: Record<string, DeviceType>;
}

type PathSegmentKind = "cable" | "passive";

interface PathSegment {
  id: string;
  kind: PathSegmentKind;
  fromPort: Port;
  toPort: Port;
  link?: PortLink;
}

interface WalkResult {
  segments: PathSegment[];
  status: CablingMapLine["status"];
  endpoint?: Port;
}

export function buildCablingMapLines(
  input: CablingMapInput,
  mode: CablingMapMode,
): CablingMapLine[] {
  const device = input.devices.find((entry) => entry.id === input.deviceId);
  if (!device) return [];

  const portById = new Map(input.ports.map((port) => [port.id, port]));
  const deviceById = new Map(input.devices.map((entry) => [entry.id, entry]));
  const linkByPortId = new Map<string, PortLink>();
  for (const link of input.portLinks) {
    linkByPortId.set(link.fromPortId, link);
    linkByPortId.set(link.toPortId, link);
  }

  const context = {
    ...input,
    device,
    portById,
    deviceById,
    linkByPortId,
    adjacency: buildAdjacency(input, portById, deviceById),
  };

  return input.ports
    .filter((port) => port.deviceId === input.deviceId)
    .sort(comparePorts)
    .map((port) => buildLineForPort(context, port, mode));
}

export function buildCablingMapText(lines: CablingMapLine[]) {
  return lines.map((line) => line.text).join("\n");
}

function buildLineForPort(
  context: CablingMapInput & {
    device: Device;
    portById: Map<string, Port>;
    deviceById: Map<string, Device>;
    linkByPortId: Map<string, PortLink>;
    adjacency: Map<string, PathSegment[]>;
  },
  port: Port,
  mode: CablingMapMode,
): CablingMapLine {
  const start = formatEndpoint(context.device, port);
  if (port.aggregatePortId) {
    const aggregate = context.portById.get(port.aggregatePortId);
    return {
      portId: port.id,
      portName: port.name,
      status: "aggregate-member",
      text: `${start} -> cable aggregate ${aggregate?.name ?? port.aggregatePortId}`,
    };
  }

  if (mode === "direct") {
    const link = context.linkByPortId.get(port.id);
    const peer = link ? peerPort(link, port.id, context.portById) : undefined;
    if (!peer) {
      return {
        portId: port.id,
        portName: port.name,
        status: "spare",
        text: `${start} -> spare`,
      };
    }
    return {
      portId: port.id,
      portName: port.name,
      status: "linked",
      text: `${start} -> ${formatEndpoint(context.deviceById.get(peer.deviceId), peer)}`,
    };
  }

  const result = walkCablePath(context, port);
  if (result.segments.length === 0 || !result.endpoint) {
    return {
      portId: port.id,
      portName: port.name,
      status: "spare",
      text: `${start} -> spare`,
    };
  }

  if (mode === "active") {
    const suffix = result.status === "loop" ? " (loop detected)" : "";
    const passiveSuffix =
      result.status === "passive-endpoint" ? " (passive endpoint)" : "";
    return {
      portId: port.id,
      portName: port.name,
      status: result.status,
      text: `${start} -> ${formatEndpoint(
        context.deviceById.get(result.endpoint.deviceId),
        result.endpoint,
      )}${suffix}${passiveSuffix}`,
    };
  }

  return {
    portId: port.id,
    portName: port.name,
    status: result.status,
    text: formatFullPath(context, port, result),
  };
}

function walkCablePath(
  context: CablingMapInput & {
    device: Device;
    deviceById: Map<string, Device>;
    adjacency: Map<string, PathSegment[]>;
  },
  startPort: Port,
): WalkResult {
  const segments: PathSegment[] = [];
  const visitedPorts = new Set<string>([startPort.id]);
  const visitedSegments = new Set<string>();
  let current = startPort;
  let previousPortId: string | null = null;

  for (let guard = 0; guard < 128; guard += 1) {
    const candidates = (context.adjacency.get(current.id) ?? [])
      .filter((segment) => segment.toPort.id !== previousPortId)
      .filter((segment) => !visitedSegments.has(segment.id));
    const next =
      candidates.find((segment) => segment.kind === "passive") ?? candidates[0];

    if (!next) {
      return {
        segments,
        endpoint: segments.length > 0 ? current : undefined,
        status:
          segments.length > 0 && isPassiveDevice(context, current.deviceId)
            ? "passive-endpoint"
            : segments.length > 0
              ? "linked"
              : "spare",
      };
    }

    segments.push(next);
    visitedSegments.add(next.id);
    previousPortId = current.id;
    current = next.toPort;

    if (visitedPorts.has(current.id)) {
      return { segments, endpoint: current, status: "loop" };
    }
    visitedPorts.add(current.id);

    if (
      current.deviceId !== startPort.deviceId &&
      !isPassiveDevice(context, current.deviceId)
    ) {
      return { segments, endpoint: current, status: "linked" };
    }
  }

  return { segments, endpoint: current, status: "loop" };
}

function buildAdjacency(
  input: CablingMapInput,
  portById: Map<string, Port>,
  deviceById: Map<string, Device>,
) {
  const adjacency = new Map<string, PathSegment[]>();
  const add = (segment: PathSegment) => {
    adjacency.set(segment.fromPort.id, [
      ...(adjacency.get(segment.fromPort.id) ?? []),
      segment,
    ]);
  };

  for (const link of input.portLinks) {
    const fromPort = portById.get(link.fromPortId);
    const toPort = portById.get(link.toPortId);
    if (!fromPort || !toPort) continue;
    add({
      id: `cable:${link.id}:${fromPort.id}:${toPort.id}`,
      kind: "cable",
      fromPort,
      toPort,
      link,
    });
    add({
      id: `cable:${link.id}:${toPort.id}:${fromPort.id}`,
      kind: "cable",
      fromPort: toPort,
      toPort: fromPort,
      link,
    });
  }

  for (const device of input.devices) {
    if (!isPassiveDevice({ ...input, deviceById }, device.id)) continue;
    const ports = input.ports.filter((port) => port.deviceId === device.id);
    const byPosition = new Map<number, Port[]>();
    for (const port of ports) {
      byPosition.set(port.position, [
        ...(byPosition.get(port.position) ?? []),
        port,
      ]);
    }
    for (const [position, pairPorts] of byPosition) {
      const front = pairPorts.find((port) => port.face === "front");
      const rear = pairPorts.find((port) => port.face === "rear");
      if (!front || !rear) continue;
      add({
        id: `passive:${device.id}:${position}:front`,
        kind: "passive",
        fromPort: front,
        toPort: rear,
      });
      add({
        id: `passive:${device.id}:${position}:rear`,
        kind: "passive",
        fromPort: rear,
        toPort: front,
      });
    }
  }

  return adjacency;
}

function isPassiveDevice(
  input: Pick<
    CablingMapInput,
    "deviceTypes" | "effectiveDeviceTypeByDeviceId"
  > & {
    deviceById: Map<string, Device>;
  },
  deviceId: string,
) {
  const device = input.deviceById.get(deviceId);
  if (!device) return false;
  const effective =
    input.effectiveDeviceTypeByDeviceId?.[deviceId] ??
    deviceTypeBase(device.deviceType, input.deviceTypes);
  return effective === "patch_panel";
}

function peerPort(link: PortLink, portId: string, portById: Map<string, Port>) {
  return portById.get(
    link.fromPortId === portId ? link.toPortId : link.fromPortId,
  );
}

function formatFullPath(
  context: { deviceById: Map<string, Device> },
  startPort: Port,
  result: WalkResult,
) {
  const startDevice = context.deviceById.get(startPort.deviceId);
  const parts = [formatEndpoint(startDevice, startPort)];
  for (const segment of result.segments) {
    parts.push(
      `--${segment.kind}--> ${formatEndpoint(
        context.deviceById.get(segment.toPort.deviceId),
        segment.toPort,
      )}`,
    );
  }
  const suffix =
    result.status === "loop"
      ? " (loop detected)"
      : result.status === "passive-endpoint"
        ? " (passive endpoint)"
        : "";
  return `${parts.join(" ")}${suffix}`;
}

function formatEndpoint(device: Device | undefined, port: Port) {
  return `${device?.hostname ?? "Unknown"} ${port.name}`;
}

function comparePorts(a: Port, b: Port) {
  return a.position - b.position || a.name.localeCompare(b.name);
}
