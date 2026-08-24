import type { IntegrationDeviceSyncPlan } from "./types.js";

function normalizeName(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isGuestType(deviceType: string) {
  return deviceType === "vm" || deviceType === "container";
}

function creatableHostId(
  plan: IntegrationDeviceSyncPlan,
  hostName: string | null | undefined,
) {
  const name = normalizeName(hostName);
  if (!name) return null;
  const candidates = plan.devices.filter(
    (device) =>
      !isGuestType(device.deviceType) && normalizeName(device.name) === name,
  );
  return candidates.length === 1 && candidates[0].action === "create"
    ? candidates[0].providerRecordId
    : null;
}

export function initialIntegrationSelection(
  plan: IntegrationDeviceSyncPlan,
) {
  return new Set(
    [...plan.devices, ...plan.virtualSwitches, ...plan.ssids]
      .filter((entry) => entry.action === "create")
      .map((entry) => entry.providerRecordId),
  );
}

export function updateIntegrationSelection(
  plan: IntegrationDeviceSyncPlan,
  current: ReadonlySet<string>,
  providerRecordId: string,
  selected: boolean,
) {
  const next = new Set(current);
  const device = plan.devices.find(
    (entry) => entry.providerRecordId === providerRecordId,
  );
  const virtualSwitch = plan.virtualSwitches.find(
    (entry) => entry.providerRecordId === providerRecordId,
  );

  if (selected) {
    next.add(providerRecordId);
    const hostId = creatableHostId(
      plan,
      device && isGuestType(device.deviceType)
        ? device.parentName
        : virtualSwitch?.hostName,
    );
    if (hostId) next.add(hostId);
    return next;
  }

  next.delete(providerRecordId);
  if (device && !isGuestType(device.deviceType)) {
    const hostName = normalizeName(device.name);
    for (const dependent of plan.devices) {
      if (
        isGuestType(dependent.deviceType) &&
        normalizeName(dependent.parentName) === hostName
      ) {
        next.delete(dependent.providerRecordId);
      }
    }
    for (const dependent of plan.virtualSwitches) {
      if (normalizeName(dependent.hostName) === hostName) {
        next.delete(dependent.providerRecordId);
      }
    }
  }
  return next;
}
