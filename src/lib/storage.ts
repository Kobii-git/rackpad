import type {
  DriveBayTemplate,
  DriveBayTemplateSlot,
  DriveBayTemplateSection,
  DriveSlot,
  DriveSlotFace,
  DriveSlotLayout,
  DriveSlotType,
  StorageDrive,
  StoragePool,
  StoragePoolStatus,
} from "./types";
import type { TranslationKey } from "@/i18n/translations";

type StorageTranslate = (
  key: TranslationKey,
  values?: Record<string, string | number | null | undefined>,
) => string;

export const DRIVE_INTERFACE_OPTIONS = [
  "sata",
  "sas",
  "nvme",
  "usb",
  "other",
] as const;
export const DRIVE_FORM_FACTOR_OPTIONS = [
  "2.5",
  "3.5",
  "m2",
  "u2",
  "other",
] as const;
export const DRIVE_SLOT_TYPE_OPTIONS = [
  "2.5",
  "3.5",
  "m2",
  "u2",
  "generic",
] as const;
export const STORAGE_POOL_TYPE_OPTIONS = [
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
export const STORAGE_POOL_STATUS_OPTIONS = [
  "healthy",
  "degraded",
  "rebuilding",
  "offline",
  "unknown",
] as const;

const POOL_COLORS = [
  "#22d3ee",
  "#a78bfa",
  "#f59e0b",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#e879f9",
  "#f97316",
] as const;

export function driveLabel(drive: StorageDrive) {
  const model = [drive.manufacturer, drive.model].filter(Boolean).join(" ");
  return model || drive.serial || `Drive ${drive.id.slice(-6)}`;
}

export function driveSecondaryLabel(drive: StorageDrive) {
  return [
    drive.serial,
    formatStorageCapacity(drive.capacityGb),
    drive.interface.toUpperCase(),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatStorageCapacity(capacityGb: number) {
  if (!Number.isFinite(capacityGb)) return "—";
  if (capacityGb >= 1000) {
    const tb = capacityGb / 1000;
    return `${Number.isInteger(tb) ? tb.toFixed(0) : tb.toFixed(tb >= 10 ? 1 : 2)} TB`;
  }
  return `${Number.isInteger(capacityGb) ? capacityGb.toFixed(0) : capacityGb.toFixed(1)} GB`;
}

export function poolTypeLabel(
  type: StoragePool["poolType"],
  t?: StorageTranslate,
) {
  const labels: Record<StoragePool["poolType"], string> = {
    raid0: "RAID 0",
    raid1: "RAID 1",
    raid5: "RAID 5",
    raid6: "RAID 6",
    raid10: "RAID 10",
    raidz1: "ZFS RAIDZ1",
    raidz2: "ZFS RAIDZ2",
    raidz3: "ZFS RAIDZ3",
    mirror: "Mirror",
    unraid: "unRAID",
    jbod: "JBOD",
    other: "Other",
  };
  const label = labels[type];
  if (t && type === "mirror") return t("Mirror");
  if (t && type === "other") return t("Other");
  return label;
}

const STORAGE_POOL_STATUS_LABELS: Record<StoragePoolStatus, TranslationKey> = {
  healthy: "Healthy",
  degraded: "Degraded",
  rebuilding: "Rebuilding",
  offline: "Offline",
  unknown: "Unknown",
};

export function storagePoolStatusLabel(
  status: StoragePoolStatus,
  t: StorageTranslate,
) {
  return t(STORAGE_POOL_STATUS_LABELS[status]);
}

export function driveSlotTypeLabel(
  slotType: DriveSlotType,
  t: StorageTranslate,
) {
  switch (slotType) {
    case "m2":
      return "M.2";
    case "u2":
      return "U.2";
    case "2.5":
    case "3.5":
      return `${slotType}\"`;
    case "generic":
      return t("Other");
  }
}

const BUILT_IN_TEMPLATE_DISPLAY = {
  "storage-4x3-5": { count: 4, formFactor: "3.5-inch", face: "Front" },
  "storage-8x3-5": { count: 8, formFactor: "3.5-inch", face: "Front" },
  "storage-12x3-5": { count: 12, formFactor: "3.5-inch", face: "Front" },
  "storage-24x2-5": { count: 24, formFactor: "2.5-inch", face: "Front" },
  "storage-2xm2": { count: 2, formFactor: "M.2", face: "Internal" },
} as const satisfies Record<
  string,
  { count: number; formFactor: string; face: "Front" | "Internal" }
>;

export function driveBayTemplateDisplayCopy(
  template: DriveBayTemplate,
  t: StorageTranslate,
) {
  const display =
    BUILT_IN_TEMPLATE_DISPLAY[
      template.id as keyof typeof BUILT_IN_TEMPLATE_DISPLAY
    ];
  if (!template.builtIn || !display) {
    return { name: template.name, description: template.description };
  }
  const specification = `${display.count} × ${display.formFactor}`;
  return {
    name: t("{value1}{value2}", {
      value1: `${specification} `,
      value2: t("Drive bays"),
    }),
    description: t("{value1}{value2}", {
      value1: `${specification} · `,
      value2: t(display.face),
    }),
  };
}

export function poolColor(poolId: string) {
  let hash = 0;
  for (const character of poolId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return POOL_COLORS[hash % POOL_COLORS.length];
}

export function summarizeStorage(
  drives: StorageDrive[],
  slots: DriveSlot[],
  pools: StoragePool[],
  poolMemberDrives: StorageDrive[] = drives,
) {
  const occupiedDriveIds = new Set(
    slots.map((slot) => slot.driveId).filter((id): id is string => Boolean(id)),
  );
  const driveById = new Map(drives.map((drive) => [drive.id, drive]));
  const poolDriveById = new Map(
    poolMemberDrives.map((drive) => [drive.id, drive]),
  );
  const rawCapacityGb = [...occupiedDriveIds].reduce(
    (sum, driveId) => sum + (driveById.get(driveId)?.capacityGb ?? 0),
    0,
  );
  const usableCapacityGb = pools.reduce(
    (sum, pool) => sum + pool.usableCapacityGb,
    0,
  );
  const missingPoolMemberIds = pools.flatMap((pool) =>
    pool.driveIds.filter((driveId) => !poolDriveById.get(driveId)?.slotId),
  );
  return {
    occupiedSlots: occupiedDriveIds.size,
    totalSlots: slots.length,
    unassignedDrives: drives.filter((drive) => !drive.slotId).length,
    rawCapacityGb,
    usableCapacityGb,
    unhealthyPools: pools.filter(
      (pool) => pool.status === "degraded" || pool.status === "offline",
    ).length,
    missingPoolMemberIds: [...new Set(missingPoolMemberIds)],
  };
}

export function isPoolDriveEligible(
  drive: StorageDrive,
  poolId?: string | null,
) {
  return Boolean(drive.slotId) && (!drive.poolId || drive.poolId === poolId);
}

export function generateDriveBaySection(input: {
  name: string;
  count: number;
  columns: number;
  slotType: DriveSlotType;
  prefix?: string;
}): DriveBayTemplateSection {
  const count = Math.max(1, Math.min(500, Math.floor(input.count)));
  const columns = Math.max(1, Math.min(24, Math.floor(input.columns)));
  return {
    name: input.name.trim() || "Drive bays",
    face: "front",
    layout: "grid",
    columns,
    slots: Array.from({ length: count }, (_, index) => ({
      name: `${input.prefix ?? "Bay "}${index + 1}`,
      position: index + 1,
      slotType: input.slotType,
    })),
  };
}

export function inferDriveBaySlotPrefix(slots: DriveBayTemplateSlot[]) {
  if (slots.length === 0) return null;
  const matches = slots.map((slot) => slot.name.match(/^(.*?)(\d+)$/));
  const prefix = matches[0]?.[1];
  if (
    prefix === undefined ||
    matches.some(
      (match, index) =>
        !match || match[1] !== prefix || Number(match[2]) !== index + 1,
    )
  ) {
    return null;
  }
  return prefix;
}

export function uniformDriveBaySlotType(slots: DriveBayTemplateSlot[]) {
  const first = slots[0]?.slotType;
  if (!first || slots.some((slot) => slot.slotType !== first)) return null;
  return first;
}

export function resizeDriveBaySlots(
  slots: DriveBayTemplateSlot[],
  count: number,
  defaults: { prefix: string; slotType: DriveSlotType },
) {
  const nextCount = Math.max(1, Math.min(500, Math.floor(count)));
  const preserved = slots.slice(0, nextCount).map((slot) => ({ ...slot }));
  const highestPosition = slots.reduce(
    (highest, slot) => Math.max(highest, slot.position),
    0,
  );
  while (preserved.length < nextCount) {
    const appendedIndex = preserved.length - slots.length + 1;
    preserved.push({
      name: `${defaults.prefix}${preserved.length + 1}`,
      position: highestPosition + appendedIndex,
      slotType: defaults.slotType,
    });
  }
  return preserved;
}

export function renameDriveBaySlots(
  slots: DriveBayTemplateSlot[],
  prefix: string,
) {
  return slots.map((slot, index) => ({
    ...slot,
    name: `${prefix}${index + 1}`,
  }));
}

export function setDriveBaySlotType(
  slots: DriveBayTemplateSlot[],
  slotType: DriveSlotType,
) {
  return slots.map((slot) => ({ ...slot, slotType }));
}

export function serializeDriveBayTemplateSection(input: {
  name: string;
  face: DriveSlotFace;
  layout: DriveSlotLayout;
  columns: number | null;
  slots: DriveBayTemplateSlot[];
}): DriveBayTemplateSection {
  return {
    name: input.name,
    face: input.face,
    layout: input.layout,
    columns: input.columns,
    slots: input.slots.map((slot) => ({ ...slot })),
  };
}
