import type { Device, IpAssignment } from "./types";

export type DeviceIpAssignmentIndex = Map<string, IpAssignment[]>;

export interface DeviceIpMismatch {
  device: Device;
  assignments: IpAssignment[];
}

export function indexValidDeviceIpAssignments(
  assignments: IpAssignment[],
): DeviceIpAssignmentIndex {
  const index: DeviceIpAssignmentIndex = new Map();

  for (const assignment of assignments) {
    if (
      !assignment.deviceId ||
      (assignment.integrity && assignment.integrity.state !== "ok")
    ) {
      continue;
    }
    const entries = index.get(assignment.deviceId) ?? [];
    entries.push(assignment);
    index.set(assignment.deviceId, entries);
  }

  for (const entries of index.values()) {
    entries.sort((a, b) =>
      a.ipAddress.localeCompare(b.ipAddress, undefined, { numeric: true }),
    );
  }

  return index;
}

export function deviceLevelIpAssignments(
  assignments: IpAssignment[] | undefined,
) {
  return (assignments ?? []).filter(
    (assignment) =>
      assignment.assignmentType === "device" && !assignment.portId,
  );
}

export function hasManagementIpMismatch(
  device: Device,
  assignments: IpAssignment[] | undefined,
) {
  const managementIp = device.managementIp?.trim();
  const deviceAssignments = deviceLevelIpAssignments(assignments);
  return Boolean(
    managementIp &&
    deviceAssignments.length > 0 &&
    !deviceAssignments.some(
      (assignment) => assignment.ipAddress.trim() === managementIp,
    ),
  );
}

export function findManagementIpMismatches(
  devices: Device[],
  assignmentsByDeviceId: DeviceIpAssignmentIndex,
): DeviceIpMismatch[] {
  return devices
    .filter((device) =>
      hasManagementIpMismatch(device, assignmentsByDeviceId.get(device.id)),
    )
    .map((device) => ({
      device,
      assignments: deviceLevelIpAssignments(
        assignmentsByDeviceId.get(device.id),
      ),
    }))
    .sort((a, b) => a.device.hostname.localeCompare(b.device.hostname));
}

export function matchingAssignedIps(
  assignments: IpAssignment[] | undefined,
  query: string,
  managementIp?: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  return [
    ...new Set(
      (assignments ?? [])
        .map((assignment) => assignment.ipAddress.trim())
        .filter(
          (ipAddress) =>
            ipAddress !== managementIp?.trim() &&
            ipAddress.toLowerCase().includes(normalizedQuery),
        ),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
