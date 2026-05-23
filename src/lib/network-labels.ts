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
