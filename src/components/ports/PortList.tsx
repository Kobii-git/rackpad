import type { ReactNode } from "react";
import type { Device, Port, PortLink, VirtualSwitch, Vlan } from "@/lib/types";
import {
  cn,
  formatPortLabel,
  portTypeColor,
} from "@/lib/utils";
import { StatusDot } from "@/components/shared/StatusDot";
import { Mono } from "@/components/shared/Mono";
import { ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  formatPortModeSummary,
  formatPortTypeLabel,
} from "@/components/ports/port-mode-labels";

interface PortListProps {
  ports: Port[];
  links: Record<string, PortLink>;
  portsById: Record<string, Port>;
  devicesById: Record<string, Device>;
  vlansById?: Record<string, Vlan>;
  virtualSwitchesById?: Record<string, VirtualSwitch>;
  snmpVerifiedPortIds?: Set<string>;
  onSelectPort?: (portId: string) => void;
  selectedPortId?: string;
  selectedPortIds?: Set<string>;
  onTogglePortSelection?: (portId: string) => void;
}

export function PortList({
  ports,
  links,
  portsById,
  devicesById,
  vlansById = {},
  virtualSwitchesById = {},
  snmpVerifiedPortIds,
  onSelectPort,
  selectedPortId,
  selectedPortIds,
  onTogglePortSelection,
}: PortListProps) {
  const { t } = useI18n();
  const isPatchPanel =
    ports.length > 0 &&
    devicesById[ports[0].deviceId]?.deviceType === "patch_panel";
  const patchPanelRows = isPatchPanel ? buildPatchPanelRows(ports) : [];

  return (
    <div className="rk-table-shell">
      <table className="rk-table">
        <thead>
          <tr>
            {onTogglePortSelection && <Th className="w-1">{t("Select")}</Th>}
            <Th className="w-1">•</Th>
            <Th>{t("Port")}</Th>
            <Th>{t("Type")}</Th>
            <Th>{t("Speed")}</Th>
            <Th>{t("Mode")}</Th>
            <Th>{t("Linked to")}</Th>
            <Th>{t("Cable")}</Th>
          </tr>
        </thead>
        <tbody>
          {isPatchPanel
            ? patchPanelRows.map((row) => {
                const frontLink = row.front ? links[row.front.id] : undefined;
                const rearLink = row.rear ? links[row.rear.id] : undefined;
                const selected =
                  selectedPortId === row.front?.id ||
                  selectedPortId === row.rear?.id;

                return (
                  <tr key={row.key} data-selected={selected}>
                    {onTogglePortSelection && (
                      <Td>
                        <div className="flex flex-col gap-1">
                          {row.front && (
                            <PortSelectionCheckbox
                              port={row.front}
                              selected={Boolean(
                                selectedPortIds?.has(row.front.id),
                              )}
                              onToggle={onTogglePortSelection}
                              t={t}
                            />
                          )}
                          {row.rear && (
                            <PortSelectionCheckbox
                              port={row.rear}
                              selected={Boolean(
                                selectedPortIds?.has(row.rear.id),
                              )}
                              onToggle={onTogglePortSelection}
                              t={t}
                            />
                          )}
                        </div>
                      </Td>
                    )}
                    <Td>
                      <StatusDot
                        link={resolvePatchPanelLinkState(row.front, row.rear)}
                      />
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-1">
                        <Mono className="text-[var(--text-primary)]">
                          {row.label}
                        </Mono>
                        <div className="flex flex-wrap gap-1">
                          {row.front ? (
                            <SideSelectChip
                              label={t("Front")}
                              selected={selectedPortId === row.front.id}
                              onClick={() => onSelectPort?.(row.front!.id)}
                            />
                          ) : null}
                          {row.rear ? (
                            <SideSelectChip
                              label={t("Rear")}
                              selected={selectedPortId === row.rear.id}
                              onClick={() => onSelectPort?.(row.rear!.id)}
                            />
                          ) : null}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="size-1.5 rounded-[2px]"
                          style={{ backgroundColor: portTypeColor[row.kind] }}
                        />
                        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                          {formatPortTypeLabel(t, row.kind)}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <Mono className="text-[var(--text-tertiary)]">
                        {row.speed ?? t("n/a")}
                      </Mono>
                    </Td>
                    <Td>
                      <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                        {renderPatchPanelSide(
                          t("Front"),
                          row.front,
                          vlansById,
                          virtualSwitchesById,
                          t,
                        )}
                        {renderPatchPanelSide(
                          t("Rear"),
                          row.rear,
                          vlansById,
                          virtualSwitchesById,
                          t,
                        )}
                      </div>
                    </Td>
                    <Td>
                      <div className="space-y-1 text-xs">
                        {renderPatchPanelPeer(
                          t("Front"),
                          row.front,
                          frontLink,
                          portsById,
                          devicesById,
                        )}
                        {renderPatchPanelPeer(
                          t("Rear"),
                          row.rear,
                          rearLink,
                          portsById,
                          devicesById,
                        )}
                      </div>
                    </Td>
                    <Td>
                      <div className="space-y-1 font-mono text-[11px] text-[var(--text-tertiary)]">
                        {renderPatchPanelCable(t("Front"), frontLink, t)}
                        {renderPatchPanelCable(t("Rear"), rearLink, t)}
                      </div>
                    </Td>
                  </tr>
                );
              })
            : ports.map((port) => {
            const link = links[port.id];
            let otherDevice: Device | undefined;
            let otherPort: Port | undefined;
            if (link) {
              const otherId =
                link.fromPortId === port.id ? link.toPortId : link.fromPortId;
              otherPort = portsById[otherId];
              if (otherPort) otherDevice = devicesById[otherPort.deviceId];
            }

            return (
              <tr
                key={port.id}
                data-selected={selectedPortId === port.id}
                onClick={() => onSelectPort?.(port.id)}
                className={cn(onSelectPort ? "cursor-pointer" : "")}
              >
                {onTogglePortSelection && (
                  <Td>
                    <PortSelectionCheckbox
                      port={port}
                      selected={Boolean(selectedPortIds?.has(port.id))}
                      onToggle={onTogglePortSelection}
                      t={t}
                    />
                  </Td>
                )}
                <Td>
                  <StatusDot link={port.linkState} />
                </Td>
                <Td>
                  <Mono className="text-[var(--text-primary)]">
                    <span className="inline-flex items-center gap-2">
                      {formatPortLabel(port)}
                      {snmpVerifiedPortIds?.has(port.id) ? (
                        <span className="rounded border border-[var(--accent-primary)]/35 bg-[var(--accent-primary)]/10 px-1 py-0.5 font-sans text-[9px] uppercase tracking-[0.12em] text-[var(--accent-primary)]">
                          SNMP
                        </span>
                      ) : null}
                    </span>
                  </Mono>
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="size-1.5 rounded-[2px]"
                      style={{ backgroundColor: portTypeColor[port.kind] }}
                    />
                    <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                      {formatPortTypeLabel(t, port.kind)}
                    </span>
                  </span>
                </Td>
                <Td>
                  <Mono className="text-[var(--text-tertiary)]">
                    {port.speed ?? t("n/a")}
                  </Mono>
                </Td>
                <Td>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {formatPortModeSummary(
                      t,
                      port,
                      vlansById,
                      virtualSwitchesById,
                    )}
                  </div>
                </Td>
                <Td>
                  {otherDevice && otherPort ? (
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <ArrowRight className="size-3 text-[var(--accent-secondary)]" />
                      <span>{otherDevice.hostname}</span>
                      <span className="text-[var(--text-muted)]">:</span>
                      <Mono className="text-[var(--accent-secondary)]">
                        {formatPortLabel(otherPort, { includeFace: true })}
                      </Mono>
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                  )}
                </Td>
                <Td>
                  {link ? (
                    <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                      {link.cableType || t("Cable")}
                      {link.cableLength ? ` | ${link.cableLength}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <th className={cn(className)}>{children}</th>;
}

function Td({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <td className={cn(className)}>{children}</td>;
}

function PortSelectionCheckbox({
  port,
  selected,
  onToggle,
  t,
}: {
  port: Port;
  selected: boolean;
  onToggle: (portId: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <input
      type="checkbox"
      checked={selected}
      onClick={(event) => event.stopPropagation()}
      onChange={() => onToggle(port.id)}
      aria-label={t("Select port {label}", {
        label: formatPortLabel(port, { includeFace: true }),
      })}
    />
  );
}

function renderPatchPanelSide(
  label: string,
  port: Port | undefined,
  vlansById: Record<string, Vlan>,
  virtualSwitchesById: Record<string, VirtualSwitch>,
  t: ReturnType<typeof useI18n>["t"],
) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </span>
      <span>
        {port
          ? formatPortModeSummary(t, port, vlansById, virtualSwitchesById)
          : t("not documented")}
      </span>
    </div>
  );
}

type PatchPanelRow = {
  key: string;
  label: string;
  kind: Port["kind"];
  speed?: string;
  front?: Port;
  rear?: Port;
  sortValue: number;
};

function buildPatchPanelRows(ports: Port[]): PatchPanelRow[] {
  const groups = new Map<string, PatchPanelRow>();

  for (const port of ports) {
    const key = `${port.kind}|${port.name.trim().toLowerCase()}`;
    const existing = groups.get(key);
    const sortValue = Number.parseInt(port.name, 10);

    if (!existing) {
      groups.set(key, {
        key,
        label: port.name,
        kind: port.kind,
        speed: port.speed,
        front: port.face === "rear" ? undefined : port,
        rear: port.face === "rear" ? port : undefined,
        sortValue: Number.isFinite(sortValue) ? sortValue : port.position,
      });
      continue;
    }

    if (port.face === "rear") {
      existing.rear = port;
    } else {
      existing.front = port;
    }
  }

  return [...groups.values()].sort(
    (a, b) => a.sortValue - b.sortValue || a.label.localeCompare(b.label),
  );
}

function resolvePatchPanelLinkState(front?: Port, rear?: Port): Port["linkState"] {
  if (front?.linkState === "up" || rear?.linkState === "up") return "up";
  if (front?.linkState === "unknown" || rear?.linkState === "unknown") {
    return "unknown";
  }
  if (front?.linkState === "disabled" || rear?.linkState === "disabled") {
    return "disabled";
  }
  return "down";
}

function SideSelectChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[999px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors",
        selected
          ? "border-[var(--border-selected)] bg-[var(--surface-selected)] text-[var(--accent-secondary)]"
          : "border-[var(--border-default)] bg-[rgb(255_255_255_/_0.025)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
      )}
    >
      {label}
    </button>
  );
}

function renderPatchPanelPeer(
  label: string,
  port: Port | undefined,
  link: PortLink | undefined,
  portsById: Record<string, Port>,
  devicesById: Record<string, Device>,
) {
  if (!port) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {label}
        </span>
        <span className="text-[var(--text-muted)]">—</span>
      </div>
    );
  }

  const otherPortId =
    link?.fromPortId === port.id ? link.toPortId : link?.fromPortId;
  const otherPort = otherPortId ? portsById[otherPortId] : undefined;
  const otherDevice = otherPort ? devicesById[otherPort.deviceId] : undefined;

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </span>
      {otherDevice && otherPort ? (
        <>
          <ArrowRight className="size-3 text-[var(--accent-secondary)]" />
          <span>{otherDevice.hostname}</span>
          <span className="text-[var(--text-muted)]">:</span>
          <Mono className="text-[var(--accent-secondary)]">
            {formatPortLabel(otherPort, { includeFace: true })}
          </Mono>
        </>
      ) : (
        <span className="text-[var(--text-muted)]">—</span>
      )}
    </div>
  );
}

function renderPatchPanelCable(
  label: string,
  link: PortLink | undefined,
  t: ReturnType<typeof useI18n>["t"],
) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
        {label}
      </span>
      <span>
        {link
          ? `${link.cableType || t("Cable")}${link.cableLength ? ` | ${link.cableLength}` : ""}`
          : "—"}
      </span>
    </div>
  );
}
