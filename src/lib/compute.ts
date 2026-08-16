import { deviceTypeBase, deviceTypeChainIncludes } from "@/lib/device-types";
import type { Device, DeviceTypeDefinition } from "@/lib/types";

const HOST_DEVICE_TYPES = new Set(["server", "storage", "kvm", "other"]);
const VIRTUAL_DEVICE_TYPES = new Set(["vm", "container"]);
const EXCLUDED_HOST_DEVICE_TYPES = new Set(["storage_enclosure"]);

export function selectComputeInventory(
  devices: Device[],
  deviceTypes: DeviceTypeDefinition[],
) {
  const workloads = devices
    .filter((device) => {
      const baseType = deviceTypeBase(device.deviceType, deviceTypes);
      return VIRTUAL_DEVICE_TYPES.has(baseType) || device.placement === "virtual";
    })
    .sort((left, right) => left.hostname.localeCompare(right.hostname));
  const workloadHostIds = new Set(
    workloads
      .map((device) => device.parentDeviceId)
      .filter((value): value is string => Boolean(value)),
  );
  const hosts = devices
    .filter((device) => {
      const baseType = deviceTypeBase(device.deviceType, deviceTypes);
      const excluded = [...EXCLUDED_HOST_DEVICE_TYPES].some((type) =>
        deviceTypeChainIncludes(device.deviceType, type, deviceTypes),
      );
      return (
        !VIRTUAL_DEVICE_TYPES.has(baseType) &&
        !excluded &&
        (workloadHostIds.has(device.id) || HOST_DEVICE_TYPES.has(baseType))
      );
    })
    .sort((left, right) => left.hostname.localeCompare(right.hostname));
  const hostIds = new Set(hosts.map((host) => host.id));
  const guestsByHostId = workloads.reduce<Record<string, Device[]>>(
    (result, workload) => {
      if (workload.parentDeviceId) {
        (result[workload.parentDeviceId] ??= []).push(workload);
      }
      return result;
    },
    {},
  );
  const unassignedWorkloads = workloads.filter(
    (workload) =>
      !workload.parentDeviceId || !hostIds.has(workload.parentDeviceId),
  );
  return { hosts, workloads, guestsByHostId, unassignedWorkloads };
}
