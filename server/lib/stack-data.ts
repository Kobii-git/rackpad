import {
  asObject,
  optionalString,
  optionalInteger,
  requiredString,
  requiredEnum,
  ValidationError,
} from "./validation.js";
export const STACK_STATUSES = [
  "online",
  "offline",
  "warning",
  "unknown",
  "maintenance",
  "unmanaged",
] as const;
export interface StackMemberMac {
  label: string;
  macAddress: string;
}
export interface StackMember {
  id: string;
  deviceId: string;
  position: number;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  heightU: number;
  status: (typeof STACK_STATUSES)[number];
  notes: string | null;
  macs: StackMemberMac[];
}
export function parseStackMember(
  body: Record<string, unknown>,
  existing?: StackMember,
) {
  const merged = { ...existing, ...body };
  const name = requiredString(merged, "name", { maxLength: 120 });
  const heightU =
    optionalInteger(merged, "heightU", { min: 1, max: 20 }) ??
    (existing ? null : 1);
  if (heightU === null) throw new ValidationError("Member height is required.");
  const status = requiredEnum(
    { status: "unknown", ...merged },
    "status",
    STACK_STATUSES,
  );
  const rawMacs = merged.macs ?? [];
  if (!Array.isArray(rawMacs) || rawMacs.length > 64)
    throw new ValidationError("macs must be an array with at most 64 entries.");
  const seen = new Set<string>();
  const macs = rawMacs.map((value) => {
    const row = asObject(value);
    const label = requiredString(row, "label", { maxLength: 120 });
    const raw = requiredString(row, "macAddress", { maxLength: 32 });
    if (
      !/^(?:[a-f\d]{12}|(?:[a-f\d]{2}[:-]){5}[a-f\d]{2}|(?:[a-f\d]{4}\.){2}[a-f\d]{4})$/i.test(
        raw,
      )
    )
      throw new ValidationError("Invalid MAC address.");
    const macAddress = raw
      .replace(/[:.-]/g, "")
      .toLowerCase()
      .match(/.{2}/g)!
      .join(":");
    if (seen.has(macAddress))
      throw new ValidationError("Duplicate member MAC address.");
    seen.add(macAddress);
    return { label, macAddress };
  });
  return {
    name,
    heightU,
    status,
    manufacturer:
      optionalString(merged, "manufacturer", { maxLength: 120 }) ?? null,
    model: optionalString(merged, "model", { maxLength: 120 }) ?? null,
    serial: optionalString(merged, "serial", { maxLength: 120 }) ?? null,
    notes: optionalString(merged, "notes", { maxLength: 2000 }) ?? null,
    macs,
  };
}
