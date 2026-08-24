import type { Device } from "./types";

export function formatDeviceAddress(
  device: Pick<Device, "managementIp" | "macAddress">,
  fallback = "",
) {
  const ip = device.managementIp?.trim();
  const mac = device.macAddress?.trim();
  if (ip && mac) return `${ip} | ${mac}`;
  return ip || mac || fallback;
}

export function formatDeviceMac(device: Pick<Device, "macAddress">) {
  return device.macAddress?.trim() || "";
}

export function canonicalMacAddress(value?: string | null) {
  if (!value) return null;
  const compact = value
    .trim()
    .replace(/[:.\-\s]/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(compact)) return null;
  return compact.match(/.{2}/g)?.join(":") ?? null;
}

export function matchesMacAwareSearch(haystack: string, query: string) {
  const canonicalQuery = canonicalMacAddress(query);
  if (canonicalQuery && haystack.includes(canonicalQuery)) return true;
  return haystack.includes(query);
}
