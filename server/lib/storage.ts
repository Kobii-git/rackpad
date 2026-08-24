import { db, parseRow } from "../db.js";
import { deviceTypeMatches } from "./device-types.js";
import { createId } from "./ids.js";
import {
  asObject,
  optionalEnum,
  optionalInteger,
  requiredEnum,
  requiredString,
  ValidationError,
} from "./validation.js";

export const DRIVE_INTERFACES = [
  "sata",
  "sas",
  "nvme",
  "usb",
  "other",
] as const;
export const DRIVE_FORM_FACTORS = ["2.5", "3.5", "m2", "u2", "other"] as const;
export const DRIVE_SLOT_TYPES = ["2.5", "3.5", "m2", "u2", "generic"] as const;
export const DRIVE_SLOT_FACES = ["front", "rear", "internal"] as const;
export const DRIVE_SLOT_LAYOUTS = ["grid", "list"] as const;
export const STORAGE_POOL_TYPES = [
  "raid0",
  "raid1",
  "raid5",
  "raid6",
  "raid10",
  "raidz1",
  "raidz2",
  "raidz3",
  "mirror",
  "unraid",
  "jbod",
  "other",
] as const;
export const STORAGE_POOL_STATUSES = [
  "healthy",
  "degraded",
  "rebuilding",
  "offline",
  "unknown",
] as const;

export type DriveSlotType = (typeof DRIVE_SLOT_TYPES)[number];
export type DriveSlotFace = (typeof DRIVE_SLOT_FACES)[number];
export type DriveSlotLayout = (typeof DRIVE_SLOT_LAYOUTS)[number];

export interface DriveBayTemplateSlot {
  name: string;
  position: number;
  slotType: DriveSlotType;
}

export interface DriveBayTemplateSection {
  name: string;
  face: DriveSlotFace;
  layout: DriveSlotLayout;
  columns?: number | null;
  slots: DriveBayTemplateSlot[];
}

export interface DriveBayTemplate {
  id: string;
  name: string;
  description: string;
  deviceTypes: string[];
  sections: DriveBayTemplateSection[];
  builtIn?: boolean;
}

function generatedSection(input: {
  count: number;
  slotType: DriveSlotType;
  columns: number;
  face?: DriveSlotFace;
  name?: string;
  prefix?: string;
  layout?: DriveSlotLayout;
}): DriveBayTemplateSection {
  return {
    name: input.name ?? "Drive bays",
    face: input.face ?? "front",
    layout: input.layout ?? "grid",
    columns: input.layout === "list" ? null : input.columns,
    slots: Array.from({ length: input.count }, (_, index) => ({
      name: `${input.prefix ?? "Bay "}${index + 1}`,
      position: index + 1,
      slotType: input.slotType,
    })),
  };
}

export const BUILT_IN_DRIVE_BAY_TEMPLATES: DriveBayTemplate[] = [
  {
    id: "storage-4x3-5",
    name: "4 × 3.5-inch bays",
    description: "Four front-facing 3.5-inch drive bays.",
    deviceTypes: ["server", "storage"],
    sections: [generatedSection({ count: 4, slotType: "3.5", columns: 4 })],
  },
  {
    id: "storage-8x3-5",
    name: "8 × 3.5-inch bays",
    description: "Eight front-facing 3.5-inch drive bays in two rows.",
    deviceTypes: ["server", "storage"],
    sections: [generatedSection({ count: 8, slotType: "3.5", columns: 4 })],
  },
  {
    id: "storage-12x3-5",
    name: "12 × 3.5-inch bays",
    description: "Twelve front-facing 3.5-inch drive bays in three rows.",
    deviceTypes: ["server", "storage"],
    sections: [generatedSection({ count: 12, slotType: "3.5", columns: 4 })],
  },
  {
    id: "storage-24x2-5",
    name: "24 × 2.5-inch bays",
    description: "Twenty-four front-facing 2.5-inch drive bays in two rows.",
    deviceTypes: ["server", "storage"],
    sections: [generatedSection({ count: 24, slotType: "2.5", columns: 12 })],
  },
  {
    id: "storage-2xm2",
    name: "2 × M.2 internal slots",
    description: "Two internal M.2 storage slots.",
    deviceTypes: ["server", "storage"],
    sections: [
      generatedSection({
        count: 2,
        slotType: "m2",
        columns: 2,
        face: "internal",
        name: "Internal storage",
        prefix: "M.2 ",
        layout: "list",
      }),
    ],
  },
].map((template) => ({ ...template, builtIn: true }));

export function normalizeDriveBayTemplateSections(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError("sections must be a non-empty array.");
  }
  if (value.length > 20) {
    throw new ValidationError("sections must contain 20 entries or fewer.");
  }

  let totalSlots = 0;
  const sectionNames = new Set<string>();
  const sections = value.map((entry, sectionIndex) => {
    const section = asObject(entry);
    const name = requiredString(section, "name", { maxLength: 80 });
    const normalizedName = name.toLowerCase();
    if (sectionNames.has(normalizedName)) {
      throw new ValidationError(`Section name ${name} is duplicated.`);
    }
    sectionNames.add(normalizedName);
    const face = requiredEnum(section, "face", DRIVE_SLOT_FACES);
    const layout = requiredEnum(section, "layout", DRIVE_SLOT_LAYOUTS);
    const columns =
      layout === "grid"
        ? (optionalInteger(section, "columns", { min: 1, max: 24 }) ?? 4)
        : null;
    if (!Array.isArray(section.slots) || section.slots.length === 0) {
      throw new ValidationError(
        `Section ${name} must include at least one slot.`,
      );
    }

    const slotNames = new Set<string>();
    const slots = section.slots.map((slotEntry, slotIndex) => {
      const slot = asObject(slotEntry);
      const slotName = requiredString(slot, "name", { maxLength: 80 });
      const normalizedSlotName = slotName.toLowerCase();
      if (slotNames.has(normalizedSlotName)) {
        throw new ValidationError(
          `Slot name ${slotName} is duplicated in ${name}.`,
        );
      }
      slotNames.add(normalizedSlotName);
      return {
        name: slotName,
        position:
          optionalInteger(slot, "position", { min: 1, max: 1000 }) ??
          slotIndex + 1,
        slotType: optionalEnum(slot, "slotType", DRIVE_SLOT_TYPES) ?? "generic",
      };
    });
    totalSlots += slots.length;
    return {
      name,
      face,
      layout,
      columns,
      slots,
      sectionIndex,
    };
  });

  if (totalSlots > 500) {
    throw new ValidationError(
      "A drive-bay template may contain at most 500 slots.",
    );
  }

  return sections.map(({ sectionIndex: _sectionIndex, ...section }) => section);
}

function parseDriveBayTemplateRow(
  row: Record<string, unknown>,
): DriveBayTemplate {
  const parsed = parseRow(row, ["deviceTypes", "sections"]) as Record<
    string,
    unknown
  >;
  return {
    id: String(parsed.id),
    name: String(parsed.name),
    description: String(parsed.description ?? ""),
    deviceTypes: Array.isArray(parsed.deviceTypes)
      ? parsed.deviceTypes.map((entry) => String(entry))
      : [],
    sections: normalizeDriveBayTemplateSections(parsed.sections),
    builtIn: false,
  };
}

export function listDriveBayTemplates() {
  const rows = db
    .prepare("SELECT * FROM driveBayTemplates ORDER BY name, id")
    .all() as Record<string, unknown>[];
  return [
    ...BUILT_IN_DRIVE_BAY_TEMPLATES,
    ...rows.map(parseDriveBayTemplateRow),
  ];
}

export function getDriveBayTemplate(id: string) {
  return listDriveBayTemplates().find((template) => template.id === id) ?? null;
}

export function assertTemplateCompatible(
  template: DriveBayTemplate,
  deviceType: string,
) {
  if (!deviceTypeMatches(deviceType, template.deviceTypes)) {
    throw new ValidationError(
      "Selected drive-bay template is not compatible with this device type.",
    );
  }
}

export function createDriveSlotsFromTemplate(
  deviceId: string,
  templateId: string,
) {
  const template = getDriveBayTemplate(templateId);
  if (!template)
    throw new ValidationError("Selected drive-bay template does not exist.");
  const now = new Date().toISOString();
  return template.sections.flatMap((section, sectionOrder) =>
    section.slots.map((slot) => ({
      id: createId("ds"),
      deviceId,
      name: slot.name,
      sectionName: section.name,
      sectionOrder,
      position: slot.position,
      slotType: slot.slotType,
      face: section.face,
      layout: section.layout,
      columns: section.layout === "grid" ? (section.columns ?? 4) : null,
      driveId: null,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

export function insertDriveSlots(
  slots: ReturnType<typeof createDriveSlotsFromTemplate>,
) {
  const insert = db.prepare(`
    INSERT INTO driveSlots
      (id, deviceId, name, sectionName, sectionOrder, position, slotType, face, layout, columns, driveId, createdAt, updatedAt)
    VALUES
      (@id, @deviceId, @name, @sectionName, @sectionOrder, @position, @slotType, @face, @layout, @columns, @driveId, @createdAt, @updatedAt)
  `);
  for (const slot of slots) insert.run(slot);
}
