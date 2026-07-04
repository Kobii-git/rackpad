import type { Device, Port } from "./types";
import { parsePortSpeedMbps } from "./utils";

export interface NetworkCapacitySummary {
  capacityMbps: number;
  linkedCapacityMbps: number;
}

function highestPortSpeedMbps(ports: Port[]) {
  return ports.reduce(
    (highest, port) => Math.max(highest, parsePortSpeedMbps(port.speed) ?? 0),
    0,
  );
}

export function summarizeNetworkCapacity(
  ports: Port[],
  devices: Device[],
): NetworkCapacitySummary {
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const passivePairs = new Map<string, Port[]>();
  let capacityMbps = 0;
  let linkedCapacityMbps = 0;

  for (const port of ports) {
    const device = deviceById.get(port.deviceId);
    if (device?.deviceType === "patch_panel") {
      const pairKey = `${port.deviceId}:${port.position}`;
      passivePairs.set(pairKey, [...(passivePairs.get(pairKey) ?? []), port]);
      continue;
    }

    const speedMbps = parsePortSpeedMbps(port.speed) ?? 0;
    capacityMbps += speedMbps;
    if (port.linkState === "up") linkedCapacityMbps += speedMbps;
  }

  for (const pairPorts of passivePairs.values()) {
    capacityMbps += highestPortSpeedMbps(pairPorts);
    const upPorts = pairPorts.filter((port) => port.linkState === "up");
    if (upPorts.length >= 2) {
      linkedCapacityMbps += highestPortSpeedMbps(upPorts);
    }
  }

  return { capacityMbps, linkedCapacityMbps };
}
