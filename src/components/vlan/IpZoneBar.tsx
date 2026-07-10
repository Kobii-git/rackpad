import { useI18n } from "@/i18n";
import { useMemo } from "react";
import type { DhcpScope, IpAssignment, IpZone, Subnet } from "@/lib/types";
import { cidrBounds, ipToInt } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { Mono } from "@/components/shared/Mono";

interface IpZoneBarProps {
  subnet: Subnet;
  zones: IpZone[];
  scopes: DhcpScope[];
  assignments?: IpAssignment[];
}

const ZONE_COLOR: Record<IpZone["kind"], string> = {
  static: "var(--accent-secondary)",
  dhcp: "var(--accent-primary)",
  reserved: "var(--warning)",
  infrastructure: "var(--info)",
};

const ZONE_LABEL: Record<IpZone["kind"], string> = {
  static: "Static",
  dhcp: "DHCP",
  reserved: "Reserved",
  infrastructure: "Infrastructure",
};

type ZoneEntry = IpZone & { derived?: boolean };

export function IpZoneBar({
  subnet,
  zones,
  scopes,
  assignments = [],
}: IpZoneBarProps) {
  const { t } = useI18n();
  const { network: baseInt, size: total } = cidrBounds(subnet.cidr);

  const combined = useMemo(() => {
    const explicit: ZoneEntry[] = [...zones];
    const hasDhcp = zones.some((zone) => zone.kind === "dhcp");
    if (!hasDhcp) {
      for (const scope of scopes) {
        explicit.push({
          id: `derived_${scope.id}`,
          subnetId: subnet.id,
          kind: "dhcp",
          startIp: scope.startIp,
          endIp: scope.endIp,
          description: scope.name,
          derived: true,
        });
      }
    }
    return explicit.sort((a, b) => ipToInt(a.startIp) - ipToInt(b.startIp));
  }, [zones, scopes, subnet]);

  const assignmentInts = useMemo(
    () => assignments.map((assignment) => ipToInt(assignment.ipAddress)),
    [assignments],
  );

  if (combined.length === 0) {
    return (
      <div className="text-[11px] text-[var(--text-tertiary)]">
        {t("No zones documented for this subnet.")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative flex h-7 w-full overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[linear-gradient(180deg,rgb(255_255_255_/_0.025),transparent_34%),var(--surface-1)]">
        {combined.map((zone) => {
          const startN = ipToInt(zone.startIp) - baseInt;
          const endN = ipToInt(zone.endIp) - baseInt;
          const left = (startN / total) * 100;
          const width = ((endN - startN + 1) / total) * 100;
          const color = ZONE_COLOR[zone.kind];
          const size = endN - startN + 1;
          const assigned = countAssignedInRange(
            assignmentInts,
            startN,
            endN,
            baseInt,
          );
          const pct = Math.round((assigned / Math.max(1, size)) * 100);
          const usageLabel =
            zone.kind === "dhcp"
              ? `${assigned}/${size} used | ${pct}%`
              : `${size} addresses`;

          return (
            <Tooltip key={zone.id}>
              <TooltipTrigger asChild>
                <button
                  className="absolute top-0 h-full cursor-default transition-all hover:brightness-110"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: `linear-gradient(180deg, rgb(255 255 255 / 0.06), transparent 44%), ${color}26`,
                    borderLeft: `1px solid ${color}70`,
                    borderRight: `1px solid ${color}70`,
                  }}
                >
                  {width > 4 && (
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.14em]"
                      style={{ color }}
                    >
                      {ZONE_LABEL[zone.kind]}
                      {zone.kind === "dhcp" ? t("{pct}%", { pct: pct }) : ""}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-0.5 text-[11px]">
                  <div className="font-medium" style={{ color }}>
                    {ZONE_LABEL[zone.kind]}
                  </div>
                  <Mono className="text-[var(--text-tertiary)]">
                    {t("{startIp} -> {endIp}", {
                      startIp: zone.startIp,
                      endIp: zone.endIp,
                    })}
                  </Mono>
                  <div className="text-[var(--text-tertiary)]">
                    {usageLabel}
                  </div>
                  {zone.description && (
                    <div className="text-[var(--text-muted)]">
                      {zone.description}
                      {zone.derived ? t("(derived from DHCP scope)") : ""}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex justify-between px-0.5 font-mono text-[9px] text-[var(--text-muted)]">
        <Mono>{subnet.cidr.split("/")[0]}</Mono>
        <span>•</span>
        <Mono>.{(total - 1) & 0xff}</Mono>
      </div>

      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-[var(--text-tertiary)]">
        {(["static", "dhcp", "reserved", "infrastructure"] as const).map(
          (kind) => {
            const has = combined.some((zone) => zone.kind === kind);
            if (!has) return null;
            const count = combined.filter((zone) => zone.kind === kind).length;
            return (
              <span key={kind} className="inline-flex items-center gap-1.5">
                <span
                  className="size-2 rounded-[2px]"
                  style={{ backgroundColor: ZONE_COLOR[kind] }}
                />
                <span>
                  {ZONE_LABEL[kind]}{" "}
                  {count > 1 && t("({count})", { count: count })}
                </span>
              </span>
            );
          },
        )}
      </div>

      {combined.some((zone) => zone.kind === "dhcp") && (
        <div className="flex flex-wrap gap-2">
          {combined
            .filter((zone) => zone.kind === "dhcp")
            .map((zone) => {
              const startN = ipToInt(zone.startIp) - baseInt;
              const endN = ipToInt(zone.endIp) - baseInt;
              const size = endN - startN + 1;
              const assigned = countAssignedInRange(
                assignmentInts,
                startN,
                endN,
                baseInt,
              );
              const pct = Math.round((assigned / Math.max(1, size)) * 100);
              return (
                <span
                  key={`${zone.id}:summary`}
                  className="rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[var(--surface-1)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)]"
                >
                  {zone.description ?? t("DHCP")} {assigned}/{size} ({pct}%)
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}

function countAssignedInRange(
  assignmentInts: number[],
  startOffset: number,
  endOffset: number,
  baseInt: number,
) {
  const start = baseInt + startOffset;
  const end = baseInt + endOffset;
  return assignmentInts.filter((ip) => ip >= start && ip <= end).length;
}
