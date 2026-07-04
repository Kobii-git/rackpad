import type { IpAssignmentPatch } from "./api";
import type { Device, IpAllocationMode, IpAssignment } from "./types";

export interface ManagementAssignmentPatchInput {
  existingAssignment: IpAssignment;
  device: Pick<Device, "id" | "hostname">;
  subnetId: string;
  ipAddress: string;
  allocationMode?: IpAllocationMode;
  dhcpScopeId?: string | null;
}

export function buildManagementAssignmentPatch({
  existingAssignment,
  device,
  subnetId,
  ipAddress,
  allocationMode,
  dhcpScopeId,
}: ManagementAssignmentPatchInput): IpAssignmentPatch | null {
  const patch: IpAssignmentPatch = {};
  const semanticChanged =
    existingAssignment.subnetId !== subnetId ||
    existingAssignment.ipAddress !== ipAddress ||
    existingAssignment.assignmentType !== "device";

  if (existingAssignment.subnetId !== subnetId) patch.subnetId = subnetId;
  if (existingAssignment.ipAddress !== ipAddress) patch.ipAddress = ipAddress;
  if (existingAssignment.assignmentType !== "device") {
    patch.assignmentType = "device";
  }
  if (existingAssignment.deviceId !== device.id) patch.deviceId = device.id;
  if (existingAssignment.hostname !== device.hostname) {
    patch.hostname = device.hostname;
  }
  if (existingAssignment.description == null) patch.description = "Management IP";

  if (semanticChanged || allocationMode !== undefined) {
    patch.allocationMode =
      allocationMode ?? existingAssignment.allocationMode ?? "static";
  }
  if (semanticChanged || dhcpScopeId !== undefined) {
    patch.dhcpScopeId =
      dhcpScopeId !== undefined
        ? (dhcpScopeId ?? null)
        : (existingAssignment.dhcpScopeId ?? null);
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
