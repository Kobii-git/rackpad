import type {
  Device,
  DeviceMonitor,
  DeviceType,
  DiscoveredDevice,
  Port,
  PortKind,
  PortLink,
  Rack,
  Room,
  Subnet,
  Vlan,
  VirtualSwitch,
} from "@/lib/types";
import {
  cidrSize,
  formatPortLabel,
  ipToInt,
  normalizeColorToCss,
  portTypeLabel,
} from "@/lib/utils";
import {
  defaultDeviceTypeLabel,
  normalizeDeviceTypeId,
} from "@/lib/device-types";
import type {
  RackBand,
  RackPanel,
  RackRoomSection,
  RoomGroup,
  SearchResult,
  TraceResult,
  TraceSegment,
  VisualizerCable,
  VisualizerHealth,
  VisualizerModel,
  VisualizerNeighbor,
  VisualizerNode,
  VisualizerPort,
} from "./types";

const RACK_ZONE_X = 28;
const ZONE_Y = 28;
const ZONE_PADDING = 24;
const ZONE_GAP = 44;
const ZONE_HEADER = 76;
const RACK_PANEL_WIDTH = 324;
const RACK_PANEL_GAP = 22;
const RACK_LOOSE_GROUP_WIDTH = 360;
const RACK_SECTION_GAP = 28;
const RACK_SECTION_PADDING = 18;
const RACK_SECTION_HEADER = 56;
const RACK_UNIT_BASE_HEIGHT = 28;
const RACK_UNIT_MEDIUM_HEIGHT = 36;
const RACK_UNIT_DENSE_HEIGHT = 44;
const RACK_UNIT_ULTRA_DENSE_HEIGHT = 52;
const RACK_NODE_WIDTH = 218;
const NODE_HEIGHT = 40;
const ROOM_ZONE_WIDTH = 430;
const ROOM_NODE_WIDTH = 332;
const ROOM_ROW_HEIGHT = 54;
const GROUP_HEADER_HEIGHT = 48;
const GROUP_GAP = 14;
const CABLE_FALLBACK_COLOR = "rgb(151 167 183 / 0.5)";

const DEVICE_TYPE_ORDER: DeviceType[] = [
  "switch",
  "server",
  "patch_panel",
  "ap",
  "vm",
  "endpoint",
  "firewall",
  "router",
  "storage",
  "rack_shelf",
  "brush_panel",
  "blanking_panel",
  "pdu",
  "ups",
  "kvm",
  "other",
];

const DEVICE_TYPE_LABEL: Record<string, string> = {
  switch: "Switch",
  router: "Router",
  firewall: "Firewall",
  server: "Server",
  rack_shelf: "Rack shelf",
  ap: "AP",
  endpoint: "Endpoint",
  vm: "VM",
  patch_panel: "Patch panel",
  brush_panel: "Brush panel",
  blanking_panel: "Blanking panel",
  storage: "Storage",
  pdu: "PDU",
  ups: "UPS",
  kvm: "KVM",
  other: "Other",
};

interface BuildVisualizerInput {
  racks: Rack[];
  rooms: Room[];
  devices: Device[];
  ports: Port[];
  portLinks: PortLink[];
  deviceMonitors: DeviceMonitor[];
  subnets: Subnet[];
  vlans: Vlan[];
  discoveredDevices: DiscoveredDevice[];
  virtualSwitches: VirtualSwitch[];
  expandedRackRuns: Set<string>;
  collapsedGroups: Set<string>;
}

interface SubnetRange {
  subnet: Subnet;
  start: number;
  end: number;
}

export function buildVisualizerModel(input: BuildVisualizerInput): VisualizerModel {
  const racks = [...input.racks].sort((a, b) => a.name.localeCompare(b.name));
  const roomsById = indexById(input.rooms);
  const deviceById = indexById(input.devices);
  const portById = indexById(input.ports);
  const vlanById = indexById(input.vlans);
  const virtualSwitchById = indexById(input.virtualSwitches);
  const portsByDeviceId = groupBy(input.ports, (port) => port.deviceId);
  for (const devicePorts of Object.values(portsByDeviceId)) {
    devicePorts.sort(comparePorts);
  }

  const portLinkByPortId: Record<string, PortLink> = {};
  for (const link of input.portLinks) {
    portLinkByPortId[link.fromPortId] = link;
    portLinkByPortId[link.toPortId] = link;
  }

  const monitorsByDeviceId = groupBy(
    input.deviceMonitors.filter(
      (monitor) => monitor.enabled && monitor.type !== "none",
    ),
    (monitor) => monitor.deviceId,
  );
  const subnetRanges = input.subnets.map(toSubnetRange).filter(Boolean);
  const discoveredByDeviceId = new Map<string, DiscoveredDevice>();
  const discoveredByIp = new Map<string, DiscoveredDevice>();
  for (const discovered of input.discoveredDevices) {
    if (discovered.importedDeviceId) {
      discoveredByDeviceId.set(discovered.importedDeviceId, discovered);
    }
    discoveredByIp.set(discovered.ipAddress, discovered);
  }

  const rackIds = new Set(racks.map((rack) => rack.id));
  const racksById = indexById(racks);
  const looseDevices = input.devices.filter(
    (device) => !device.rackId || !rackIds.has(device.rackId),
  );
  const roomIdsWithRacks = new Set(
    racks
      .map((rack) => rack.roomId)
      .filter((roomId): roomId is string => Boolean(roomId)),
  );
  const looseDeviceRoomById = new Map(
    looseDevices.map((device) => [
      device.id,
      roomForDevice(device, deviceById, racksById, roomsById),
    ]),
  );
  const rackSectionLooseDeviceIds = new Set(
    looseDevices
      .filter((device) => {
        const room = looseDeviceRoomById.get(device.id);
        return Boolean(room && roomIdsWithRacks.has(room.id));
      })
      .map((device) => device.id),
  );
  const nodes: VisualizerNode[] = [];
  const rackSections: RackRoomSection[] = [];
  const rackPanels: RackPanel[] = [];
  let rackSectionX = RACK_ZONE_X + ZONE_PADDING;
  const rackSectionY = ZONE_Y + ZONE_HEADER;
  for (const sectionInput of buildRackRoomInputs(racks, roomsById)) {
    const sectionLooseDevices = sectionInput.room
      ? looseDevices.filter(
          (device) =>
            rackSectionLooseDeviceIds.has(device.id) &&
            looseDeviceRoomById.get(device.id)?.id === sectionInput.room?.id,
        )
      : [];
    const rackColumnsWidth =
      sectionInput.racks.length * RACK_PANEL_WIDTH +
      Math.max(0, sectionInput.racks.length - 1) * RACK_PANEL_GAP;
    const looseGroupWidth =
      sectionLooseDevices.length > 0 ? RACK_LOOSE_GROUP_WIDTH : 0;
    const looseGroupGap =
      rackColumnsWidth > 0 && looseGroupWidth > 0 ? RACK_PANEL_GAP : 0;
    const sectionWidth = Math.max(
      RACK_PANEL_WIDTH + RACK_SECTION_PADDING * 2,
      RACK_SECTION_PADDING * 2 +
        rackColumnsWidth +
        looseGroupGap +
        looseGroupWidth,
    );
    const rackPanelY = rackSectionY + RACK_SECTION_HEADER;
    const sectionPanels = sectionInput.racks.map((rack, rackIndex) => {
      const rackDevices = input.devices
        .filter((device) => device.rackId === rack.id)
        .sort(compareRackDevices);
      const rackX =
        rackSectionX +
        RACK_SECTION_PADDING +
        rackIndex * (RACK_PANEL_WIDTH + RACK_PANEL_GAP);
      const panel = buildRackPanel({
        rack,
        room: rack.roomId ? roomsById[rack.roomId] : undefined,
        devices: rackDevices,
        x: rackX,
        y: rackPanelY,
        portsByDeviceId,
        portLinkByPortId,
        virtualSwitchById,
        discoveredByDeviceId,
        discoveredByIp,
        subnetRanges,
        vlansById: vlanById,
        monitorsByDeviceId,
      });
      nodes.push(...panel.nodes);
      return panel;
    });
    rackPanels.push(...sectionPanels);
    const looseGroupX =
      rackSectionX +
      RACK_SECTION_PADDING +
      rackColumnsWidth +
      looseGroupGap;
    const sectionLooseGroups =
      sectionLooseDevices.length > 0
        ? buildRoomGroups({
            devices: sectionLooseDevices,
            deviceById,
            racksById,
            roomsById,
            portsByDeviceId,
            portLinkByPortId,
            virtualSwitchById,
            discoveredByDeviceId,
            discoveredByIp,
            subnetRanges,
            subnets: input.subnets,
            vlansById: vlanById,
            monitorsByDeviceId,
            collapsedGroups: input.collapsedGroups,
            x: looseGroupX,
            y: rackPanelY,
            width: RACK_LOOSE_GROUP_WIDTH,
          })
        : [];
    for (const group of sectionLooseGroups) {
      nodes.push(...group.nodes);
    }
    const sectionDeviceIds = new Set(
      [
        ...sectionPanels.flatMap((panel) =>
          panel.nodes.map((node) => node.device.id),
        ),
        ...sectionLooseDevices.map((device) => device.id),
      ],
    );
    const looseGroupHeight = roomGroupsHeight(sectionLooseGroups, rackPanelY);
    const sectionHeight =
      RACK_SECTION_HEADER +
      ZONE_PADDING +
      Math.max(
        maxOf(sectionPanels, (panel) => panel.height, 300),
        looseGroupHeight,
      );
    rackSections.push({
      id: sectionInput.id,
      name: sectionInput.name,
      subtitle: sectionInput.subtitle,
      room: sectionInput.room,
      x: rackSectionX,
      y: rackSectionY,
      width: sectionWidth,
      height: sectionHeight,
      racks: sectionPanels,
      looseGroups: sectionLooseGroups,
      stats: {
        racks: sectionPanels.length,
        devices: sectionDeviceIds.size,
        cables: countLinksTouchingDevices(input.portLinks, portById, sectionDeviceIds),
      },
    });
    rackSectionX += sectionWidth + RACK_SECTION_GAP;
  }

  const rackZoneWidth = Math.max(
    360,
    ZONE_PADDING * 2 +
      rackSections.reduce((sum, section) => sum + section.width, 0) +
      Math.max(0, rackSections.length - 1) * RACK_SECTION_GAP,
  );

  const rackZoneHeight = Math.max(
    460,
    ZONE_HEADER + ZONE_PADDING + maxOf(rackSections, (section) => section.height, 300),
  );

  const roomZoneX = RACK_ZONE_X + rackZoneWidth + ZONE_GAP;
  const roomZoneLooseDevices = looseDevices.filter(
    (device) => !rackSectionLooseDeviceIds.has(device.id),
  );
  const roomGroups = buildRoomGroups({
    devices: roomZoneLooseDevices,
    deviceById,
    racksById,
    roomsById,
    portsByDeviceId,
    portLinkByPortId,
    virtualSwitchById,
    discoveredByDeviceId,
    discoveredByIp,
    subnetRanges,
    subnets: input.subnets,
    vlansById: vlanById,
    monitorsByDeviceId,
    collapsedGroups: input.collapsedGroups,
    x: roomZoneX + ZONE_PADDING,
    y: ZONE_Y + ZONE_HEADER,
    width: ROOM_ZONE_WIDTH - ZONE_PADDING * 2,
  });
  for (const group of roomGroups) {
    nodes.push(...group.nodes);
  }
  const roomZoneHeight = Math.max(
    460,
    ZONE_HEADER +
      ZONE_PADDING +
      GROUP_GAP +
      roomGroups.reduce(
        (sum, group) =>
          sum + GROUP_HEADER_HEIGHT + (group.collapsed ? 0 : group.nodes.length * ROOM_ROW_HEIGHT) + GROUP_GAP,
        0,
      ),
  );

  const nodesByDeviceId = Object.fromEntries(
    nodes.map((node) => [node.device.id, node]),
  );

  const cables = input.portLinks
    .map((link, index) =>
      buildCable({
        link,
        index,
        portById,
        deviceById,
        nodesByDeviceId,
      }),
    )
    .filter((entry): entry is VisualizerCable => Boolean(entry));
  const cableById = Object.fromEntries(
    cables.map((cable) => [cable.link.id, cable]),
  );
  const directNeighborsByDeviceId = buildNeighbors(cables);
  const width = roomZoneX + ROOM_ZONE_WIDTH + ZONE_PADDING + 32;
  const height = Math.max(rackZoneHeight, roomZoneHeight) + ZONE_Y + 12;

  return {
    width,
    height,
    rackZone: {
      x: RACK_ZONE_X,
      y: ZONE_Y,
      width: rackZoneWidth,
      height,
      sections: rackSections,
      racks: rackPanels,
    },
    roomZone: {
      id: "room-zone",
      x: roomZoneX,
      y: ZONE_Y,
      width: ROOM_ZONE_WIDTH,
      height,
      groups: roomGroups,
      stats: {
        total: roomZoneLooseDevices.length,
        online: roomGroups.reduce((sum, group) => sum + group.online, 0),
        down: roomGroups.reduce((sum, group) => sum + group.down, 0),
      },
    },
    nodes,
    nodesByDeviceId,
    cables,
    cableById,
    portsByDeviceId,
    portById,
    portLinkByPortId,
    deviceById,
    vlanById,
    directNeighborsByDeviceId,
    deviceTypes: buildDeviceTypeCounts(input.devices),
    cableTypes: Array.from(
      new Set(input.portLinks.map((link) => link.cableType || "Unknown")),
    ).sort((a, b) => a.localeCompare(b)),
    counts: {
      devices: input.devices.length,
      cables: input.portLinks.length,
      crossZone: cables.filter((cable) => cable.crossZone).length,
      patchPanel: cables.filter(
        (cable) =>
          cable.fromDevice?.deviceType === "patch_panel" ||
          cable.toDevice?.deviceType === "patch_panel",
      ).length,
    },
  };
}

function buildRackPanel(input: {
  rack: Rack;
  room?: Room;
  devices: Device[];
  x: number;
  y: number;
  portsByDeviceId: Record<string, Port[]>;
  portLinkByPortId: Record<string, PortLink>;
  virtualSwitchById: Record<string, VirtualSwitch>;
  discoveredByDeviceId: Map<string, DiscoveredDevice>;
  discoveredByIp: Map<string, DiscoveredDevice>;
  subnetRanges: Array<SubnetRange | null>;
  vlansById: Record<string, Vlan>;
  monitorsByDeviceId: Record<string, DeviceMonitor[]>;
}): RackPanel {
  const bodyX = input.x + 46;
  const bodyY = input.y + 78;
  const bodyWidth = RACK_PANEL_WIDTH - 58;
  const rackUnitHeight = rackUnitHeightForDevices(
    input.devices,
    input.portsByDeviceId,
  );
  const occupiedUnits = new Set<number>();
  for (const device of input.devices) {
    const start = device.startU ?? 1;
    const height = device.heightU ?? 1;
    for (let u = start; u < start + height; u += 1) {
      occupiedUnits.add(u);
    }
  }
  const bands = buildRackBands(input.rack, occupiedUnits, rackUnitHeight);
  const bodyHeight = bands.reduce((sum, band) => sum + band.height, 0);
  const yByUnit = new Map<number, { y: number; height: number }>();
  for (const band of bands) {
    for (let u = band.startU; u <= band.endU; u += 1) {
      yByUnit.set(u, { y: bodyY + band.y, height: band.height });
    }
  }
  const nodes = input.devices.map((device) => {
    const start = device.startU ?? 1;
    const heightU = device.heightU ?? 1;
    const topU = Math.min(input.rack.totalU, start + heightU - 1);
    const topBand = yByUnit.get(topU);
    const bottomBand = yByUnit.get(start);
    const top = topBand?.y ?? bodyY + 8;
    const bottom = bottomBand
      ? bottomBand.y + bottomBand.height
      : top + NODE_HEIGHT;
    return createNode({
      device,
      x: bodyX + 32,
      y: top + 2,
      width: RACK_NODE_WIDTH,
      height: Math.max(Math.max(24, rackUnitHeight - 4), bottom - top - 4),
      zoneId: input.room ? `room:${input.room.id}:rack:${input.rack.id}` : `rack:${input.rack.id}`,
      rackId: input.rack.id,
      rackName: input.rack.name,
      roomId: input.room?.id ?? null,
      roomName: input.room?.name ?? "Unassigned room",
      ports: input.portsByDeviceId[device.id] ?? [],
      portLinkByPortId: input.portLinkByPortId,
      virtualSwitchById: input.virtualSwitchById,
      discoveredByDeviceId: input.discoveredByDeviceId,
      discoveredByIp: input.discoveredByIp,
      subnetRanges: input.subnetRanges,
      vlansById: input.vlansById,
      health: getDeviceHealth(device, input.monitorsByDeviceId[device.id] ?? []),
    });
  });
  const panelHeight = bodyY - input.y + bodyHeight + 48;
  return {
    id: input.rack.id,
    rack: input.rack,
    room: input.room,
    x: input.x,
    y: input.y,
    width: RACK_PANEL_WIDTH,
    height: panelHeight,
    bodyX,
    bodyY,
    bodyWidth,
    bodyHeight,
    bands,
    nodes,
    stats: {
      totalU: input.rack.totalU,
      mounted: input.devices.length,
      freeU: Math.max(0, input.rack.totalU - occupiedUnits.size),
    },
  };
}

function buildRackBands(
  rack: Rack,
  occupiedUnits: Set<number>,
  unitHeight: number,
): RackBand[] {
  const bands: RackBand[] = [];
  let y = 0;
  let u = rack.totalU;
  while (u >= 1) {
    bands.push({
      id: `${rack.id}:${u}`,
      startU: u,
      endU: u,
      y,
      height: unitHeight,
      collapsed: false,
      occupied: occupiedUnits.has(u),
      label: `${u}`,
    });
    y += unitHeight;
    u -= 1;
  }
  return bands;
}

function rackUnitHeightForDevices(
  devices: Device[],
  portsByDeviceId: Record<string, Port[]>,
) {
  const maxOneUPorts = devices.reduce((max, device) => {
    const heightU = device.heightU ?? 1;
    if (heightU > 1) return max;
    return Math.max(max, portsByDeviceId[device.id]?.length ?? 0);
  }, 0);
  if (maxOneUPorts >= 36) return RACK_UNIT_ULTRA_DENSE_HEIGHT;
  if (maxOneUPorts >= 18) return RACK_UNIT_DENSE_HEIGHT;
  if (maxOneUPorts >= 8) return RACK_UNIT_MEDIUM_HEIGHT;
  return RACK_UNIT_BASE_HEIGHT;
}

function buildRackRoomInputs(racks: Rack[], roomsById: Record<string, Room>) {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      subtitle: string;
      room?: Room;
      racks: Rack[];
    }
  >();
  for (const rack of racks) {
    const room = rack.roomId ? roomsById[rack.roomId] : undefined;
    const key = room ? `room:${room.id}` : "room:unassigned";
    const existing = groups.get(key);
    if (existing) {
      existing.racks.push(rack);
      continue;
    }
    groups.set(key, {
      id: key,
      name: room?.name ?? "Unassigned room",
      subtitle: room?.location ?? room?.description ?? "Racks without a room assignment",
      room,
      racks: [rack],
    });
  }
  return Array.from(groups.values()).sort(
    (a, b) => a.name.localeCompare(b.name) || b.racks.length - a.racks.length,
  );
}

function buildRoomGroups(input: {
  devices: Device[];
  deviceById: Record<string, Device>;
  racksById: Record<string, Rack>;
  roomsById: Record<string, Room>;
  portsByDeviceId: Record<string, Port[]>;
  portLinkByPortId: Record<string, PortLink>;
  virtualSwitchById: Record<string, VirtualSwitch>;
  discoveredByDeviceId: Map<string, DiscoveredDevice>;
  discoveredByIp: Map<string, DiscoveredDevice>;
  subnetRanges: Array<SubnetRange | null>;
  subnets: Subnet[];
  vlansById: Record<string, Vlan>;
  monitorsByDeviceId: Record<string, DeviceMonitor[]>;
  collapsedGroups: Set<string>;
  x: number;
  y: number;
  width: number;
}): RoomGroup[] {
  const groups = new Map<
    string,
    {
      name: string;
      subtitle: string;
      color: string;
      groupType: "subnet" | "device-type" | "virtual-host";
      subnet?: Subnet;
      devices: Device[];
      room?: Room;
    }
  >();
  const hasSubnets = input.subnets.length > 0;
  for (const device of input.devices) {
    const room = roomForDevice(device, input.deviceById, input.racksById, input.roomsById);
    const roomKey = room ? `room:${room.id}` : "room:unassigned";
    const roomPrefix = room ? room.name : "Unassigned";
    if (isVirtualInventoryDevice(device)) {
      const parent = device.parentDeviceId
        ? input.deviceById[device.parentDeviceId]
        : undefined;
      const key = parent
        ? `${roomKey}:virtual-host:${parent.id}`
        : `${roomKey}:virtual-host:unassigned`;
      const existing = groups.get(key);
      if (existing) {
        existing.devices.push(device);
      } else {
        groups.set(key, {
          name: parent ? `${roomPrefix} / VMs on ${parent.hostname}` : `${roomPrefix} / Unassigned VMs`,
          subtitle: parent
            ? `Hosted virtual inventory${parent.managementIp ? ` | ${parent.managementIp}` : ""}`
            : "Virtual devices missing a host link",
          color: typeColor("vm"),
          groupType: "virtual-host",
          devices: [device],
          room,
        });
      }
      continue;
    }

    const subnet = hasSubnets
      ? findSubnet(device.managementIp, input.subnetRanges)
      : null;
    const key = subnet
      ? `${roomKey}:subnet:${subnet.id}`
      : `${roomKey}:type:${device.deviceType}`;
    const existing = groups.get(key);
    if (existing) {
      existing.devices.push(device);
    } else if (subnet) {
      const vlan = subnet.vlanId ? input.vlansById[subnet.vlanId] : undefined;
      groups.set(key, {
        name: `${roomPrefix} / ${subnet.name}`,
        subtitle: subnet.cidr,
        color: normalizeColorToCss(vlan?.color) ?? typeColor("other"),
        groupType: "subnet",
        subnet,
        devices: [device],
        room,
      });
    } else {
      groups.set(key, {
        name: `${roomPrefix} / ${DEVICE_TYPE_LABEL[device.deviceType]}`,
        subtitle: room ? room.location ?? "Room inventory" : "Loose / unassigned inventory",
        color: typeColor(device.deviceType),
        groupType: "device-type",
        devices: [device],
        room,
      });
    }
  }

  let y = input.y;
  return Array.from(groups.entries())
    .sort(([, a], [, b]) => b.devices.length - a.devices.length || a.name.localeCompare(b.name))
    .map(([id, group]) => {
      const collapsed = input.collapsedGroups.has(id);
      const sortedDevices = [...group.devices].sort((a, b) => {
        const aHealth = getDeviceHealth(a, input.monitorsByDeviceId[a.id] ?? []);
        const bHealth = getDeviceHealth(b, input.monitorsByDeviceId[b.id] ?? []);
        return healthSort(aHealth) - healthSort(bHealth) || a.hostname.localeCompare(b.hostname);
      });
      const groupTop = y;
      y += GROUP_HEADER_HEIGHT;
      const nodes = collapsed
        ? []
        : sortedDevices.map((device, index) =>
            createNode({
              device,
              x: input.x + 22,
              y: groupTop + GROUP_HEADER_HEIGHT + index * ROOM_ROW_HEIGHT,
              width: ROOM_NODE_WIDTH,
              height: NODE_HEIGHT,
              zoneId: group.room ? `room:${group.room.id}:loose` : "room:unassigned:loose",
              roomId: group.room?.id ?? null,
              roomName: group.room?.name ?? "Unassigned room",
              ports: input.portsByDeviceId[device.id] ?? [],
              portLinkByPortId: input.portLinkByPortId,
              virtualSwitchById: input.virtualSwitchById,
              discoveredByDeviceId: input.discoveredByDeviceId,
              discoveredByIp: input.discoveredByIp,
              subnetRanges: input.subnetRanges,
              vlansById: input.vlansById,
              health: getDeviceHealth(device, input.monitorsByDeviceId[device.id] ?? []),
            }),
          );
      if (!collapsed) y += nodes.length * ROOM_ROW_HEIGHT;
      y += GROUP_GAP;
      return {
        id,
        name: group.name,
        subtitle: group.subtitle,
        color: group.color,
        x: input.x,
        y: groupTop,
        width: input.width,
        nodes,
        total: group.devices.length,
        online: group.devices.filter(
          (device) =>
            getDeviceHealth(device, input.monitorsByDeviceId[device.id] ?? []) === "online",
        ).length,
        down: group.devices.filter(
          (device) =>
            getDeviceHealth(device, input.monitorsByDeviceId[device.id] ?? []) === "offline",
        ).length,
        collapsed,
        groupType: group.groupType,
        subnet: group.subnet,
      };
    });
}

function isVirtualInventoryDevice(device: Device) {
  return device.placement === "virtual" || device.deviceType === "vm";
}

function roomForDevice(
  device: Device,
  deviceById: Record<string, Device>,
  racksById: Record<string, Rack>,
  roomsById: Record<string, Room>,
) {
  if (device.roomId && roomsById[device.roomId]) return roomsById[device.roomId];
  if (device.rackId) {
    const rack = racksById[device.rackId];
    if (rack?.roomId && roomsById[rack.roomId]) return roomsById[rack.roomId];
  }
  const parent = device.parentDeviceId ? deviceById[device.parentDeviceId] : undefined;
  if (parent) return roomForDevice(parent, deviceById, racksById, roomsById);
  return undefined;
}

function createNode(input: {
  device: Device;
  x: number;
  y: number;
  width: number;
  height: number;
  zoneId: string;
  rackId?: string;
  rackName?: string;
  roomId?: string | null;
  roomName?: string | null;
  ports: Port[];
  portLinkByPortId: Record<string, PortLink>;
  virtualSwitchById: Record<string, VirtualSwitch>;
  discoveredByDeviceId: Map<string, DiscoveredDevice>;
  discoveredByIp: Map<string, DiscoveredDevice>;
  subnetRanges: Array<SubnetRange | null>;
  vlansById: Record<string, Vlan>;
  health: VisualizerHealth;
}): VisualizerNode {
  const discovered =
    input.discoveredByDeviceId.get(input.device.id) ??
    (input.device.managementIp
      ? input.discoveredByIp.get(input.device.managementIp)
      : undefined);
  const subnet = findSubnet(input.device.managementIp, input.subnetRanges);
  const linked = input.ports.filter((port) => input.portLinkByPortId[port.id]);
  const baseNode: VisualizerNode = {
    device: input.device,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    health: input.health,
    typeColor: typeColor(input.device.deviceType),
    stripeColor: typeColor(input.device.deviceType),
    zoneId: input.zoneId,
    rackId: input.rackId,
    rackName: input.rackName,
    roomId: input.roomId,
    roomName: input.roomName,
    ports: [],
    portSummary: {
      linked: linked.length,
      total: input.ports.length,
    },
    macAddress: discovered?.macAddress,
    vendor: discovered?.vendor,
    subnet,
  };
  baseNode.ports = layoutPortStrip({
    node: baseNode,
    ports: input.ports,
    portLinkByPortId: input.portLinkByPortId,
    virtualSwitchById: input.virtualSwitchById,
    vlansById: input.vlansById,
  });
  return baseNode;
}

function layoutPortStrip(input: {
  node: VisualizerNode;
  ports: Port[];
  portLinkByPortId: Record<string, PortLink>;
  virtualSwitchById: Record<string, VirtualSwitch>;
  vlansById: Record<string, Vlan>;
}): VisualizerPort[] {
  if (input.ports.length === 0) return [];
  const count = input.ports.length;
  const columns = count > 40 ? 8 : count > 24 ? 6 : count > 12 ? 4 : 3;
  const gap = 1;
  const cell = count > 24 ? 3 : 4;
  const stripWidth = columns * cell + (columns - 1) * gap;
  const rows = Math.ceil(count / columns);
  const stripHeight = rows * cell + (rows - 1) * gap;
  const startX = input.node.x + input.node.width - stripWidth - 8;
  const startY = input.node.y + Math.max(5, (input.node.height - stripHeight) / 2);
  return input.ports.map((port, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const link = input.portLinkByPortId[port.id];
    const cableColor = normalizeColorToCss(link?.color);
    const isSlot = isSlotPort(port.kind);
    return {
      port,
      x: startX + col * (cell + gap),
      y: startY + row * (cell + gap) - (isSlot ? 0.5 : 0),
      width: isSlot ? Math.max(2, cell - 1) : cell,
      height: isSlot ? cell + 1 : cell,
      color: cableColor,
      linkId: link?.id ?? null,
      linked: Boolean(link),
      destinationLabel: null,
      vlanSummary: portVlanSummary(port, input.vlansById),
      bridgeName: port.virtualSwitchId
        ? input.virtualSwitchById[port.virtualSwitchId]?.name ?? null
        : null,
    };
  });
}

function buildCable(input: {
  link: PortLink;
  index: number;
  portById: Record<string, Port>;
  deviceById: Record<string, Device>;
  nodesByDeviceId: Record<string, VisualizerNode>;
}): VisualizerCable | null {
  const fromPort = input.portById[input.link.fromPortId];
  const toPort = input.portById[input.link.toPortId];
  const fromDevice = fromPort ? input.deviceById[fromPort.deviceId] : undefined;
  const toDevice = toPort ? input.deviceById[toPort.deviceId] : undefined;
  const fromNode = fromDevice ? input.nodesByDeviceId[fromDevice.id] : undefined;
  const toNode = toDevice ? input.nodesByDeviceId[toDevice.id] : undefined;
  if (!fromPort || !toPort || !fromDevice || !toDevice || !fromNode || !toNode) {
    return null;
  }
  const fromPoint = portPoint(fromNode, fromPort.id, toNode);
  const toPoint = portPoint(toNode, toPort.id, fromNode);
  const up = fromPort.linkState === "up" && toPort.linkState === "up";
  const unknown =
    !up ||
    fromPort.linkState === "unknown" ||
    toPort.linkState === "unknown" ||
    fromPort.linkState === "down" ||
    toPort.linkState === "down" ||
    fromPort.linkState === "disabled" ||
    toPort.linkState === "disabled";
  return {
    link: input.link,
    fromPort,
    toPort,
    fromDevice,
    toDevice,
    fromNode,
    toNode,
    fromPoint,
    toPoint,
    path: cablePath(fromPoint, toPoint, input.index),
    color: normalizeColorToCss(input.link.color) ?? CABLE_FALLBACK_COLOR,
    up,
    bothOnline: fromNode.health === "online" && toNode.health === "online",
    unknown,
    crossZone: fromNode.zoneId !== toNode.zoneId,
  };
}

function buildNeighbors(cables: VisualizerCable[]) {
  const neighbors: Record<string, VisualizerNeighbor[]> = {};
  for (const cable of cables) {
    if (
      !cable.fromDevice ||
      !cable.toDevice ||
      !cable.fromPort ||
      !cable.toPort
    ) {
      continue;
    }
    (neighbors[cable.fromDevice.id] ??= []).push({
      device: cable.toDevice,
      port: cable.fromPort,
      peerPort: cable.toPort,
      link: cable.link,
      color: cable.color,
    });
    (neighbors[cable.toDevice.id] ??= []).push({
      device: cable.fromDevice,
      port: cable.toPort,
      peerPort: cable.fromPort,
      link: cable.link,
      color: cable.color,
    });
  }
  return neighbors;
}

function countLinksTouchingDevices(
  links: PortLink[],
  portById: Record<string, Port>,
  deviceIds: Set<string>,
) {
  return links.filter((link) => {
    const fromPort = portById[link.fromPortId];
    const toPort = portById[link.toPortId];
    return (
      Boolean(fromPort && deviceIds.has(fromPort.deviceId)) ||
      Boolean(toPort && deviceIds.has(toPort.deviceId))
    );
  }).length;
}

export function tracePorts(
  model: VisualizerModel,
  fromPortId: string,
  toPortId: string,
): TraceResult | null {
  if (fromPortId === toPortId) return null;
  const adjacency: Record<string, TraceSegment[]> = {};

  function addSegment(segment: TraceSegment) {
    (adjacency[segment.fromPort.id] ??= []).push(segment);
  }

  for (const cable of model.cables) {
    if (!cable.fromPort || !cable.toPort) continue;
    addSegment({
      kind: "cable",
      fromPort: cable.fromPort,
      toPort: cable.toPort,
      link: cable.link,
      color: cable.color,
      length: cable.link.cableLength,
    });
    addSegment({
      kind: "cable",
      fromPort: cable.toPort,
      toPort: cable.fromPort,
      link: cable.link,
      color: cable.color,
      length: cable.link.cableLength,
    });
  }

  for (const device of Object.values(model.deviceById)) {
    if (device.deviceType !== "patch_panel") continue;
    const grouped = groupBy(model.portsByDeviceId[device.id] ?? [], (port) =>
      `${port.kind}:${port.name}`,
    );
    for (const pair of Object.values(grouped)) {
      const front = pair.find((port) => port.face === "front");
      const rear = pair.find((port) => port.face === "rear");
      if (!front || !rear) continue;
      addSegment({
        kind: "patch",
        fromPort: front,
        toPort: rear,
        color: "var(--accent-primary)",
      });
      addSegment({
        kind: "patch",
        fromPort: rear,
        toPort: front,
        color: "var(--accent-primary)",
      });
    }
  }

  const queue = [fromPortId];
  const visited = new Set([fromPortId]);
  const previous = new Map<string, TraceSegment>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const segment of adjacency[current] ?? []) {
      const next = segment.toPort.id;
      if (visited.has(next)) continue;
      visited.add(next);
      previous.set(next, segment);
      if (next === toPortId) {
        const segments: TraceSegment[] = [];
        let cursor = toPortId;
        while (cursor !== fromPortId) {
          const step = previous.get(cursor);
          if (!step) break;
          segments.unshift(step);
          cursor = step.fromPort.id;
        }
        const cableIds = new Set(
          segments
            .map((segment) => segment.link?.id)
            .filter((id): id is string => Boolean(id)),
        );
        const portIds = new Set<string>();
        for (const segment of segments) {
          portIds.add(segment.fromPort.id);
          portIds.add(segment.toPort.id);
        }
        return {
          fromPortId,
          toPortId,
          segments,
          cableIds,
          portIds,
          totalCableLengthLabel: summarizeCableLengths(segments),
        };
      }
      queue.push(next);
    }
  }
  return null;
}

export function buildSearchResults(
  model: VisualizerModel,
  query: string,
): SearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const results: SearchResult[] = [];
  for (const node of model.nodes) {
    const haystack = [
      node.device.hostname,
      node.device.displayName,
      node.device.managementIp,
      node.device.deviceType,
      node.macAddress,
      node.vendor,
      node.subnet?.name,
      node.subnet?.cidr,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const score = fuzzyScore(haystack, normalized);
    if (score > 0) {
      results.push({
        kind: "device",
        id: node.device.id,
        label: node.device.hostname,
        meta: node.device.managementIp ?? DEVICE_TYPE_LABEL[node.device.deviceType],
        score,
      });
    }
  }
  for (const cable of model.cables) {
    const haystack = [
      cable.link.color,
      cable.link.notes,
      cable.link.cableType,
      cable.fromDevice?.hostname,
      cable.toDevice?.hostname,
      cable.fromPort?.name,
      cable.toPort?.name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const score = fuzzyScore(haystack, normalized);
    if (score > 0) {
      results.push({
        kind: "cable",
        id: cable.link.id,
        label: `${cable.fromDevice?.hostname ?? "Unknown"} to ${
          cable.toDevice?.hostname ?? "Unknown"
        }`,
        meta: cable.link.cableType ?? cable.link.color ?? "Cable",
        score,
      });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 24);
}

function cablePath(from: { x: number; y: number }, to: { x: number; y: number }, index: number) {
  const dx = Math.abs(to.x - from.x);
  const laneOffset = ((index % 9) - 4) * 5;
  if (dx < 72) {
    const busX = Math.max(from.x, to.x) + 54 + Math.abs(laneOffset);
    return `M ${from.x} ${from.y} L ${busX} ${from.y} C ${busX + laneOffset} ${from.y}, ${
      busX + laneOffset
    } ${to.y}, ${busX} ${to.y} L ${to.x} ${to.y}`;
  }
  const curve = Math.max(64, dx * 0.36);
  const offset = laneOffset;
  return `M ${from.x} ${from.y + offset} C ${from.x + curve} ${from.y + offset}, ${
    to.x - curve
  } ${to.y - offset}, ${to.x} ${to.y - offset}`;
}

function portPoint(node: VisualizerNode, portId: string, peer: VisualizerNode) {
  const visualPort = node.ports.find((entry) => entry.port.id === portId);
  if (visualPort) {
    return {
      x: visualPort.x + visualPort.width / 2,
      y: visualPort.y + visualPort.height / 2,
    };
  }
  const towardRight = peer.x >= node.x;
  return {
    x: towardRight ? node.x + node.width : node.x,
    y: node.y + node.height / 2,
  };
}

function getDeviceHealth(
  device: Device,
  monitors: DeviceMonitor[],
): VisualizerHealth {
  if (
    device.status === "offline" ||
    monitors.some((monitor) => monitor.lastResult === "offline")
  ) {
    return "offline";
  }
  if (
    device.status === "warning" ||
    device.status === "maintenance" ||
    monitors.some((monitor) => monitor.lastResult === "warning")
  ) {
    return "warning";
  }
  if (
    device.status === "unknown" ||
    monitors.some(
      (monitor) => monitor.lastResult === "unknown" || !monitor.lastResult,
    )
  ) {
    return "unknown";
  }
  return "online";
}

function healthSort(health: VisualizerHealth) {
  return { online: 0, warning: 1, unknown: 2, offline: 3 }[health];
}

function healthColor(health: VisualizerHealth) {
  return {
    online: "var(--success)",
    warning: "var(--warning)",
    offline: "var(--danger)",
    unknown: "var(--neutral)",
  }[health];
}

export function nodeStripeColor(node: VisualizerNode, healthOverlay: boolean) {
  return healthOverlay ? healthColor(node.health) : node.typeColor;
}

export function typeColor(type: DeviceType) {
  return `var(--type-${normalizeDeviceTypeId(type).replaceAll("_", "-")}, var(--type-other))`;
}

export function typeLabel(type: DeviceType) {
  return DEVICE_TYPE_LABEL[type] ?? (defaultDeviceTypeLabel(type) || "Other");
}

export function typeOrder(type: DeviceType) {
  const index = DEVICE_TYPE_ORDER.indexOf(type);
  return index === -1 ? DEVICE_TYPE_ORDER.length : index;
}

function buildDeviceTypeCounts(devices: Device[]) {
  const counts = new Map<DeviceType, number>();
  for (const device of devices) {
    counts.set(device.deviceType, (counts.get(device.deviceType) ?? 0) + 1);
  }
  const ordered = DEVICE_TYPE_ORDER.filter((type) => counts.has(type));
  const custom = [...counts.keys()]
    .filter((type) => !DEVICE_TYPE_ORDER.includes(type))
    .sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));

  return [...ordered, ...custom].map((type) => ({
    type,
    label: typeLabel(type),
    count: counts.get(type) ?? 0,
  }));
}

function portVlanSummary(port: Port, vlansById: Record<string, Vlan>) {
  if (port.mode === "trunk") {
    const native = port.vlanId ? vlansById[port.vlanId] : null;
    const tagged = (port.allowedVlanIds ?? [])
      .map((id) => vlansById[id]?.vlanId ?? id)
      .join(", ");
    return [
      "trunk",
      native ? `native ${native.vlanId}` : "no native",
      tagged ? `${tagged} tagged` : "no tagged VLANs",
    ].join(" | ");
  }
  const access = port.vlanId ? vlansById[port.vlanId] : null;
  return access ? `access ${access.vlanId}` : "access | unassigned";
}

function toSubnetRange(subnet: Subnet): SubnetRange | null {
  try {
    const [base] = subnet.cidr.split("/");
    const start = ipToInt(base);
    return {
      subnet,
      start,
      end: start + cidrSize(subnet.cidr) - 1,
    };
  } catch {
    return null;
  }
}

function findSubnet(
  ip: string | null | undefined,
  ranges: Array<SubnetRange | null>,
) {
  if (!ip) return null;
  try {
    const value = ipToInt(ip);
    return (
      ranges.find(
        (range) => range && value >= range.start && value <= range.end,
      )?.subnet ?? null
    );
  } catch {
    return null;
  }
}

function isSlotPort(kind: PortKind) {
  return kind === "sfp" || kind === "sfp_plus" || kind === "qsfp" || kind === "fiber";
}

function comparePorts(a: Port, b: Port) {
  return a.position - b.position || a.name.localeCompare(b.name);
}

function compareRackDevices(a: Device, b: Device) {
  const aStart = a.startU ?? 0;
  const bStart = b.startU ?? 0;
  return bStart - aStart || a.hostname.localeCompare(b.hostname);
}

function indexById<T extends { id: string }>(items: T[]) {
  return items.reduce<Record<string, T>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

function groupBy<T>(
  items: T[],
  getKey: (item: T) => string,
): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    (acc[getKey(item)] ??= []).push(item);
    return acc;
  }, {});
}

function maxOf<T>(items: T[], getValue: (item: T) => number, fallback: number) {
  return items.length === 0
    ? fallback
    : Math.max(...items.map((item) => getValue(item)));
}

function roomGroupsHeight(groups: RoomGroup[], startY: number) {
  if (groups.length === 0) return 0;
  return (
    maxOf(
      groups,
      (group) =>
        group.y -
        startY +
        GROUP_HEADER_HEIGHT +
        (group.collapsed ? 0 : group.nodes.length * ROOM_ROW_HEIGHT),
      0,
    ) + GROUP_GAP
  );
}

function summarizeCableLengths(segments: TraceSegment[]) {
  const lengths = segments
    .filter((segment) => segment.kind === "cable" && segment.length)
    .map((segment) => segment.length!)
    .join(" + ");
  return lengths || "Unknown";
}

function fuzzyScore(haystack: string, needle: string) {
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return 1000 - direct;
  let cursor = 0;
  let matched = 0;
  for (const char of needle) {
    const next = haystack.indexOf(char, cursor);
    if (next === -1) return 0;
    matched += 1;
    cursor = next + 1;
  }
  return matched * 10;
}

export function portTooltip(visualPort: VisualizerPort, model: VisualizerModel) {
  const link = visualPort.linkId ? model.cableById[visualPort.linkId] : null;
  const peer =
    link?.fromPort?.id === visualPort.port.id
      ? link.toPort && link.toDevice
        ? `${link.toDevice.hostname} ${formatPortLabel(link.toPort)}`
        : null
      : link?.fromPort && link.fromDevice
        ? `${link.fromDevice.hostname} ${formatPortLabel(link.fromPort)}`
        : null;
  return [
    `${visualPort.port.name} (${portTypeLabel[visualPort.port.kind]})`,
    visualPort.port.speed ? `Speed: ${visualPort.port.speed}` : null,
    `State: ${visualPort.port.linkState}`,
    `VLAN: ${visualPort.vlanSummary}`,
    visualPort.bridgeName ? `Bridge: ${visualPort.bridgeName}` : null,
    peer ? `Patched to: ${peer}` : "No documented cable",
  ]
    .filter(Boolean)
    .join("\n");
}
