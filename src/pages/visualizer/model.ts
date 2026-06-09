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
} from "@/lib/utils";
import type { useI18n } from "@/i18n";
import { formatPortTypeLabel } from "@/components/ports/port-mode-labels";
import {
  defaultDeviceTypeLabel,
  normalizeDeviceTypeId,
} from "@/lib/device-types";
import { formatDeviceAddress } from "@/lib/network-labels";
import { buildSnmpVerifiedPortIds } from "@/lib/snmp-port-status";
import type {
  RackBand,
  RackPanel,
  RackRoomSection,
  RoomGroup,
  SearchResult,
  TraceResult,
  TraceSegment,
  VisualizerCable,
  VisualizerCableLayout,
  VisualizerHealth,
  VisualizerLayoutOptions,
  VisualizerModel,
  VisualizerNeighbor,
  VisualizerNode,
  VisualizerPort,
  VisualizerRackFaceMode,
  VisualizerRackScale,
  VisualizerShelfLayout,
} from "./types";

const RACK_ZONE_X = 28;
const ZONE_Y = 28;
const ZONE_PADDING = 24;
const ZONE_GAP = 44;
const ZONE_HEADER = 76;
const RACK_PANEL_WIDTH = 360;
const RACK_PANEL_READABLE_WIDTH = 560;
const RACK_PANEL_DUAL_FACE_WIDTH = 588;
const RACK_PANEL_DUAL_FACE_READABLE_WIDTH = 760;
const RACK_PANEL_GAP = 22;
const RACK_LOOSE_GROUP_WIDTH = 360;
const RACK_SECTION_GAP = 28;
const RACK_SECTION_PADDING = 18;
const RACK_SECTION_HEADER = 56;
const RACK_UNIT_BASE_HEIGHT = 28;
const RACK_UNIT_MEDIUM_HEIGHT = 36;
const RACK_UNIT_DENSE_HEIGHT = 44;
const RACK_UNIT_ULTRA_DENSE_HEIGHT = 52;
const RACK_NODE_WIDTH = 252;
const RACK_NODE_READABLE_WIDTH = 420;
const NODE_HEIGHT = 40;
const ROOM_ZONE_WIDTH = 430;
const ROOM_NODE_WIDTH = 360;
const ROOM_ROW_HEIGHT = 54;
const PYRAMID_ZONE_X = 28;
const PYRAMID_ZONE_Y = 28;
const PYRAMID_NODE_WIDTH = 264;
const PYRAMID_NODE_READABLE_WIDTH = 360;
const PYRAMID_NODE_HEIGHT = 50;
const PYRAMID_NODE_READABLE_HEIGHT = 64;
const PYRAMID_NODE_GAP_X = 72;
const PYRAMID_NODE_READABLE_GAP_X = 96;
const PYRAMID_LAYER_GAP_Y = 116;
const PYRAMID_LAYER_READABLE_GAP_Y = 132;
const PYRAMID_COMPONENT_GAP = 120;
const GROUP_HEADER_HEIGHT = 48;
const GROUP_GAP = 14;
const CABLE_FALLBACK_COLOR = "rgb(151 167 183 / 0.5)";
const DEFAULT_LAYOUT_OPTIONS: VisualizerLayoutOptions = {
  topologyLayout: "grouped",
  looseDevicePlacement: "beside-racks",
  includeRoomOnlySections: false,
  rackFaceMode: "front",
  rackScale: "normal",
  shelfLayout: "auto",
  readableLabels: false,
  customNodePositions: {},
};

const RACK_SINGLE_WIDTH_BY_SCALE: Record<VisualizerRackScale, number> = {
  compact: RACK_PANEL_WIDTH,
  normal: RACK_PANEL_WIDTH,
  wide: 680,
  xwide: 900,
};

const RACK_SINGLE_READABLE_WIDTH_BY_SCALE: Record<VisualizerRackScale, number> =
  {
    compact: RACK_PANEL_READABLE_WIDTH,
    normal: RACK_PANEL_READABLE_WIDTH,
    wide: 760,
    xwide: 980,
  };

const RACK_DUAL_WIDTH_BY_SCALE: Record<VisualizerRackScale, number> = {
  compact: RACK_PANEL_DUAL_FACE_WIDTH,
  normal: RACK_PANEL_DUAL_FACE_WIDTH,
  wide: 940,
  xwide: 1180,
};

const RACK_DUAL_READABLE_WIDTH_BY_SCALE: Record<VisualizerRackScale, number> = {
  compact: RACK_PANEL_DUAL_FACE_READABLE_WIDTH,
  normal: RACK_PANEL_DUAL_FACE_READABLE_WIDTH,
  wide: 1040,
  xwide: 1280,
};

const RACK_NODE_WIDTH_BY_SCALE: Record<VisualizerRackScale, number> = {
  compact: RACK_NODE_WIDTH,
  normal: RACK_NODE_WIDTH,
  wide: 360,
  xwide: 460,
};

const RACK_NODE_READABLE_WIDTH_BY_SCALE: Record<VisualizerRackScale, number> = {
  compact: RACK_NODE_READABLE_WIDTH,
  normal: RACK_NODE_READABLE_WIDTH,
  wide: 520,
  xwide: 640,
};

const NATURAL_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const DEVICE_TYPE_ORDER: DeviceType[] = [
  "switch",
  "server",
  "patch_panel",
  "ap",
  "vm",
  "container",
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
  container: "Container",
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
  layout?: Partial<VisualizerLayoutOptions>;
}

interface SubnetRange {
  subnet: Subnet;
  start: number;
  end: number;
}

export function buildVisualizerModel(
  input: BuildVisualizerInput,
): VisualizerModel {
  const layout: VisualizerLayoutOptions = {
    ...DEFAULT_LAYOUT_OPTIONS,
    ...input.layout,
  };
  if (layout.topologyLayout === "pyramid") {
    return buildPyramidVisualizerModel(input, layout);
  }
  const placeLooseBelow = layout.looseDevicePlacement === "below-racks";
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
  const looseDeviceRoomById = new Map(
    looseDevices.map((device) => [
      device.id,
      roomForDevice(device, deviceById, racksById, roomsById),
    ]),
  );
  const rackRoomInputs = buildRackRoomInputs({
    racks,
    looseDevices,
    looseDeviceRoomById,
    roomsById,
    includeRoomOnlySections: layout.includeRoomOnlySections,
  });
  const rackSectionRoomIds = new Set(
    rackRoomInputs
      .map((section) => section.room?.id)
      .filter((roomId): roomId is string => Boolean(roomId)),
  );
  const rackSectionLooseDeviceIds = new Set(
    looseDevices
      .filter((device) => {
        const room = looseDeviceRoomById.get(device.id);
        return Boolean(room && rackSectionRoomIds.has(room.id));
      })
      .map((device) => device.id),
  );
  const nodes: VisualizerNode[] = [];
  const rackSections: RackRoomSection[] = [];
  const rackPanels: RackPanel[] = [];
  let rackSectionX = RACK_ZONE_X + ZONE_PADDING;
  const rackSectionY = ZONE_Y + ZONE_HEADER;
  const rackPanelWidth = rackPanelWidthForLayout(
    layout.rackFaceMode,
    layout.rackScale,
    layout.readableLabels,
  );
  for (const sectionInput of rackRoomInputs) {
    const sectionLooseDevices = sectionInput.room
      ? looseDevices.filter(
          (device) =>
            rackSectionLooseDeviceIds.has(device.id) &&
            looseDeviceRoomById.get(device.id)?.id === sectionInput.room?.id,
        )
      : [];
    const rackColumnsWidth =
      sectionInput.racks.length * rackPanelWidth +
      Math.max(0, sectionInput.racks.length - 1) * RACK_PANEL_GAP;
    const looseGroupWidth =
      sectionLooseDevices.length > 0
        ? placeLooseBelow
          ? Math.max(RACK_LOOSE_GROUP_WIDTH, rackColumnsWidth)
          : RACK_LOOSE_GROUP_WIDTH
        : 0;
    const looseGroupGap =
      !placeLooseBelow && rackColumnsWidth > 0 && looseGroupWidth > 0
        ? RACK_PANEL_GAP
        : 0;
    const sectionContentWidth = placeLooseBelow
      ? Math.max(rackColumnsWidth, looseGroupWidth)
      : rackColumnsWidth + looseGroupGap + looseGroupWidth;
    const sectionWidth = Math.max(
      rackPanelWidth + RACK_SECTION_PADDING * 2,
      RACK_SECTION_PADDING * 2 + sectionContentWidth,
    );
    const rackPanelY = rackSectionY + RACK_SECTION_HEADER;
    const sectionPanels = sectionInput.racks.map((rack, rackIndex) => {
      const rackDevices = input.devices
        .filter((device) => device.rackId === rack.id)
        .sort(compareRackDevices);
      const rackX =
        rackSectionX +
        RACK_SECTION_PADDING +
        rackIndex * (rackPanelWidth + RACK_PANEL_GAP);
      const panel = buildRackPanel({
        rack,
        room: rack.roomId ? roomsById[rack.roomId] : undefined,
        devices: rackDevices,
        x: rackX,
        y: rackPanelY,
        width: rackPanelWidth,
        rackFaceMode: layout.rackFaceMode,
        rackScale: layout.rackScale,
        shelfLayout: layout.shelfLayout,
        readableLabels: layout.readableLabels,
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
    const rackPanelHeight = maxOf(sectionPanels, (panel) => panel.height, 0);
    const looseGroupX =
      rackSectionX +
      RACK_SECTION_PADDING +
      (placeLooseBelow ? 0 : rackColumnsWidth + looseGroupGap);
    const looseGroupY =
      placeLooseBelow && rackPanelHeight > 0
        ? rackPanelY + rackPanelHeight + GROUP_GAP
        : rackPanelY;
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
            y: looseGroupY,
            width: looseGroupWidth,
          })
        : [];
    for (const group of sectionLooseGroups) {
      nodes.push(...group.nodes);
    }
    const sectionDeviceIds = new Set([
      ...sectionPanels.flatMap((panel) =>
        panel.nodes.map((node) => node.device.id),
      ),
      ...sectionLooseDevices.map((device) => device.id),
    ]);
    const looseGroupHeight = roomGroupsHeight(sectionLooseGroups, looseGroupY);
    const sectionBodyHeight = placeLooseBelow
      ? Math.max(
          300,
          rackPanelHeight +
            (rackPanelHeight > 0 && looseGroupHeight > 0 ? GROUP_GAP : 0) +
            looseGroupHeight,
        )
      : Math.max(
          maxOf(sectionPanels, (panel) => panel.height, 300),
          looseGroupHeight,
        );
    const sectionHeight =
      RACK_SECTION_HEADER + ZONE_PADDING + sectionBodyHeight;
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
        cables: countLinksTouchingDevices(
          input.portLinks,
          portById,
          sectionDeviceIds,
        ),
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
    ZONE_HEADER +
      ZONE_PADDING +
      maxOf(rackSections, (section) => section.height, 300),
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
          sum +
          GROUP_HEADER_HEIGHT +
          (group.collapsed ? 0 : group.nodes.length * ROOM_ROW_HEIGHT) +
          GROUP_GAP,
        0,
      ),
  );

  const nodesByDeviceId = Object.fromEntries(
    nodes.map((node) => [node.device.id, node]),
  );
  const snmpVerifiedPortIds = buildSnmpVerifiedPortIds(
    input.deviceMonitors,
    input.ports,
  );

  const cables = input.portLinks
    .map((link, index) =>
      buildCable({
        link,
        index,
        portById,
        deviceById,
        nodesByDeviceId,
        snmpVerifiedPortIds,
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
    layoutMode: layout.topologyLayout,
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
    ).sort((a, b) => NATURAL_COLLATOR.compare(a, b)),
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

function buildPyramidVisualizerModel(
  input: BuildVisualizerInput,
  layout: VisualizerLayoutOptions,
): VisualizerModel {
  const nodeWidth = layout.readableLabels
    ? PYRAMID_NODE_READABLE_WIDTH
    : PYRAMID_NODE_WIDTH;
  const nodeHeight = layout.readableLabels
    ? PYRAMID_NODE_READABLE_HEIGHT
    : PYRAMID_NODE_HEIGHT;
  const nodeGapX = layout.readableLabels
    ? PYRAMID_NODE_READABLE_GAP_X
    : PYRAMID_NODE_GAP_X;
  const layerGapY = layout.readableLabels
    ? PYRAMID_LAYER_READABLE_GAP_Y
    : PYRAMID_LAYER_GAP_Y;
  const deviceById = indexById(input.devices);
  const portById = indexById(input.ports);
  const vlanById = indexById(input.vlans);
  const virtualSwitchById = indexById(input.virtualSwitches);
  const racksById = indexById(input.racks);
  const roomsById = indexById(input.rooms);
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

  const adjacency = buildDeviceAdjacency(
    input.devices,
    input.portLinks,
    portById,
  );
  const nodes: VisualizerNode[] = [];
  let cursorX = PYRAMID_ZONE_X + ZONE_PADDING + 18;
  const contentY = PYRAMID_ZONE_Y + ZONE_HEADER + 42;
  let maxBottom = contentY + nodeHeight;

  const components = buildPyramidComponents(input.devices, adjacency);
  for (const component of components) {
    const layers = buildPyramidLayers(component, adjacency, deviceById);
    const layerWidths = layers.map(
      (layer) =>
        layer.length * nodeWidth + Math.max(0, layer.length - 1) * nodeGapX,
    );
    const componentWidth = Math.max(nodeWidth, ...layerWidths);
    const zoneId =
      component.length === 1 && (adjacency[component[0]]?.size ?? 0) === 0
        ? "pyramid:unlinked"
        : `pyramid:${component[0]}`;

    layers.forEach((layer, depth) => {
      const sortedLayer = [...layer].sort((a, b) =>
        comparePyramidDevices(deviceById[a], deviceById[b], adjacency),
      );
      const layerWidth =
        sortedLayer.length * nodeWidth +
        Math.max(0, sortedLayer.length - 1) * nodeGapX;
      const layerX = cursorX + Math.max(0, (componentWidth - layerWidth) / 2);
      const y = contentY + depth * (nodeHeight + layerGapY);
      sortedLayer.forEach((deviceId, index) => {
        const device = deviceById[deviceId];
        if (!device) return;
        const room = roomForDevice(device, deviceById, racksById, roomsById);
        const rack = device.rackId ? racksById[device.rackId] : undefined;
        nodes.push(
          createNode({
            device,
            x: layerX + index * (nodeWidth + nodeGapX),
            y,
            width: nodeWidth,
            height: nodeHeight,
            zoneId,
            rackId: rack?.id,
            rackName: rack?.name,
            roomId: room?.id ?? null,
            roomName: room?.name ?? "Unassigned room",
            ports: portsByDeviceId[device.id] ?? [],
            portLinkByPortId,
            virtualSwitchById,
            discoveredByDeviceId,
            discoveredByIp,
            subnetRanges,
            vlansById: vlanById,
            health: getDeviceHealth(
              device,
              monitorsByDeviceId[device.id] ?? [],
            ),
          }),
        );
      });
      maxBottom = Math.max(maxBottom, y + nodeHeight);
    });

    cursorX += componentWidth + PYRAMID_COMPONENT_GAP;
  }

  applyCustomNodePositions(nodes, layout.customNodePositions);

  const nodesByDeviceId = Object.fromEntries(
    nodes.map((node) => [node.device.id, node]),
  );
  const snmpVerifiedPortIds = buildSnmpVerifiedPortIds(
    input.deviceMonitors,
    input.ports,
  );
  const cables = input.portLinks
    .map((link, index) =>
      buildCable({
        link,
        index,
        portById,
        deviceById,
        nodesByDeviceId,
        snmpVerifiedPortIds,
      }),
    )
    .filter((entry): entry is VisualizerCable => Boolean(entry));
  const cableById = Object.fromEntries(
    cables.map((cable) => [cable.link.id, cable]),
  );
  const directNeighborsByDeviceId = buildNeighbors(cables);
  const nodeRight = maxOf(nodes, (node) => node.x + node.width, 0);
  const nodeBottom = maxOf(nodes, (node) => node.y + node.height, 0);
  const width = Math.max(920, cursorX + ZONE_PADDING + 24, nodeRight + 80);
  const height = Math.max(560, maxBottom + ZONE_PADDING + 20, nodeBottom + 80);

  return {
    layoutMode: layout.topologyLayout,
    width,
    height,
    rackZone: {
      x: PYRAMID_ZONE_X,
      y: PYRAMID_ZONE_Y,
      width: width - PYRAMID_ZONE_X - 32,
      height,
      sections: [],
      racks: [],
    },
    roomZone: {
      id: "room-zone",
      x: width + ZONE_GAP,
      y: PYRAMID_ZONE_Y,
      width: 0,
      height,
      groups: [],
      stats: { total: 0, online: 0, down: 0 },
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
    ).sort((a, b) => NATURAL_COLLATOR.compare(a, b)),
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
  width: number;
  rackFaceMode: VisualizerRackFaceMode;
  rackScale: VisualizerRackScale;
  shelfLayout: VisualizerShelfLayout;
  portsByDeviceId: Record<string, Port[]>;
  portLinkByPortId: Record<string, PortLink>;
  virtualSwitchById: Record<string, VirtualSwitch>;
  readableLabels: boolean;
  discoveredByDeviceId: Map<string, DiscoveredDevice>;
  discoveredByIp: Map<string, DiscoveredDevice>;
  subnetRanges: Array<SubnetRange | null>;
  vlansById: Record<string, Vlan>;
  monitorsByDeviceId: Record<string, DeviceMonitor[]>;
}): RackPanel {
  const bodyX = input.x + 46;
  const bodyY = input.y + 78;
  const bodyWidth = input.width - 58;
  const rackUnitHeight = rackUnitHeightForDevices(
    input.devices,
    input.portsByDeviceId,
    input.readableLabels,
    input.shelfLayout,
    input.rackScale,
  );
  const allMountedDevices = input.devices.filter(
    (device) => device.startU != null,
  );
  const mountedFrontCount = allMountedDevices.filter(
    (device) => (device.face ?? "front") === "front",
  ).length;
  const mountedRearCount = allMountedDevices.filter(
    (device) => (device.face ?? "front") === "rear",
  ).length;
  const mountedDevices =
    input.rackFaceMode === "both"
      ? allMountedDevices
      : allMountedDevices.filter(
          (device) => (device.face ?? "front") === input.rackFaceMode,
        );
  const faces = [
    mountedFrontCount > 0 ? "front" : null,
    mountedRearCount > 0 ? "rear" : null,
  ].filter((face): face is "front" | "rear" => Boolean(face));
  const useDualFaceLayout =
    input.rackFaceMode === "both" && mountedRearCount > 0;
  const baseRackNodeWidth = input.readableLabels
    ? RACK_NODE_READABLE_WIDTH_BY_SCALE[input.rackScale]
    : RACK_NODE_WIDTH_BY_SCALE[input.rackScale];
  const mountedNodeWidth = useDualFaceLayout
    ? 0
    : Math.min(baseRackNodeWidth, Math.max(168, bodyWidth - 64));
  const nodeAreaX = useDualFaceLayout ? bodyX + 12 : bodyX + 32;
  const nodeAreaWidth = useDualFaceLayout
    ? input.rack.totalU <= 12
      ? bodyWidth - 18
      : bodyWidth - 24
    : mountedNodeWidth;
  const faceGap = 8;
  const faceNodeWidth = useDualFaceLayout
    ? Math.max(
        input.readableLabels ? 230 : 150,
        Math.floor((nodeAreaWidth - faceGap) / 2),
      )
    : mountedNodeWidth;
  const mountedDeviceIds = new Set(mountedDevices.map((device) => device.id));
  const shelfChildrenByParent = groupBy(
    input.devices.filter(
      (device) => device.parentDeviceId && !mountedDeviceIds.has(device.id),
    ),
    (device) => device.parentDeviceId ?? "",
  );
  const occupiedUnits = new Set<number>();
  for (const device of mountedDevices) {
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
  const rackNodeBounds = new Map<
    string,
    { top: number; bottom: number; height: number }
  >();
  const nodes = mountedDevices.map((device) => {
    const start = device.startU ?? 1;
    const heightU = device.heightU ?? 1;
    const topU = Math.min(input.rack.totalU, start + heightU - 1);
    const topBand = yByUnit.get(topU);
    const bottomBand = yByUnit.get(start);
    const top = topBand?.y ?? bodyY + 8;
    const bottom = bottomBand
      ? bottomBand.y + bottomBand.height
      : top + NODE_HEIGHT;
    rackNodeBounds.set(device.id, {
      top,
      bottom,
      height: Math.max(Math.max(24, rackUnitHeight - 4), bottom - top - 4),
    });
    const face = device.face ?? "front";
    const nodeX = useDualFaceLayout
      ? nodeAreaX + (face === "rear" ? faceNodeWidth + faceGap : 0)
      : bodyX + 32;
    return createNode({
      device,
      x: nodeX,
      y: top + 2,
      width: useDualFaceLayout ? faceNodeWidth : mountedNodeWidth,
      height: Math.max(Math.max(24, rackUnitHeight - 4), bottom - top - 4),
      zoneId: input.room
        ? `room:${input.room.id}:rack:${input.rack.id}`
        : `rack:${input.rack.id}`,
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
      health: getDeviceHealth(
        device,
        input.monitorsByDeviceId[device.id] ?? [],
      ),
    });
  });
  for (const [parentId, children] of Object.entries(shelfChildrenByParent)) {
    const parentBounds = rackNodeBounds.get(parentId);
    const parentNode = nodes.find((node) => node.device.id === parentId);
    if (!parentBounds || !parentNode) continue;
    const gap = input.readableLabels ? 8 : 4;
    const headerReserve =
      input.readableLabels && parentNode.device.deviceType === "rack_shelf"
        ? 34
        : 4;
    const availableWidth = parentNode.width - (input.readableLabels ? 18 : 12);
    const columns = shelfColumnCount({
      childCount: children.length,
      availableWidth,
      readableLabels: input.readableLabels,
      rackScale: input.rackScale,
      shelfLayout: input.shelfLayout,
      useDualFaceLayout,
    });
    const rows = Math.ceil(children.length / columns);
    const sortedChildren = [...children].sort(compareDeviceName);
    const childRows = Array.from({ length: rows }, (_, rowIndex) =>
      sortedChildren.slice(rowIndex * columns, rowIndex * columns + columns),
    );
    const rowHeights = childRows.map((row) =>
      Math.max(
        input.readableLabels ? 44 : NODE_HEIGHT,
        ...row.map((device) =>
          shelfChildHeightForDevice(
            device,
            input.readableLabels,
            input.rackScale,
          ),
        ),
      ),
    );
    const availableHeight = Math.max(
      input.readableLabels ? 44 : 24,
      parentBounds.height - headerReserve - 6,
    );
    const childWidth = Math.max(
      input.readableLabels ? 168 : useDualFaceLayout ? 78 : 88,
      Math.floor((availableWidth - gap * (columns - 1)) / columns),
    );
    const startX =
      parentNode.x +
      6 +
      Math.max(
        0,
        (availableWidth - (childWidth * columns + gap * (columns - 1))) / 2,
      );
    const totalRowsHeight =
      rowHeights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, rows - 1) * gap;
    const shelfAreaBottom = parentNode.y + parentBounds.height - 4;
    const shelfContentTop = Math.max(
      parentNode.y + headerReserve,
      shelfAreaBottom - totalRowsHeight,
    );
    let rowOffset = 0;
    sortedChildren.forEach((device, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const rowHeight = rowHeights[row] ?? (input.readableLabels ? 44 : 22);
      const childHeight = Math.max(
        input.readableLabels ? 44 : 22,
        Math.min(
          rowHeight,
          shelfChildHeightForDevice(
            device,
            input.readableLabels,
            input.rackScale,
          ),
        ),
      );
      nodes.push(
        createNode({
          device,
          x: startX + col * (childWidth + gap),
          y: shelfContentTop + rowOffset,
          width: childWidth,
          height: Math.max(
            input.readableLabels ? 44 : 22,
            Math.min(childHeight, availableHeight - rowOffset),
          ),
          zoneId: input.room
            ? `room:${input.room.id}:rack:${input.rack.id}`
            : `rack:${input.rack.id}`,
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
          health: getDeviceHealth(
            device,
            input.monitorsByDeviceId[device.id] ?? [],
          ),
        }),
      );
      if (col === columns - 1 || index === sortedChildren.length - 1) {
        rowOffset += rowHeight + gap;
      }
    });
  }
  const panelHeight = bodyY - input.y + bodyHeight + 48;
  return {
    id: input.rack.id,
    rack: input.rack,
    room: input.room,
    x: input.x,
    y: input.y,
    width: input.width,
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
      frontMounted: mountedFrontCount,
      rearMounted: mountedRearCount,
      freeU: Math.max(0, input.rack.totalU - occupiedUnits.size),
    },
    faces: faces.length > 0 ? faces : ["front"],
    faceMode: input.rackFaceMode,
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
  readableLabels = false,
  shelfLayout: VisualizerShelfLayout = "auto",
  rackScale: VisualizerRackScale = "normal",
) {
  const childrenByParent = groupBy(
    devices.filter((device) => device.parentDeviceId),
    (device) => device.parentDeviceId ?? "",
  );
  const deviceById = indexById(devices);
  const maxShelfUnitDemand = Math.max(
    0,
    ...Object.entries(childrenByParent).map(([parentId, children]) => {
      const parentHeightU = Math.max(1, deviceById[parentId]?.heightU ?? 1);
      const demandWidth = readableLabels
        ? RACK_NODE_READABLE_WIDTH_BY_SCALE[rackScale] - 18
        : RACK_NODE_WIDTH_BY_SCALE[rackScale] - 12;
      const columns = shelfColumnCount({
        childCount: children.length,
        availableWidth: demandWidth,
        readableLabels,
        rackScale,
        shelfLayout,
        useDualFaceLayout: false,
      });
      const sortedChildren = [...children].sort(compareDeviceName);
      const rows = Math.ceil(sortedChildren.length / columns);
      const rowHeights = Array.from({ length: rows }, (_, rowIndex) => {
        const row = sortedChildren.slice(
          rowIndex * columns,
          rowIndex * columns + columns,
        );
        return Math.max(
          readableLabels ? 44 : NODE_HEIGHT,
          ...row.map((device) =>
            shelfChildHeightForDevice(device, readableLabels, rackScale),
          ),
        );
      });
      const childDemand =
        (readableLabels ? 44 : 10) +
        rowHeights.reduce((sum, height) => sum + height, 0) +
        Math.max(0, rows - 1) * (readableLabels ? 8 : 4);
      return Math.ceil(childDemand / parentHeightU);
    }),
  );

  if (readableLabels && maxShelfUnitDemand > 0) {
    return clampNumber(maxShelfUnitDemand, 96, 220);
  }

  const maxOneUPorts = devices.reduce((max, device) => {
    const heightU = device.heightU ?? 1;
    if (heightU > 1) return max;
    return Math.max(max, portsByDeviceId[device.id]?.length ?? 0);
  }, 0);
  const portDrivenUnitHeight =
    maxOneUPorts >= 36
      ? RACK_UNIT_ULTRA_DENSE_HEIGHT
      : maxOneUPorts >= 18
        ? RACK_UNIT_DENSE_HEIGHT
        : maxOneUPorts >= 8
          ? RACK_UNIT_MEDIUM_HEIGHT
          : RACK_UNIT_BASE_HEIGHT;
  return Math.max(
    portDrivenUnitHeight,
    clampNumber(maxShelfUnitDemand, 0, 220),
  );
}

function buildRackRoomInputs(input: {
  racks: Rack[];
  looseDevices: Device[];
  looseDeviceRoomById: Map<string, Room | undefined>;
  roomsById: Record<string, Room>;
  includeRoomOnlySections: boolean;
}) {
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
  for (const rack of input.racks) {
    const room = rack.roomId ? input.roomsById[rack.roomId] : undefined;
    const key = room ? `room:${room.id}` : "room:unassigned";
    const existing = groups.get(key);
    if (existing) {
      existing.racks.push(rack);
      continue;
    }
    groups.set(key, {
      id: key,
      name: room?.name ?? "Unassigned room",
      subtitle:
        room?.location ??
        room?.description ??
        "Racks without a room assignment",
      room,
      racks: [rack],
    });
  }
  if (input.includeRoomOnlySections) {
    for (const device of input.looseDevices) {
      const room = input.looseDeviceRoomById.get(device.id);
      if (!room) continue;
      const key = `room:${room.id}`;
      if (groups.has(key)) continue;
      groups.set(key, {
        id: key,
        name: room.name,
        subtitle: room.location ?? room.description ?? "Room inventory",
        room,
        racks: [],
      });
    }
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
    const room = roomForDevice(
      device,
      input.deviceById,
      input.racksById,
      input.roomsById,
    );
    const roomKey = room ? `room:${room.id}` : "room:unassigned";
    const roomPrefix = room ? room.name : "Unassigned";
    if (isWirelessClientDevice(device)) {
      const parent = device.parentDeviceId
        ? input.deviceById[device.parentDeviceId]
        : undefined;
      const key = parent
        ? `${roomKey}:wifi-ap:${parent.id}`
        : `${roomKey}:wifi-ap:unassigned`;
      const existing = groups.get(key);
      if (existing) {
        existing.devices.push(device);
      } else {
        groups.set(key, {
          name: parent
            ? `${roomPrefix} / WiFi clients on ${parent.hostname}`
            : `${roomPrefix} / Unassigned WiFi clients`,
          subtitle: parent
            ? `Wireless clients${formatDeviceAddress(parent) ? ` | ${formatDeviceAddress(parent)}` : ""}`
            : "Wireless devices missing an AP link",
          color: typeColor("ap"),
          groupType: "virtual-host",
          devices: [device],
          room,
        });
      }
      continue;
    }

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
          name: parent
            ? `${roomPrefix} / VMs on ${parent.hostname}`
            : `${roomPrefix} / Unassigned VMs`,
          subtitle: parent
            ? `Hosted virtual inventory${formatDeviceAddress(parent) ? ` | ${formatDeviceAddress(parent)}` : ""}`
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
        subtitle: room
          ? (room.location ?? "Room inventory")
          : "Loose / unassigned inventory",
        color: typeColor(device.deviceType),
        groupType: "device-type",
        devices: [device],
        room,
      });
    }
  }

  let y = input.y;
  return Array.from(groups.entries())
    .sort(
      ([, a], [, b]) =>
        b.devices.length - a.devices.length ||
        NATURAL_COLLATOR.compare(a.name, b.name),
    )
    .map(([id, group]) => {
      const collapsed = input.collapsedGroups.has(id);
      const sortedDevices = [...group.devices].sort((a, b) => {
        const aHealth = getDeviceHealth(
          a,
          input.monitorsByDeviceId[a.id] ?? [],
        );
        const bHealth = getDeviceHealth(
          b,
          input.monitorsByDeviceId[b.id] ?? [],
        );
        return (
          healthSort(aHealth) - healthSort(bHealth) || compareDeviceName(a, b)
        );
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
              zoneId: group.room
                ? `room:${group.room.id}:loose`
                : "room:unassigned:loose",
              roomId: group.room?.id ?? null,
              roomName: group.room?.name ?? "Unassigned room",
              ports: input.portsByDeviceId[device.id] ?? [],
              portLinkByPortId: input.portLinkByPortId,
              virtualSwitchById: input.virtualSwitchById,
              discoveredByDeviceId: input.discoveredByDeviceId,
              discoveredByIp: input.discoveredByIp,
              subnetRanges: input.subnetRanges,
              vlansById: input.vlansById,
              health: getDeviceHealth(
                device,
                input.monitorsByDeviceId[device.id] ?? [],
              ),
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
            getDeviceHealth(
              device,
              input.monitorsByDeviceId[device.id] ?? [],
            ) === "online",
        ).length,
        down: group.devices.filter(
          (device) =>
            getDeviceHealth(
              device,
              input.monitorsByDeviceId[device.id] ?? [],
            ) === "offline",
        ).length,
        collapsed,
        groupType: group.groupType,
        subnet: group.subnet,
      };
    });
}

function isVirtualInventoryDevice(device: Device) {
  return (
    device.placement === "virtual" ||
    device.deviceType === "vm" ||
    device.deviceType === "container"
  );
}

function isWirelessClientDevice(device: Device) {
  return (
    device.placement === "wireless" &&
    device.deviceType !== "ap" &&
    Boolean(device.parentDeviceId)
  );
}

function roomForDevice(
  device: Device,
  deviceById: Record<string, Device>,
  racksById: Record<string, Rack>,
  roomsById: Record<string, Room>,
) {
  if (device.roomId && roomsById[device.roomId])
    return roomsById[device.roomId];
  if (device.rackId) {
    const rack = racksById[device.rackId];
    if (rack?.roomId && roomsById[rack.roomId]) return roomsById[rack.roomId];
  }
  const parent = device.parentDeviceId
    ? deviceById[device.parentDeviceId]
    : undefined;
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
    macAddress: input.device.macAddress ?? discovered?.macAddress,
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

function applyCustomNodePositions(
  nodes: VisualizerNode[],
  positions: VisualizerLayoutOptions["customNodePositions"],
) {
  for (const node of nodes) {
    const position = positions[node.device.id];
    if (!position) continue;
    const nextX = Math.max(
      PYRAMID_ZONE_X + ZONE_PADDING,
      Math.round(position.x),
    );
    const nextY = Math.max(
      PYRAMID_ZONE_Y + ZONE_HEADER,
      Math.round(position.y),
    );
    const deltaX = nextX - node.x;
    const deltaY = nextY - node.y;
    node.x = nextX;
    node.y = nextY;
    node.ports = node.ports.map((visualPort) => ({
      ...visualPort,
      x: visualPort.x + deltaX,
      y: visualPort.y + deltaY,
    }));
  }
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
  const startY =
    input.node.y + Math.max(5, (input.node.height - stripHeight) / 2);
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
        ? (input.virtualSwitchById[port.virtualSwitchId]?.name ?? null)
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
  snmpVerifiedPortIds: Set<string>;
}): VisualizerCable | null {
  const fromPort = input.portById[input.link.fromPortId];
  const toPort = input.portById[input.link.toPortId];
  const fromDevice = fromPort ? input.deviceById[fromPort.deviceId] : undefined;
  const toDevice = toPort ? input.deviceById[toPort.deviceId] : undefined;
  const fromNode = fromDevice
    ? input.nodesByDeviceId[fromDevice.id]
    : undefined;
  const toNode = toDevice ? input.nodesByDeviceId[toDevice.id] : undefined;
  if (
    !fromPort ||
    !toPort ||
    !fromDevice ||
    !toDevice ||
    !fromNode ||
    !toNode
  ) {
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
    path: visualizerCablePath(fromPoint, toPoint, input.index),
    color: normalizeColorToCss(input.link.color) ?? CABLE_FALLBACK_COLOR,
    up,
    bothOnline: fromNode.health === "online" && toNode.health === "online",
    unknown,
    crossZone: fromNode.zoneId !== toNode.zoneId,
    snmpVerified:
      input.snmpVerifiedPortIds.has(fromPort.id) &&
      input.snmpVerifiedPortIds.has(toPort.id),
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

function buildDeviceAdjacency(
  devices: Device[],
  links: PortLink[],
  portById: Record<string, Port>,
) {
  const adjacency: Record<string, Set<string>> = {};
  for (const device of devices) {
    adjacency[device.id] = new Set();
  }
  for (const link of links) {
    const fromPort = portById[link.fromPortId];
    const toPort = portById[link.toPortId];
    if (!fromPort || !toPort || fromPort.deviceId === toPort.deviceId) {
      continue;
    }
    adjacency[fromPort.deviceId]?.add(toPort.deviceId);
    adjacency[toPort.deviceId]?.add(fromPort.deviceId);
  }
  return adjacency;
}

function buildPyramidComponents(
  devices: Device[],
  adjacency: Record<string, Set<string>>,
) {
  const visited = new Set<string>();
  const linkedComponents: string[][] = [];
  const unlinked: string[] = [];
  const sortedDeviceIds = [...devices]
    .sort((a, b) => comparePyramidDevices(a, b, adjacency))
    .map((device) => device.id);

  for (const deviceId of sortedDeviceIds) {
    if (visited.has(deviceId)) continue;
    const queue = [deviceId];
    const component: string[] = [];
    visited.add(deviceId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency[current] ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    if (component.length === 1 && (adjacency[component[0]]?.size ?? 0) === 0) {
      unlinked.push(component[0]);
    } else {
      linkedComponents.push(component);
    }
  }

  linkedComponents.sort((a, b) => {
    const aScore = maxOf(a, (id) => adjacency[id]?.size ?? 0, 0);
    const bScore = maxOf(b, (id) => adjacency[id]?.size ?? 0, 0);
    return (
      b.length - a.length ||
      bScore - aScore ||
      NATURAL_COLLATOR.compare(a[0], b[0])
    );
  });

  if (unlinked.length > 0) {
    const groupedUnlinked: string[][] = [];
    for (let index = 0; index < unlinked.length; index += 8) {
      groupedUnlinked.push(unlinked.slice(index, index + 8));
    }
    return [...linkedComponents, ...groupedUnlinked];
  }

  return linkedComponents;
}

function buildPyramidLayers(
  component: string[],
  adjacency: Record<string, Set<string>>,
  deviceById: Record<string, Device>,
) {
  if (component.every((deviceId) => (adjacency[deviceId]?.size ?? 0) === 0)) {
    return [component];
  }

  const componentSet = new Set(component);
  const root = pickPyramidRoot(component, adjacency, deviceById);
  const layers: string[][] = [];
  const visited = new Set([root]);
  const queue: Array<{ id: string; depth: number }> = [{ id: root, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    (layers[current.depth] ??= []).push(current.id);
    const neighbors = [...(adjacency[current.id] ?? [])]
      .filter((neighbor) => componentSet.has(neighbor))
      .sort((a, b) =>
        comparePyramidDevices(deviceById[a], deviceById[b], adjacency),
      );
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push({ id: neighbor, depth: current.depth + 1 });
    }
  }

  const missed = component.filter((deviceId) => !visited.has(deviceId));
  if (missed.length > 0) {
    layers.push(missed);
  }

  return layers;
}

function pickPyramidRoot(
  component: string[],
  adjacency: Record<string, Set<string>>,
  deviceById: Record<string, Device>,
) {
  return [...component].sort((a, b) =>
    comparePyramidRootDevices(deviceById[a], deviceById[b], adjacency),
  )[0];
}

function comparePyramidRootDevices(
  a: Device | undefined,
  b: Device | undefined,
  adjacency: Record<string, Set<string>>,
) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const priority =
    pyramidRootPriority(b) - pyramidRootPriority(a) ||
    (adjacency[b.id]?.size ?? 0) - (adjacency[a.id]?.size ?? 0) ||
    typeOrder(a.deviceType) - typeOrder(b.deviceType);
  return priority || compareDeviceName(a, b);
}

function comparePyramidDevices(
  a: Device | undefined,
  b: Device | undefined,
  adjacency: Record<string, Set<string>>,
) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return (
    typeOrder(a.deviceType) - typeOrder(b.deviceType) ||
    (adjacency[b.id]?.size ?? 0) - (adjacency[a.id]?.size ?? 0) ||
    compareDeviceName(a, b)
  );
}

function pyramidRootPriority(device: Device) {
  switch (device.deviceType) {
    case "firewall":
      return 90;
    case "router":
      return 80;
    case "switch":
      return 70;
    case "patch_panel":
      return 60;
    case "ap":
      return 50;
    case "server":
    case "storage":
      return 40;
    default:
      return 10;
  }
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
  return traceToPort(buildTraceAdjacency(model), fromPortId, toPortId);
}

export function traceFromPort(
  model: VisualizerModel,
  fromPortId: string,
): TraceResult | null {
  const adjacency = buildTraceAdjacency(model);
  const queue = [fromPortId];
  const visited = new Set([fromPortId]);
  const previous = new Map<string, TraceSegment>();
  let fallbackPortId: string | null = null;

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current !== fromPortId) fallbackPortId = current;
    const nextSegments = adjacency[current] ?? [];
    if (current !== fromPortId && nextSegments.length <= 1) {
      return buildTraceResult(fromPortId, current, previous);
    }
    for (const segment of nextSegments) {
      const next = segment.toPort.id;
      if (visited.has(next)) continue;
      visited.add(next);
      previous.set(next, segment);
      queue.push(next);
    }
  }

  return fallbackPortId
    ? buildTraceResult(fromPortId, fallbackPortId, previous)
    : null;
}

function buildTraceAdjacency(model: VisualizerModel) {
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
    const grouped = groupBy(
      model.portsByDeviceId[device.id] ?? [],
      (port) => `${port.kind}:${port.name}`,
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

  return adjacency;
}

function traceToPort(
  adjacency: Record<string, TraceSegment[]>,
  fromPortId: string,
  toPortId: string,
) {
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
        return buildTraceResult(fromPortId, toPortId, previous);
      }
      queue.push(next);
    }
  }
  return null;
}

function buildTraceResult(
  fromPortId: string,
  toPortId: string,
  previous: Map<string, TraceSegment>,
): TraceResult | null {
  const segments: TraceSegment[] = [];
  let cursor = toPortId;
  while (cursor !== fromPortId) {
    const step = previous.get(cursor);
    if (!step) break;
    segments.unshift(step);
    cursor = step.fromPort.id;
  }
  if (segments.length === 0) return null;
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
        meta:
          [node.device.managementIp, node.macAddress]
            .filter(Boolean)
            .join(" | ") || DEVICE_TYPE_LABEL[node.device.deviceType],
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

function roundPathCoord(value: number) {
  return Math.round(value * 10) / 10;
}

function pathPoint(point: { x: number; y: number }) {
  return `${roundPathCoord(point.x)} ${roundPathCoord(point.y)}`;
}

export function visualizerCablePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  index: number,
  layout: VisualizerCableLayout = "auto",
) {
  if (layout === "straight") {
    return straightCablePath(from, to, index);
  }
  if (layout === "concave") {
    return concaveCablePath(from, to, index);
  }
  if (layout === "convex") {
    return convexCablePath(from, to, index);
  }
  return autoCablePath(from, to, index);
}

function straightCablePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  index: number,
) {
  const laneOffset = ((index % 17) - 8) * 4;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const normalX = (-dy / distance) * laneOffset;
  const normalY = (dx / distance) * laneOffset;
  return `M ${pathPoint({ x: from.x + normalX, y: from.y + normalY })} L ${pathPoint({
    x: to.x + normalX,
    y: to.y + normalY,
  })}`;
}

function autoCablePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  index: number,
) {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const laneOffset = ((index % 17) - 8) * 7;
  if (dx < 72) {
    const busX = Math.max(from.x, to.x) + 72 + Math.abs(laneOffset) * 0.8;
    return `M ${pathPoint(from)} L ${pathPoint({ x: busX, y: from.y })} C ${pathPoint({
      x: busX + laneOffset,
      y: from.y,
    })}, ${pathPoint({ x: busX + laneOffset, y: to.y })}, ${pathPoint({
      x: busX,
      y: to.y,
    })} L ${pathPoint(to)}`;
  }
  if (dy < 86) {
    const laneY = Math.min(from.y, to.y) - 38 - Math.abs(laneOffset) * 0.75;
    const corner = Math.min(44, dx * 0.25);
    return `M ${pathPoint(from)} C ${pathPoint({
      x: from.x + corner,
      y: from.y,
    })}, ${pathPoint({ x: from.x + corner, y: laneY })}, ${pathPoint({
      x: from.x + corner * 2,
      y: laneY,
    })} L ${pathPoint({ x: to.x - corner * 2, y: laneY })} C ${pathPoint({
      x: to.x - corner,
      y: laneY,
    })}, ${pathPoint({ x: to.x - corner, y: to.y })}, ${pathPoint(to)}`;
  }
  const curve = Math.max(86, dx * 0.34);
  return `M ${pathPoint({ x: from.x, y: from.y + laneOffset })} C ${pathPoint({
    x: from.x + curve,
    y: from.y + laneOffset,
  })}, ${pathPoint({ x: to.x - curve, y: to.y - laneOffset })}, ${pathPoint({
    x: to.x,
    y: to.y - laneOffset,
  })}`;
}

function concaveCablePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  index: number,
) {
  const laneOffset = ((index % 17) - 8) * 5;
  const midX = (from.x + to.x) / 2 + laneOffset;
  const midY = (from.y + to.y) / 2 + laneOffset;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const corner = Math.min(28, Math.max(12, Math.min(dx, dy) * 0.18));

  if (dx >= dy) {
    return `M ${pathPoint(from)} L ${pathPoint({
      x: from.x,
      y: midY,
    })} Q ${pathPoint({ x: from.x + corner, y: midY })}, ${pathPoint({
      x: from.x + corner * 2,
      y: midY,
    })} L ${pathPoint({ x: to.x - corner * 2, y: midY })} Q ${pathPoint({
      x: to.x - corner,
      y: midY,
    })}, ${pathPoint({ x: to.x, y: midY })} L ${pathPoint(to)}`;
  }

  return `M ${pathPoint(from)} L ${pathPoint({
    x: midX,
    y: from.y,
  })} Q ${pathPoint({ x: midX, y: from.y + corner })}, ${pathPoint({
    x: midX,
    y: from.y + corner * 2,
  })} L ${pathPoint({ x: midX, y: to.y - corner * 2 })} Q ${pathPoint({
    x: midX,
    y: to.y - corner,
  })}, ${pathPoint({ x: midX, y: to.y })} L ${pathPoint(to)}`;
}

function convexCablePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  index: number,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const distance = Math.max(1, Math.hypot(dx, dy));
  const laneOffset = ((index % 17) - 8) * 10;
  const outward = index % 2 === 0 ? 1 : -1;
  const detour = Math.min(360, Math.max(120, distance * 0.42)) + laneOffset;

  if (absDx >= absDy) {
    const side = from.y <= to.y ? -1 : 1;
    const laneY =
      Math.min(from.y, to.y) - detour * side * outward;
    const lead = Math.min(72, absDx * 0.22);
    return `M ${pathPoint(from)} C ${pathPoint({
      x: from.x + lead,
      y: from.y,
    })}, ${pathPoint({ x: from.x + lead * 2, y: laneY })}, ${pathPoint({
      x: from.x + lead * 3,
      y: laneY,
    })} L ${pathPoint({ x: to.x - lead * 3, y: laneY })} C ${pathPoint({
      x: to.x - lead * 2,
      y: laneY,
    })}, ${pathPoint({ x: to.x - lead, y: to.y })}, ${pathPoint(to)}`;
  }

  const side = from.x <= to.x ? -1 : 1;
  const laneX =
    Math.min(from.x, to.x) - detour * side * outward;
  const lead = Math.min(72, absDy * 0.22);
  return `M ${pathPoint(from)} C ${pathPoint({
    x: from.x,
    y: from.y + lead,
  })}, ${pathPoint({ x: laneX, y: from.y + lead * 2 })}, ${pathPoint({
    x: laneX,
    y: from.y + lead * 3,
  })} L ${pathPoint({ x: laneX, y: to.y - lead * 3 })} C ${pathPoint({
    x: laneX,
    y: to.y - lead * 2,
  })}, ${pathPoint({ x: to.x, y: to.y - lead })}, ${pathPoint(to)}`;
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
    .sort((a, b) => NATURAL_COLLATOR.compare(typeLabel(a), typeLabel(b)));

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
  return (
    kind === "sfp" || kind === "sfp_plus" || kind === "qsfp" || kind === "fiber"
  );
}

function comparePorts(a: Port, b: Port) {
  return a.position - b.position || NATURAL_COLLATOR.compare(a.name, b.name);
}

function compareRackDevices(a: Device, b: Device) {
  const aStart = a.startU ?? 0;
  const bStart = b.startU ?? 0;
  return bStart - aStart || compareDeviceName(a, b);
}

function compareDeviceName(a: Device, b: Device) {
  const aIp = deviceSortIpValue(a);
  const bIp = deviceSortIpValue(b);
  if (aIp != null && bIp != null && aIp !== bIp) return aIp - bIp;
  return NATURAL_COLLATOR.compare(deviceSortLabel(a), deviceSortLabel(b));
}

function deviceSortLabel(device: Device) {
  return (
    device.displayName || device.hostname || device.managementIp || device.id
  );
}

function deviceSortIpValue(device: Device) {
  return (
    parseSortableIp(device.managementIp) ??
    parseSortableIp(deviceSortLabel(device))
  );
}

function parseSortableIp(value?: string | null) {
  if (!value) return null;
  const match = value.match(
    /(?:^|[^\d])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?:[^\d]|$)/,
  );
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return (
    octets[0] * 256 ** 3 + octets[1] * 256 ** 2 + octets[2] * 256 + octets[3]
  );
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

function rackPanelWidthForLayout(
  rackFaceMode: VisualizerRackFaceMode,
  rackScale: VisualizerRackScale,
  readableLabels: boolean,
) {
  if (rackFaceMode === "both") {
    return readableLabels
      ? RACK_DUAL_READABLE_WIDTH_BY_SCALE[rackScale]
      : RACK_DUAL_WIDTH_BY_SCALE[rackScale];
  }
  return readableLabels
    ? RACK_SINGLE_READABLE_WIDTH_BY_SCALE[rackScale]
    : RACK_SINGLE_WIDTH_BY_SCALE[rackScale];
}

function shelfColumnCount(input: {
  childCount: number;
  availableWidth: number;
  readableLabels: boolean;
  rackScale: VisualizerRackScale;
  shelfLayout: VisualizerShelfLayout;
  useDualFaceLayout: boolean;
}) {
  if (input.childCount <= 1) return 1;
  const minChildWidth = input.readableLabels
    ? 168
    : input.useDualFaceLayout
      ? 78
      : 88;
  const fitColumns = Math.max(
    1,
    Math.floor((input.availableWidth + 8) / (minChildWidth + 8)),
  );

  if (input.shelfLayout === "stacked") return 1;
  if (input.shelfLayout === "expanded") {
    const maxExpandedColumns = input.rackScale === "xwide" ? 4 : 3;
    return Math.max(
      1,
      Math.min(input.childCount, fitColumns, maxExpandedColumns),
    );
  }
  if (input.readableLabels) {
    return Math.min(input.childCount, Math.max(1, Math.min(fitColumns, 2)));
  }
  return input.childCount > 3 ? 2 : Math.max(1, input.childCount);
}

function shelfChildHeightForDevice(
  device: Device,
  readableLabels: boolean,
  rackScale: VisualizerRackScale,
) {
  const heightU = Math.max(1, Math.ceil(device.heightU ?? 1));
  const unitHeight = readableLabels
    ? rackScale === "compact"
      ? 48
      : 54
    : rackScale === "compact"
      ? 34
      : rackScale === "normal"
        ? NODE_HEIGHT
        : 44;
  return Math.max(readableLabels ? 44 : NODE_HEIGHT, heightU * unitHeight);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

export function portTooltip(
  visualPort: VisualizerPort,
  model: VisualizerModel,
  t: ReturnType<typeof useI18n>["t"],
) {
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
    `${visualPort.port.name} (${formatPortTypeLabel(t, visualPort.port.kind)})`,
    visualPort.port.speed ? `Speed: ${visualPort.port.speed}` : null,
    `State: ${visualPort.port.linkState}`,
    `VLAN: ${visualPort.vlanSummary}`,
    visualPort.bridgeName ? `Bridge: ${visualPort.bridgeName}` : null,
    peer ? `Patched to: ${peer}` : "No documented cable",
  ]
    .filter(Boolean)
    .join("\n");
}
