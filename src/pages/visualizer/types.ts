import type {
  Device,
  DeviceType,
  Port,
  PortLink,
  Rack,
  RackFace,
  Room,
  Subnet,
  Vlan,
} from "@/lib/types";

export type VisualizerHealth = "online" | "warning" | "offline" | "unknown";
export type VisualizerColumnKind = "rack" | "room";
export type VisualizerLooseDevicePlacement = "beside-racks" | "below-racks";
export type VisualizerLayoutMode = "grouped" | "pyramid" | "diagram";
export type VisualizerRackFaceMode = "front" | "rear" | "both";

export interface VisualizerLayoutOptions {
  topologyLayout: VisualizerLayoutMode;
  looseDevicePlacement: VisualizerLooseDevicePlacement;
  includeRoomOnlySections: boolean;
  rackFaceMode: VisualizerRackFaceMode;
  customNodePositions: Record<string, VisualizerPoint>;
}

export interface VisualizerPoint {
  x: number;
  y: number;
}

export interface VisualizerPort {
  port: Port;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string | null;
  linkId: string | null;
  linked: boolean;
  destinationLabel: string | null;
  vlanSummary: string;
  bridgeName: string | null;
}

export interface VisualizerNode {
  device: Device;
  x: number;
  y: number;
  width: number;
  height: number;
  health: VisualizerHealth;
  typeColor: string;
  stripeColor: string;
  zoneId: string;
  rackId?: string;
  rackName?: string;
  roomId?: string | null;
  roomName?: string | null;
  ports: VisualizerPort[];
  portSummary: {
    linked: number;
    total: number;
  };
  macAddress?: string | null;
  vendor?: string | null;
  subnet?: Subnet | null;
}

export interface RackBand {
  id: string;
  startU: number;
  endU: number;
  y: number;
  height: number;
  collapsed: boolean;
  occupied: boolean;
  label: string;
  expandKey?: string;
}

export interface RackRoomSection {
  id: string;
  name: string;
  subtitle: string;
  room?: Room;
  x: number;
  y: number;
  width: number;
  height: number;
  racks: RackPanel[];
  looseGroups: RoomGroup[];
  stats: {
    racks: number;
    devices: number;
    cables: number;
  };
}

export interface RackPanel {
  id: string;
  rack: Rack;
  room?: Room;
  x: number;
  y: number;
  width: number;
  height: number;
  bodyX: number;
  bodyY: number;
  bodyWidth: number;
  bodyHeight: number;
  bands: RackBand[];
  nodes: VisualizerNode[];
  faces: RackFace[];
  faceMode: VisualizerRackFaceMode;
  stats: {
    totalU: number;
    mounted: number;
    frontMounted: number;
    rearMounted: number;
    freeU: number;
  };
}

export interface RoomGroup {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  x: number;
  y: number;
  width: number;
  nodes: VisualizerNode[];
  total: number;
  online: number;
  down: number;
  collapsed: boolean;
  groupType: "subnet" | "device-type" | "virtual-host";
  subnet?: Subnet;
}

export interface RoomZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groups: RoomGroup[];
  stats: {
    total: number;
    online: number;
    down: number;
  };
}

export interface VisualizerCable {
  link: PortLink;
  fromPort?: Port;
  toPort?: Port;
  fromDevice?: Device;
  toDevice?: Device;
  fromNode?: VisualizerNode;
  toNode?: VisualizerNode;
  fromPoint?: VisualizerPoint;
  toPoint?: VisualizerPoint;
  path: string | null;
  color: string;
  up: boolean;
  bothOnline: boolean;
  unknown: boolean;
  crossZone: boolean;
}

export interface VisualizerNeighbor {
  device: Device;
  port: Port;
  peerPort: Port;
  link: PortLink;
  color: string;
}

export interface TraceSegment {
  kind: "cable" | "patch";
  fromPort: Port;
  toPort: Port;
  link?: PortLink;
  color: string;
  length?: string | null;
}

export interface TraceResult {
  fromPortId: string;
  toPortId: string;
  segments: TraceSegment[];
  cableIds: Set<string>;
  portIds: Set<string>;
  totalCableLengthLabel: string;
}

export interface VisualizerModel {
  layoutMode: VisualizerLayoutMode;
  width: number;
  height: number;
  rackZone: {
    x: number;
    y: number;
    width: number;
    height: number;
    sections: RackRoomSection[];
    racks: RackPanel[];
  };
  roomZone: RoomZone;
  nodes: VisualizerNode[];
  nodesByDeviceId: Record<string, VisualizerNode>;
  cables: VisualizerCable[];
  cableById: Record<string, VisualizerCable>;
  portsByDeviceId: Record<string, Port[]>;
  portById: Record<string, Port>;
  portLinkByPortId: Record<string, PortLink>;
  deviceById: Record<string, Device>;
  vlanById: Record<string, Vlan>;
  directNeighborsByDeviceId: Record<string, VisualizerNeighbor[]>;
  deviceTypes: Array<{ type: DeviceType; label: string; count: number }>;
  cableTypes: string[];
  counts: {
    devices: number;
    cables: number;
    crossZone: number;
    patchPanel: number;
  };
}

export type VisualizerSelection =
  | { kind: "device"; id: string }
  | { kind: "cable"; id: string }
  | null;

export type TraceModeState =
  | { enabled: false; firstPortId: null; result: null; message: null }
  | {
      enabled: true;
      firstPortId: string | null;
      result: TraceResult | null;
      message: string | null;
    };

export interface SearchResult {
  kind: "device" | "cable";
  id: string;
  label: string;
  meta: string;
  score: number;
}
