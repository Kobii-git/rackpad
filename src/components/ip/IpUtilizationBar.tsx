import { useI18n } from "@/i18n";
import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import type { DhcpScope, IpAssignment, Subnet } from "@/lib/types";
import { cidrBounds, intToIp, ipToInt } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
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

const EMPTY_SCOPES: DhcpScope[] = [];

export function IpUtilizationBar(props: IpUtilizationBarProps) {
  const { id, cidr, gateway } = props.subnet;
  return (
    <IpUtilizationGrid key={`${id}:${cidr}:${gateway ?? ""}`} {...props} />
  );
}

function IpUtilizationGrid({
  subnet,
  assignments,
  scopes = EMPTY_SCOPES,
}: IpUtilizationBarProps) {
  const { t } = useI18n();
  const detailsId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [openIp, setOpenIp] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const {
    network: baseInt,
    broadcast: broadcastInt,
    size: total,
  } = cidrBounds(subnet.cidr);
  const hasNetworkAndBroadcast = total > 2;
  const firstHost = hasNetworkAndBroadcast ? baseInt + 1 : baseInt;
  const lastHost = hasNetworkAndBroadcast ? broadcastInt - 1 : broadcastInt;
  const hostCount = lastHost - firstHost + 1;
  const gatewayInt = subnet.gateway ? ipToInt(subnet.gateway) : null;
  const subnetGateway =
    gatewayInt !== null && gatewayInt >= firstHost && gatewayInt <= lastHost
      ? gatewayInt
      : null;

  const usedMap = useMemo(() => {
    const map = new Map<number, IpAssignment>();
    for (const assignment of assignments) {
      map.set(ipToInt(assignment.ipAddress), assignment);
    }
    return map;
  }, [assignments]);

  const technicalMap = useMemo(() => {
    const map = new Map<number, Set<string>>();
    const addTechnicalAddress = (
      ipAddress: string | undefined,
      label: string,
    ) => {
      if (!ipAddress) return;
      const ipInt = ipToInt(ipAddress);
      if (ipInt < firstHost || ipInt > lastHost) return;
      const labels = map.get(ipInt) ?? new Set<string>();
      labels.add(label);
      map.set(ipInt, labels);
    };

    for (const scope of scopes) {
      addTechnicalAddress(scope.gateway, `${scope.name} gateway`);
      for (const dnsServer of scope.dnsServers ?? []) {
        addTechnicalAddress(dnsServer, `${scope.name} DNS`);
      }
    }

    return map;
  }, [firstHost, lastHost, scopes]);

  const used = useMemo(() => {
    const usedAddresses = new Set<number>();
    for (const ipInt of usedMap.keys()) usedAddresses.add(ipInt);
    for (const ipInt of technicalMap.keys()) usedAddresses.add(ipInt);
    if (subnetGateway !== null) usedAddresses.add(subnetGateway);
    return usedAddresses.size;
  }, [subnetGateway, technicalMap, usedMap]);
  const pct = Math.round((used / hostCount) * 100);
  const addresses = Array.from(
    { length: Math.min(total, 256) },
    (_, index) => baseInt + index,
  );
  if (subnetGateway !== null && subnetGateway >= baseInt + addresses.length) {
    addresses.push(subnetGateway);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
          {subnet.cidr}
        </span>
        <div className="flex items-baseline gap-3 font-mono text-[11px]">
          <span className="text-[var(--text-tertiary)]">
            <span className="text-[var(--text-primary)]">{used}</span>
            <span className="text-[var(--text-muted)]"> / {hostCount}</span>
          </span>
          <span className="text-[var(--accent-primary)]">{pct}%</span>
        </div>
      </div>

      <div
        ref={gridRef}
        role="group"
        aria-label={t("Address utilization")}
        className="grid w-full grid-cols-[repeat(auto-fit,minmax(10px,1fr))] gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[linear-gradient(180deg,rgb(255_255_255_/_0.025),transparent_24%),var(--surface-1)] p-1 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)] pointer-coarse:grid-cols-[repeat(auto-fit,minmax(24px,1fr))]"
      >
        {addresses.map((ipInt, index) => {
          const address = intToIp(ipInt);
          const assignment = usedMap.get(ipInt);
          const scopeLabels = technicalMap.get(ipInt);
          const isGateway = ipInt === subnetGateway;
          const isTechnical = isGateway || Boolean(scopeLabels);
          const isNetwork = hasNetworkAndBroadcast && ipInt === baseInt;
          const isBroadcast = hasNetworkAndBroadcast && ipInt === broadcastInt;
          const isEdge = isNetwork || isBroadcast;
          const open = openIp === ipInt;
          const cellDetailsId = `${detailsId}-${ipInt}`;
          const details = (
            <div className="text-[11px]">
              {isNetwork && <div>{t("network")}</div>}
              {isBroadcast && <div>{t("broadcast")}</div>}
              {assignment && (
                <>
                  <div>{assignment.hostname}</div>
                  <div className="capitalize">{assignment.assignmentType}</div>
                </>
              )}
              {isGateway && <div>{t("Gateway")}</div>}
              {scopeLabels && (
                <>
                  <div>{Array.from(scopeLabels).join(" / ")}</div>
                  <div>{t("reserved by DHCP scope")}</div>
                </>
              )}
              {!assignment && !isTechnical && !isEdge && <div>{t("free")}</div>}
            </div>
          );

          return (
            <Popover
              key={ipInt}
              open={open}
              onOpenChange={(nextOpen) =>
                setOpenIp((current) =>
                  nextOpen ? ipInt : current === ipInt ? null : current,
                )
              }
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger
                    aria-label={address}
                    tabIndex={index === focusIndex ? 0 : -1}
                    onFocus={() => setFocusIndex(index)}
                    onKeyDown={(event) => moveCellFocus(event, index)}
                    className="aspect-square min-h-2.5 cursor-pointer touch-manipulation rounded-[3px] outline-offset-1 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
                  >
                    <span
                      aria-hidden="true"
                      className="block size-full rounded-[inherit] border border-[rgb(255_255_255_/_0.035)]"
                      style={{
                        backgroundColor: getCellColor(
                          assignment,
                          isTechnical,
                          isEdge,
                        ),
                        opacity: isEdge
                          ? 0.4
                          : assignment || isTechnical
                            ? 1
                            : 0.18,
                      }}
                    />
                  </PopoverTrigger>
                </TooltipTrigger>
                {openIp === null && (
                  <TooltipContent>
                    <div>{address}</div>
                    {details}
                  </TooltipContent>
                )}
              </Tooltip>
              {open && (
                <PopoverContent
                  aria-label={address}
                  aria-describedby={cellDetailsId}
                  className="w-max max-w-64 px-2 py-1 text-xs break-words"
                  onInteractOutside={(event) => {
                    // Tapping another cell should switch details in one action.
                    if (
                      event.target instanceof Node &&
                      gridRef.current?.contains(event.target)
                    ) {
                      event.preventDefault();
                    }
                  }}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  onEscapeKeyDown={() => {
                    focusCell(gridRef.current, index);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Tab") {
                      focusCell(gridRef.current, index);
                      setOpenIp(null);
                    }
                  }}
                >
                  <div className="font-mono">{address}</div>
                  <div id={cellDetailsId}>{details}</div>
                </PopoverContent>
              )}
            </Popover>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] text-[var(--text-tertiary)]">
        <Legend color="var(--accent-secondary)" label={t("Device")} />
        <Legend color="var(--accent-primary)" label={t("VM")} />
        <Legend color="var(--info)" label={t("Container")} />
        <Legend color="var(--warning)" label={t("Reserved")} />
        <Legend color="var(--warning)" label={t("Gateway/DNS")} />
        <Legend color="var(--text-muted)" label={t("Free")} muted />
      </div>
    </div>
  );
}

function moveCellFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
  const grid = event.currentTarget.parentElement;
  if (!grid) return;
  const style = getComputedStyle(grid);
  const direction = style.direction === "rtl" ? -1 : 1;
  const columns = style.gridTemplateColumns.split(" ").length;
  const offsets: Record<string, number> = {
    ArrowLeft: -direction,
    ArrowRight: direction,
    ArrowUp: -columns,
    ArrowDown: columns,
    Home: -index,
    End: grid.children.length - index - 1,
  };
  const offset = offsets[event.key];
  if (offset === undefined) return;
  event.preventDefault();
  focusCell(grid, index + offset);
}

function focusCell(grid: HTMLElement | null, index: number) {
  const cell = grid?.children.item(index);
  if (cell instanceof HTMLButtonElement) cell.focus();
}

function getCellColor(
  assignment: IpAssignment | undefined,
  technical: boolean,
  edge: boolean,
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
