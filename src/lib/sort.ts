export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

export function toggleSort<K extends string>(
  current: SortState<K>,
  key: K,
): SortState<K> {
  return current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: "asc" };
}

export function applySortDirection(
  value: number,
  direction: SortDirection,
) {
  return direction === "asc" ? value : -value;
}

export function compareText(a?: string | null, b?: string | null) {
  const left = a?.trim();
  const right = b?.trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function compareNumber(a?: number | null, b?: number | null) {
  if (a == null && b == null) return 0;
  if (a == null || Number.isNaN(a)) return 1;
  if (b == null || Number.isNaN(b)) return -1;
  return a - b;
}

export function compareDate(a?: string | null, b?: string | null) {
  const left = a ? Date.parse(a) : Number.NaN;
  const right = b ? Date.parse(b) : Number.NaN;
  if (Number.isNaN(left) && Number.isNaN(right)) return compareText(a, b);
  if (Number.isNaN(left)) return 1;
  if (Number.isNaN(right)) return -1;
  return left - right;
}

export function compareIp(a?: string | null, b?: string | null) {
  const left = parseIpv4(a);
  const right = parseIpv4(b);
  if (!left && !right) return compareText(a, b);
  if (!left) return 1;
  if (!right) return -1;

  for (let index = 0; index < left.length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function compareLength(a?: string | null, b?: string | null) {
  const left = parseLength(a);
  const right = parseLength(b);
  if (left == null && right == null) return compareText(a, b);
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function parseIpv4(value?: string | null) {
  const parts = value?.trim().split(".").map(Number);
  if (
    !parts ||
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts;
}

function parseLength(value?: string | null) {
  const match = value?.trim().toLowerCase().match(/^([0-9]+(?:\.[0-9]+)?)\s*(m|cm|mm|ft)?$/);
  if (!match) return null;
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount)) return null;
  const unit = match[2] ?? "m";
  if (unit === "mm") return amount / 1000;
  if (unit === "cm") return amount / 100;
  if (unit === "ft") return amount * 0.3048;
  return amount;
}
