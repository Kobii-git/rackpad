import type {
  FaceDefinitionV1,
  HardwareModuleV1,
  HardwareTemplateV1,
  PhysicalPortSlotV1,
  PortKind,
  RackFace,
} from "./types";

export type PortBlockDirection =
  "left-to-right" | "right-to-left" | "vertical" | "serpentine";

export interface PortBlockDefinition {
  id: string;
  face: RackFace;
  connector: PortKind;
  count: number;
  rows: number;
  columns: number;
  start: number;
  direction: PortBlockDirection;
  x: number;
  y: number;
  width: number;
  height: number;
  labelPrefix?: string;
}

export interface HardwareTemplateStarter {
  id: string;
  name: string;
  category: string;
  deviceType: string;
  heightU: number;
  portBlocks: PortBlockDefinition[];
}

const FACE_HEIGHT = 300;

export const HARDWARE_TEMPLATE_STARTERS: HardwareTemplateStarter[] = [
  starter("server-1u", "Generic 1U server", "server", "server", 1),
  starter("server-2u", "Generic 2U server", "server", "server", 2),
  starter("server-4u", "Generic 4U server", "server", "server", 4),
  starter("desktop", "Generic desktop PC", "endpoint", "endpoint", 1),
  starter("tower", "Generic tower PC", "endpoint", "endpoint", 4),
  starter("storage", "Storage equipment", "storage", "storage", 2),
  starter("firewall", "Firewall appliance", "firewall", "firewall", 1, 8),
  starter("router", "Router appliance", "router", "router", 1, 8),
  starter("switch-8", "8-port switch", "switch", "switch", 1, 8),
  starter("switch-16", "16-port switch", "switch", "switch", 1, 16),
  starter(
    "switch-24",
    "24-port switch with uplinks",
    "switch",
    "switch",
    1,
    24,
    4,
  ),
  starter(
    "switch-48",
    "48-port switch with uplinks",
    "switch",
    "switch",
    1,
    48,
    4,
  ),
  starter("patch-panel", "Patch panel", "patch_panel", "patch_panel", 1, 24),
  starter("pdu", "Power distribution unit", "pdu", "pdu", 1, 8),
  starter("ups", "UPS", "ups", "ups", 2, 4),
  starter("kvm", "KVM", "kvm", "kvm", 1, 8),
  starter("shelf", "Rack shelf", "rack_shelf", "rack_shelf", 1),
  starter("blanking", "Blanking panel", "blanking_panel", "blanking_panel", 1),
];

export const MODULE_PRIMITIVES = [
  "nic",
  "pcie",
  "psu",
  "fan",
  "drive",
  "management",
  "console",
  "usb",
  "serial",
  "vga",
  "sfp",
  "sfp_plus",
  "qsfp",
] as const;

export type HardwareModulePrimitive = (typeof MODULE_PRIMITIVES)[number];

function starter(
  id: string,
  name: string,
  category: string,
  deviceType: string,
  heightU: number,
  portCount = 0,
  uplinkCount = 0,
): HardwareTemplateStarter {
  const connector: PortKind =
    category === "pdu" || category === "ups"
      ? "power"
      : category === "storage"
        ? "sff"
        : "rj45";
  const face: RackFace = category === "patch_panel" ? "front" : "rear";
  const blocks: PortBlockDefinition[] = [];
  if (portCount > 0) {
    const rows = portCount > 24 ? 2 : portCount > 12 ? 2 : 1;
    blocks.push({
      id: "ports",
      face,
      connector,
      count: portCount,
      rows,
      columns: Math.ceil(portCount / rows),
      start: 1,
      direction: "left-to-right",
      x: 110,
      y: rows === 1 ? 108 : 80,
      width: uplinkCount > 0 ? 650 : 780,
      height: rows === 1 ? 62 : 126,
      labelPrefix: category === "pdu" || category === "ups" ? "Outlet " : "",
    });
  }
  if (uplinkCount > 0) {
    blocks.push({
      id: "uplinks",
      face: "rear",
      connector: "sfp_plus",
      count: uplinkCount,
      rows: 2,
      columns: Math.ceil(uplinkCount / 2),
      start: portCount + 1,
      direction: "vertical",
      x: 800,
      y: 90,
      width: 100,
      height: 100,
      labelPrefix: "10G ",
    });
  }
  return { id, name, category, deviceType, heightU, portBlocks: blocks };
}

function baseFace(face: RackFace, label: string): FaceDefinitionV1 {
  return {
    schemaVersion: 1,
    width: 1000,
    height: FACE_HEIGHT,
    elements: [
      {
        kind: "panel",
        id: `${face}-panel`,
        x: 18,
        y: 18,
        width: 964,
        height: 264,
        tone: "mid",
      },
      {
        kind: "handle",
        id: `${face}-handle-left`,
        x: 28,
        y: 66,
        width: 34,
        height: 168,
        tone: "dark",
      },
      {
        kind: "handle",
        id: `${face}-handle-right`,
        x: 938,
        y: 66,
        width: 34,
        height: 168,
        tone: "dark",
      },
      {
        kind: "vent",
        id: `${face}-vent`,
        x: 88,
        y: 60,
        width: 824,
        height: 180,
        tone: "dark",
      },
      {
        kind: "screw",
        id: `${face}-screw-tl`,
        x: 45,
        y: 42,
        radius: 8,
        tone: "light",
      },
      {
        kind: "screw",
        id: `${face}-screw-tr`,
        x: 955,
        y: 42,
        radius: 8,
        tone: "light",
      },
      {
        kind: "screw",
        id: `${face}-screw-bl`,
        x: 45,
        y: 258,
        radius: 8,
        tone: "light",
      },
      {
        kind: "screw",
        id: `${face}-screw-br`,
        x: 955,
        y: 258,
        radius: 8,
        tone: "light",
      },
      {
        kind: "label",
        id: `${face}-label`,
        x: 92,
        y: 43,
        text: `${label} · ${face}`,
        align: "start",
      },
      {
        kind: "indicator",
        id: `${face}-indicator`,
        x: 900,
        y: 40,
        radius: 7,
        tone: "accent",
      },
    ],
  };
}

function connectorSize(connector: PortKind) {
  if (connector === "power") return { width: 48, height: 50 };
  if (connector === "usb") return { width: 34, height: 18 };
  if (connector === "console") return { width: 42, height: 24 };
  if (
    connector === "sfp" ||
    connector === "sfp_plus" ||
    connector === "fiber"
  ) {
    return { width: 34, height: 24 };
  }
  if (connector === "qsfp") return { width: 42, height: 28 };
  return { width: 38, height: 32 };
}

export function generatePortBlock(
  block: PortBlockDefinition,
): PhysicalPortSlotV1[] {
  const count = clampInteger(block.count, 1, 500);
  const rows = clampInteger(block.rows, 1, 64);
  const columns = clampInteger(block.columns, 1, 64);
  const capacity = rows * columns;
  const actualCount = Math.min(count, capacity);
  const cellWidth = block.width / columns;
  const cellHeight = block.height / rows;
  const dimensions = connectorSize(block.connector);

  return Array.from({ length: actualCount }, (_, index) => {
    let row = Math.floor(index / columns);
    let column = index % columns;
    if (block.direction === "right-to-left") column = columns - 1 - column;
    if (block.direction === "vertical") {
      row = index % rows;
      column = Math.floor(index / rows);
    }
    if (block.direction === "serpentine" && row % 2 === 1) {
      column = columns - 1 - column;
    }
    const number = block.start + index;
    const width = Math.min(dimensions.width, Math.max(8, cellWidth - 5));
    const height = Math.min(dimensions.height, Math.max(8, cellHeight - 5));
    return {
      id: `${safeId(block.id)}-${number}`,
      face: block.face,
      x: round(block.x + column * cellWidth + (cellWidth - width) / 2),
      y: round(block.y + row * cellHeight + (cellHeight - height) / 2),
      width: round(width),
      height: round(height),
      rotation: 0,
      connector: block.connector,
      acceptedPortKinds: [block.connector],
      groupId: safeId(block.id),
      label: `${block.labelPrefix ?? ""}${number}`,
    };
  });
}

export function createStarterTemplate(
  starterId: string,
  id?: string,
  name?: string,
): HardwareTemplateV1 {
  const starter =
    HARDWARE_TEMPLATE_STARTERS.find((entry) => entry.id === starterId) ??
    HARDWARE_TEMPLATE_STARTERS[0]!;
  const templateId = safeId(id || `custom-${starter.id}`);
  const templateName = name?.trim() || starter.name;
  const hasModuleSlots = ["server", "endpoint", "storage"].includes(
    starter.category,
  );
  const moduleSlots = hasModuleSlots
    ? [
        {
          id: "rear-module-a",
          face: "rear" as const,
          x: 620,
          y: 88,
          width: 130,
          height: 112,
        },
        {
          id: "rear-module-b",
          face: "rear" as const,
          x: 770,
          y: 88,
          width: 130,
          height: 112,
        },
      ]
    : [];
  return {
    schemaVersion: 1,
    id: templateId,
    name: templateName,
    description: `Rackpad-authored ${starter.name.toLowerCase()} physical layout.`,
    category: starter.category,
    deviceTypes: [starter.deviceType],
    mountDefaults: {
      kind: starter.category === "endpoint" ? "shelf" : "direct",
      heightU: starter.heightU,
      columnSpan: 12,
    },
    front: baseFace("front", templateName),
    rear: baseFace("rear", templateName),
    portSlots: starter.portBlocks.flatMap(generatePortBlock),
    moduleSlots,
    modules: hasModuleSlots
      ? [
          createHardwareModule(
            "nic-2-rj45",
            "Two-port NIC",
            "rear-module-a",
            "nic",
            2,
          ),
          createHardwareModule(
            "nic-4-rj45",
            "Four-port NIC",
            "rear-module-a",
            "nic",
            4,
          ),
          createHardwareModule(
            "pcie-2-sfp-plus",
            "Two-port 10G adapter",
            "rear-module-b",
            "sfp_plus",
            2,
          ),
        ]
      : [],
    portBlueprints: starter.portBlocks.map((block) => ({ ...block })),
    driveBayBlueprints: [],
  };
}

export function createHardwareModule(
  id: string,
  name: string,
  slotId: string,
  primitive: HardwareModulePrimitive,
  count = 1,
): HardwareModuleV1 {
  const secondSlot = slotId.endsWith("b");
  const x = secondSlot ? 770 : 620;
  const y = 88;
  const connector = moduleConnector(primitive);
  const portCount = ["fan"].includes(primitive)
    ? 0
    : clampInteger(count, 1, 16);
  const block: PortBlockDefinition = {
    id: `${safeId(id)}-ports`,
    face: "rear",
    connector,
    count: Math.max(1, portCount),
    rows: portCount > 2 ? 2 : 1,
    columns: Math.max(1, Math.ceil(portCount / (portCount > 2 ? 2 : 1))),
    start: 1,
    direction: "left-to-right",
    x: x + 12,
    y: y + 34,
    width: 106,
    height: 60,
    labelPrefix: "",
  };
  return {
    id: safeId(id),
    name,
    slotId,
    face: "rear",
    elements: [
      {
        kind: "panel",
        id: `${safeId(id)}-panel`,
        x,
        y,
        width: 130,
        height: 112,
        tone: "light",
      },
      {
        kind: "label",
        id: `${safeId(id)}-label`,
        x: x + 10,
        y: y + 22,
        text: name.slice(0, 24),
        align: "start",
      },
    ],
    portSlots: portCount > 0 ? generatePortBlock(block) : [],
  };
}

function moduleConnector(primitive: HardwareModulePrimitive): PortKind {
  if (primitive === "psu") return "power";
  if (primitive === "console") return "console";
  if (primitive === "usb") return "usb";
  if (primitive === "sfp") return "sfp";
  if (primitive === "sfp_plus" || primitive === "pcie") return "sfp_plus";
  if (primitive === "qsfp") return "qsfp";
  if (primitive === "drive") return "sff";
  if (primitive === "serial" || primitive === "vga") return "other";
  return "rj45";
}

export function replacePortBlock(
  template: HardwareTemplateV1,
  block: PortBlockDefinition,
): HardwareTemplateV1 {
  const groupId = safeId(block.id);
  const nextBlocks = [
    ...template.portBlueprints.filter((entry) => entry.id !== block.id),
    { ...block },
  ];
  return {
    ...template,
    portSlots: [
      ...template.portSlots.filter((slot) => slot.groupId !== groupId),
      ...generatePortBlock(block),
    ],
    portBlueprints: nextBlocks,
  };
}

export function movePhysicalPortSlot(
  template: HardwareTemplateV1,
  slotId: string,
  x: number,
  y: number,
): HardwareTemplateV1 {
  return {
    ...template,
    portSlots: template.portSlots.map((slot) =>
      slot.id === slotId
        ? {
            ...slot,
            x: round(Math.max(0, Math.min(1000 - slot.width, x))),
            y: round(Math.max(0, Math.min(FACE_HEIGHT - slot.height, y))),
          }
        : slot,
    ),
  };
}

export function templateToResolvedLayout(template: HardwareTemplateV1) {
  return {
    schemaVersion: 1 as const,
    sourceTemplateId: template.id,
    category: template.category,
    mount: {
      kind: template.mountDefaults.kind,
      heightU: template.mountDefaults.heightU,
      column: 0,
      columnSpan: template.mountDefaults.columnSpan,
    },
    faces: { front: template.front, rear: template.rear },
    portSlots: template.portSlots,
  };
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Math.round(value || minimum)));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function safeId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || "hardware-template";
}
