import type { Device, Rack, Room } from "./types";

export const SUMMARY_FIELDS = [
  "hostname",
  "deviceType",
  "displayName",
  "manufacturer",
  "model",
  "managementIp",
  "macAddress",
  "specs",
  "placement",
  "startU",
] as const;
export type SummaryField = (typeof SUMMARY_FIELDS)[number];
export const DEFAULT_SUMMARY_FIELDS: readonly SummaryField[] =
  SUMMARY_FIELDS.filter((field) => field !== "specs");
export const SUMMARY_LABELS = {
  hostname: "Hostname",
  deviceType: "Device type",
  displayName: "Display name",
  manufacturer: "Manufacturer",
  model: "Model",
  managementIp: "IP",
  macAddress: "MAC",
  specs: "Specs",
  placement: "Placement",
  startU: "Start U",
} as const;

export function parseSummaryFields(
  value: string | null,
): readonly SummaryField[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (Array.isArray(parsed)) {
      const fields = SUMMARY_FIELDS.filter((field) => parsed.includes(field));
      if (fields.length) return fields;
    }
  } catch {
    /* Corrupt or unavailable preferences use the default. */
  }
  return DEFAULT_SUMMARY_FIELDS;
}

export type SummaryDevice = Pick<
  Device,
  | "hostname"
  | "displayName"
  | "manufacturer"
  | "model"
  | "managementIp"
  | "macAddress"
> &
  Partial<Device>;

/** Shelf/virtual children inherit location, but never invent their own start U. */
export function summaryPlacement(
  device: SummaryDevice,
  devices: Device[],
  racks: Rack[],
  rooms: Room[],
) {
  let current = device;
  const seen = new Set<string>();
  while (
    !current.rackId &&
    current.parentDeviceId &&
    !seen.has(current.parentDeviceId)
  ) {
    seen.add(current.parentDeviceId);
    const parent = devices.find((item) => item.id === current.parentDeviceId);
    if (!parent) break;
    current = parent;
  }
  const rack = racks.find((item) => item.id === current.rackId);
  const room = rooms.find(
    (item) => item.id === (rack?.roomId ?? current.roomId),
  );
  return { name: rack?.name ?? room?.name ?? "", startU: device.startU };
}
