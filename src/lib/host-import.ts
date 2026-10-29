import type { Device, DhcpScope, IpAssignment, IpZone, Port, Subnet } from "./types";
import { canonicalMacAddress } from "./network-labels";
import { cidrBounds, cidrContainsIp, ipToInt } from "./utils";

export interface HostNetworkAdapter {
  name?: string;
  interfaceDescription?: string;
  macAddress?: string;
  status?: string;
  linkSpeed?: string;
  ipAddresses?: string[];
}

export function collectedHostIps(ips: unknown, adapters: HostNetworkAdapter[]) {
  const values: unknown[] = [
    ...(Array.isArray(ips) ? ips : []),
    ...adapters.flatMap((adapter) =>
      Array.isArray(adapter.ipAddresses) ? adapter.ipAddresses : [],
    ),
  ];
  return [
    ...new Set(
      values
        .filter((ip): ip is string => typeof ip === "string")
        .map((ip) => ip.trim())
        .filter(
          (ip) =>
            /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
            ip.split(".").every((part) => Number(part) <= 255) &&
            !/^(?:0|127|169\.254)\./.test(ip) &&
            ip !== "255.255.255.255",
        ),
    ),
  ].sort((a, b) => ipToInt(a) - ipToInt(b));
}

export function hostIpProblem(
  ip: string,
  subnets: Subnet[],
  assignments: IpAssignment[],
  deviceId?: string,
  scopes: DhcpScope[] = [],
  zones: IpZone[] = [],
) {
  if (!collectedHostIps([ip], []).includes(ip)) return "invalid" as const;
  const subnet = subnets.find((subnet) => {
    try {
      const { network, broadcast } = cidrBounds(subnet.cidr);
      const value = ipToInt(ip);
      return (
        subnet.integrity.state === "ok" &&
        cidrContainsIp(subnet.cidr, ip) &&
        value > network &&
        value < broadcast
      );
    } catch {
      return false;
    }
  });
  if (!subnet) return "subnet" as const;
  const subnetScopes = scopes.filter(scope => scope.subnetId === subnet.id);
  if ([subnet, ...subnetScopes].some(network => network.gateway === ip || network.dnsServers?.includes(ip)) ||
      assignments.some(assignment => assignment.subnetId === subnet.id && assignment.ipAddress === ip &&
        (assignment.assignmentType === "reserved" || assignment.assignmentType === "infrastructure")))
    return "reserved" as const;
  if (
    assignments.some(
      (assignment) =>
        assignment.subnetId === subnet.id &&
        assignment.ipAddress === ip &&
        (!deviceId || assignment.deviceId !== deviceId),
    )
  )
    return "conflict" as const;
  const value = ipToInt(ip);
  const contains = (range: { startIp: string; endIp: string }) => value >= ipToInt(range.startIp) && value <= ipToInt(range.endIp);
  const subnetZones = zones.filter(zone => zone.subnetId === subnet.id);
  const containingZones = subnetZones.filter(contains);
  if (subnetScopes.some(contains) && !containingZones.some(zone => zone.kind === "static") &&
      (subnetZones.some(zone => zone.kind === "dhcp") || containingZones.length > 0) &&
      !containingZones.some(zone => zone.kind === "dhcp"))
    return "allocation" as const;
  return null;
}

export function defaultHostIp(
  candidates: string[],
  subnets: Subnet[],
  assignments: IpAssignment[],
  existing?: Device | null,
  scopes: DhcpScope[] = [],
  zones: IpZone[] = [],
) {
  if (existing?.managementIp) return existing.managementIp;
  const eligible = candidates.filter(
    (ip) => !hostIpProblem(ip, subnets, assignments, existing?.id, scopes, zones),
  );
  return eligible.length === 1 ? eligible[0] : "";
}

export function planHostAdapters(
  adapters: HostNetworkAdapter[],
  ports: Port[],
  switchNames: string[],
) {
  const names = adapters.map((adapter) =>
    typeof adapter.name === "string" ? adapter.name.trim().toLowerCase() : "",
  );
  return adapters.map((adapter, index) => {
    const name = typeof adapter.name === "string" ? adapter.name.trim() : "";
    const key = name.toLowerCase();
    const matches = ports.filter(
      (port) => port.name.trim().toLowerCase() === key,
    );
    const existing = matches[0];
    const mac = canonicalMacAddress(adapter.macAddress);
    const oldMac = canonicalMacAddress(existing?.macAddress);
    const problem =
      !name || name.length > 120 || (adapter.macAddress && !mac)
        ? ("invalid" as const)
        : names.filter((item) => item === key).length > 1 ||
            matches.length > 1 ||
            (mac && oldMac && mac !== oldMac)
          ? ("conflict" as const)
          : null;
    const state = adapter.status?.trim().toLowerCase();
    return {
      index,
      name,
      existing,
      problem,
      changes: {
        name,
        kind:
          existing?.kind ??
          (switchNames.some((item) => item.toLowerCase() === key)
            ? ("virtual" as const)
            : ("other" as const)),
        ...(mac ? { macAddress: mac } : {}),
        ...(adapter.linkSpeed?.trim()
          ? { speed: adapter.linkSpeed.trim() }
          : {}),
        linkState:
          state === "up" || state === "connected"
            ? ("up" as const)
            : state === "down" || state === "disconnected"
              ? ("down" as const)
              : (existing?.linkState ?? ("unknown" as const)),
      },
    };
  });
}
