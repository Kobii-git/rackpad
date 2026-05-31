import { useMemo } from "react";
import type { DhcpScope, IpAssignment, Subnet } from "@/lib/types";
import { ipToInt, cidrSize } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/Tooltip";

interface IpUtilizationBarProps {
  subnet: Subnet;
  assignments: IpAssignment[];
  scopes?: DhcpScope[];
}

type TechnicalAddressKind = "gateway" | "dns";

interface TechnicalAddress {
  kinds: TechnicalAddressKind[];
  labels: string[];
}

export function IpUtilizationBar({
  subnet,
  assignments,
  scopes = [],
}: IpUtilizationBarProps) {
  const total = cidrSize(subnet.cidr);
  const baseInt = ipToInt(subnet.cidr.split("/")[0]);
  const broadcastInt = baseInt + total - 1;

  const usedMap = useMemo(() => {
    const map = new Map<number, IpAssignment>();
    for (const assignment of assignments) {
      map.set(ipToInt(assignment.ipAddress), assignment);
    }
    return map;
  }, [assignments]);

  const technicalMap = useMemo(() => {
    const map = new Map<number, TechnicalAddress>();
    const addTechnicalAddress = (
      ipAddress: string | undefined,
      kind: TechnicalAddressKind,
      label: string,
    ) => {
      if (!ipAddress) return;
      const ipInt = ipToInt(ipAddress);
      if (ipInt <= baseInt || ipInt >= broadcastInt) return;
      const existing = map.get(ipInt) ?? { kinds: [], labels: [] };
      if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
      if (!existing.labels.includes(label)) existing.labels.push(label);
      map.set(ipInt, existing);
    };

    for (const scope of scopes) {
      addTechnicalAddress(scope.gateway, "gateway", `${scope.name} gateway`);
      for (const dnsServer of scope.dnsServers ?? []) {
        addTechnicalAddress(dnsServer, "dns", `${scope.name} DNS`);
      }
    }

    return map;
  }, [baseInt, broadcastInt, scopes]);

  const used = useMemo(() => {
    const usedAddresses = new Set<number>();
    for (const ipInt of usedMap.keys()) usedAddresses.add(ipInt);
    for (const ipInt of technicalMap.keys()) usedAddresses.add(ipInt);
    return usedAddresses.size;
  }, [technicalMap, usedMap]);
  const pct = Math.round((used / Math.max(1, total - 2)) * 100);
  const showCells = Math.min(total, 256);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
          {subnet.cidr}
        </span>
        <div className="flex items-baseline gap-3 font-mono text-[11px]">
          <span className="text-[var(--text-tertiary)]">
            <span className="text-[var(--text-primary)]">{used}</span>
            <span className="text-[var(--text-muted)]"> / {total - 2}</span>
          </span>
          <span className="text-[var(--accent-primary)]">{pct}%</span>
        </div>
      </div>

      <div
        className="grid w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[linear-gradient(180deg,rgb(255_255_255_/_0.025),transparent_24%),var(--surface-1)] p-1 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(10px, 1fr))",
          gap: 2,
        }}
      >
        {Array.from({ length: showCells }).map((_, index) => {
          const ipInt = baseInt + index;
          const assignment = usedMap.get(ipInt);
          const technical = technicalMap.get(ipInt);
          const isNetwork = index === 0;
          const isBroadcast = ipInt === broadcastInt;

          return (
            <Tooltip key={index}>
              <TooltipTrigger asChild>
                <div
                  className="cursor-pointer rounded-[3px] border border-[rgb(255_255_255_/_0.035)] transition-transform hover:scale-110"
                  style={{
                    aspectRatio: "1 / 1",
                    minHeight: 10,
                    backgroundColor: getCellColor(
                      assignment,
                      technical,
                      isNetwork || isBroadcast,
                    ),
                    opacity:
                      isNetwork || isBroadcast
                        ? 0.4
                        : assignment || technical
                          ? 1
                          : 0.18,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-[11px]">
                  <div className="font-mono">{intToIp(ipInt)}</div>
                  {isNetwork && (
                    <div className="text-[var(--text-tertiary)]">network</div>
                  )}
                  {isBroadcast && (
                    <div className="text-[var(--text-tertiary)]">broadcast</div>
                  )}
                  {assignment && (
                    <>
                      <div className="text-[var(--text-primary)]">
                        {assignment.hostname}
                      </div>
                      <div className="capitalize text-[var(--text-tertiary)]">
                        {assignment.assignmentType}
                      </div>
                    </>
                  )}
                  {technical && (
                    <>
                      <div className="text-[var(--text-primary)]">
                        {technical.labels.join(" / ")}
                      </div>
                      <div className="text-[var(--text-tertiary)]">
                        reserved by DHCP scope
                      </div>
                    </>
                  )}
                  {!assignment && !technical && !isNetwork && !isBroadcast && (
                    <div className="text-[var(--text-tertiary)]">free</div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] text-[var(--text-tertiary)]">
        <Legend color="var(--accent-secondary)" label="Device" />
        <Legend color="var(--accent-primary)" label="VM" />
        <Legend color="var(--info)" label="Container" />
        <Legend color="var(--warning)" label="Reserved" />
        <Legend color="var(--warning)" label="Gateway/DNS" />
        <Legend color="var(--text-muted)" label="Free" muted />
      </div>
    </div>
  );
}

function getCellColor(
  assignment?: IpAssignment,
  technical?: TechnicalAddress,
  edge?: boolean,
): string {
  if (edge) return "var(--text-muted)";
  if (!assignment && technical) return "var(--warning)";
  if (!assignment) return "var(--surface-4)";
  switch (assignment.assignmentType) {
    case "device":
      return "var(--accent-secondary)";
    case "interface":
      return "var(--accent-secondary-hover)";
    case "vm":
      return "var(--accent-primary)";
    case "container":
      return "var(--info)";
    case "reserved":
      return "var(--warning)";
    case "infrastructure":
      return "var(--accent-primary-active)";
    default:
      return "var(--surface-4)";
  }
}

function Legend({
  color,
  label,
  muted,
}: {
  color: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="size-2 rounded-[2px]"
        style={{ backgroundColor: color, opacity: muted ? 0.3 : 1 }}
      />
      <span>{label}</span>
    </span>
  );
}

function intToIp(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join(".");
}
