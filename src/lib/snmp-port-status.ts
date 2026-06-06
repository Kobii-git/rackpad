import type { DeviceMonitor, Port } from "@/lib/types";

const IF_OPER_STATUS_OID_PREFIX = "1.3.6.1.2.1.2.2.1.8";

export function isSnmpOperStatusMonitor(monitor: DeviceMonitor): boolean {
  if (monitor.type !== "snmp" || !monitor.enabled) return false;
  const oid = monitor.snmpOid?.replace(/^\./, "") ?? "";
  return oid.startsWith(IF_OPER_STATUS_OID_PREFIX);
}

export function buildSnmpVerifiedPortIds(
  monitors: DeviceMonitor[],
  ports: Port[],
): Set<string> {
  const portsByDeviceAndIndex = new Map<string, Port>();
  for (const port of ports) {
    if (port.snmpIfIndex == null) continue;
    portsByDeviceAndIndex.set(`${port.deviceId}:${port.snmpIfIndex}`, port);
  }

  const verified = new Set<string>();
  for (const monitor of monitors) {
    if (!isSnmpOperStatusMonitor(monitor)) continue;
    if (monitor.portId) {
      verified.add(monitor.portId);
      continue;
    }
    if (monitor.snmpIfIndex == null) continue;
    const port = portsByDeviceAndIndex.get(
      `${monitor.deviceId}:${monitor.snmpIfIndex}`,
    );
    if (port) verified.add(port.id);
  }
  return verified;
}

export function buildSnmpVerifiedPortIdsForDevice(
  monitors: DeviceMonitor[],
  deviceId: string,
  ports: Port[],
): Set<string> {
  const devicePorts = ports.filter((port) => port.deviceId === deviceId);
  const deviceMonitors = monitors.filter((monitor) => monitor.deviceId === deviceId);
  return buildSnmpVerifiedPortIds(deviceMonitors, devicePorts);
}
