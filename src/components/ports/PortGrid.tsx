import { motion } from "motion/react";
import type { Device, Port, PortLink, VirtualSwitch, Vlan } from "@/lib/types";
import {
  cn,
  formatPortLabel,
  portTypeColor,
  portTypeLabel,
} from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { useI18n } from "@/i18n";
import { formatPortModeSummary } from "@/components/ports/port-mode-labels";

interface PortGridProps {
  device: Device;
  ports: Port[];
  links: Record<string, PortLink>;
  portsById: Record<string, Port>;
  devicesById: Record<string, Device>;
  vlansById?: Record<string, Vlan>;
  virtualSwitchesById?: Record<string, VirtualSwitch>;
  snmpVerifiedPortIds?: Set<string>;
  onSelectPort?: (portId: string) => void;
  selectedPortId?: string;
}

export function PortGrid({
  device,
  ports,
  links,
  portsById,
  devicesById,
  vlansById = {},
  virtualSwitchesById = {},
  snmpVerifiedPortIds,
  onSelectPort,
  selectedPortId,
}: PortGridProps) {
  const { t } = useI18n();
  const sections = groupPortsByKind(ports);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-2)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_42%,transparent)] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              {device.hostname}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">|</span>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {[device.manufacturer, device.model].filter(Boolean).join(" ") ||
                t("device view")}
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {t("{count} ports", { count: ports.length })}
          </span>
        </div>

        <div className="flex flex-col gap-4 bg-[linear-gradient(180deg,rgb(255_255_255_/_0.02),transparent_16%),var(--surface-1)] p-4">
          {sections.map(({ kind, items }) => (
            <PortSection
              key={kind}
              kind={kind}
              items={items}
              links={links}
              portsById={portsById}
              devicesById={devicesById}
              vlansById={vlansById}
              virtualSwitchesById={virtualSwitchesById}
              snmpVerifiedPortIds={snmpVerifiedPortIds}
              onSelectPort={onSelectPort}
              selectedPortId={selectedPortId}
              t={t}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function groupPortsByKind(ports: Port[]) {
  const groups = new Map<string, Port[]>();
  for (const port of ports) {
    if (!groups.has(port.kind)) groups.set(port.kind, []);
    groups.get(port.kind)!.push(port);
  }

  return Array.from(groups.entries()).map(([kind, items]) => ({
    kind: kind as Port["kind"],
    items: items.sort((a, b) => a.position - b.position),
  }));
}

function PortSection({
  kind,
  items,
  links,
  portsById,
  devicesById,
  vlansById,
  virtualSwitchesById,
  snmpVerifiedPortIds,
  onSelectPort,
  selectedPortId,
  t,
}: {
  kind: Port["kind"];
  items: Port[];
  links: Record<string, PortLink>;
  portsById: Record<string, Port>;
  devicesById: Record<string, Device>;
  vlansById: Record<string, Vlan>;
  virtualSwitchesById: Record<string, VirtualSwitch>;
  snmpVerifiedPortIds?: Set<string>;
  onSelectPort?: (portId: string) => void;
  selectedPortId?: string;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const useTwoRows = items.length > 8;
  const top = useTwoRows ? items.filter((_, index) => index % 2 === 0) : items;
  const bottom = useTwoRows ? items.filter((_, index) => index % 2 === 1) : [];

  return (
    <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="rk-kicker">{portTypeLabel[kind]}</span>
        <span
          className="h-px flex-1"
          style={{ backgroundColor: portTypeColor[kind], opacity: 0.26 }}
        />
        <span className="rounded-[999px] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.035)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]">
          {items.length}
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1.5">
          {top.map((port, index) => (
            <PortCell
              key={port.id}
              port={port}
              link={links[port.id]}
              portsById={portsById}
              devicesById={devicesById}
              vlansById={vlansById}
              virtualSwitchesById={virtualSwitchesById}
              snmpVerifiedPortIds={snmpVerifiedPortIds}
              onSelect={onSelectPort}
              selected={selectedPortId === port.id}
              delay={index * 0.012}
              t={t}
            />
          ))}
        </div>
        {useTwoRows && (
          <div className="flex flex-wrap gap-1.5">
            {bottom.map((port, index) => (
              <PortCell
                key={port.id}
                port={port}
                link={links[port.id]}
                portsById={portsById}
                devicesById={devicesById}
                vlansById={vlansById}
                virtualSwitchesById={virtualSwitchesById}
                onSelect={onSelectPort}
                selected={selectedPortId === port.id}
                delay={index * 0.012 + 0.05}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PortCell({
  port,
  link,
  portsById,
  devicesById,
  vlansById,
  virtualSwitchesById,
  snmpVerifiedPortIds,
  onSelect,
  selected,
  delay = 0,
  t,
}: {
  port: Port;
  link?: PortLink;
  portsById: Record<string, Port>;
  devicesById: Record<string, Device>;
  vlansById: Record<string, Vlan>;
  virtualSwitchesById: Record<string, VirtualSwitch>;
  snmpVerifiedPortIds?: Set<string>;
  onSelect?: (portId: string) => void;
  selected?: boolean;
  delay?: number;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const isLinked = port.linkState === "up";
  const snmpVerified = snmpVerifiedPortIds?.has(port.id) ?? false;
  const baseColor = portTypeColor[port.kind];

  let otherDevice: Device | undefined;
  let otherPort: Port | undefined;
  if (link) {
    const otherPortId =
      link.fromPortId === port.id ? link.toPortId : link.fromPortId;
    otherPort = portsById[otherPortId];
    if (otherPort) otherDevice = devicesById[otherPort.deviceId];
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay, ease: [0.22, 1, 0.36, 1] }}
          onClick={() => onSelect?.(port.id)}
          className={cn(
            "relative flex min-w-[46px] flex-col items-center gap-1 border px-1.5 py-1.5 transition-[background-color,border-color,transform,box-shadow] duration-150",
            port.kind === "rj45"
              ? "rounded-[var(--radius-sm)]"
              : 'rounded-[6px] before:absolute before:inset-x-[6px] before:top-[11px] before:h-[2px] before:bg-[rgb(0_0_0_/_0.18)] before:content-[""]',
            selected
              ? "border-[var(--border-selected)] bg-[var(--surface-selected)] shadow-[0_0_0_1px_var(--border-selected),0_10px_22px_rgb(0_0_0_/_0.24)]"
              : "border-[var(--border-default)] bg-[var(--surface-2)] hover:-translate-y-px hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
          )}
        >
          <span
            className="absolute inset-x-1 top-1 h-px rounded-full opacity-70"
            style={{
              background: `linear-gradient(90deg, transparent, ${baseColor}, transparent)`,
            }}
            aria-hidden
          />

          <span className="font-mono text-[10px] leading-none text-[var(--text-primary)]">
            {port.name}
          </span>

          {port.kind === "rj45" ? (
            <span
              className="relative block h-4 w-7 overflow-hidden rounded-[3px] border border-[rgb(255_255_255_/_0.06)]"
              style={{
                background: `linear-gradient(180deg, rgb(255 255 255 / 0.08), transparent 45%), ${baseColor}20`,
                boxShadow: isLinked
                  ? `0 0 0 1px ${baseColor}55 inset`
                  : "0 0 0 1px rgb(255 255 255 / 0.04) inset",
              }}
            >
              <span className="absolute inset-x-1 top-1 h-[5px] rounded-[2px] bg-[rgb(7_10_15_/_0.5)]" />
              <span className="absolute inset-x-2 bottom-[3px] h-[2px] rounded-full bg-[rgb(255_255_255_/_0.2)]" />
            </span>
          ) : (
            <span
              className="relative block h-4 w-8 overflow-hidden rounded-[2px] border border-[rgb(255_255_255_/_0.05)]"
              style={{
                background: `linear-gradient(180deg, rgb(255 255 255 / 0.08), transparent 50%), ${baseColor}16`,
                boxShadow: isLinked
                  ? `0 0 0 1px ${baseColor}55 inset`
                  : "0 0 0 1px rgb(255 255 255 / 0.04) inset",
              }}
            >
              <span className="absolute inset-x-1 top-1.5 h-[3px] rounded-[1px] bg-[rgb(7_10_15_/_0.55)]" />
            </span>
          )}

          {snmpVerified ? (
            <span
              className="absolute right-1 top-1 size-1.5 rounded-full bg-[var(--accent-primary)] shadow-[0_0_6px_var(--accent-primary-glow)]"
              title={t("SNMP verified")}
              aria-label={t("SNMP verified")}
            />
          ) : null}

          <div className="flex items-center gap-1">
            <span
              className={cn(
                "block size-1.5 rounded-full transition-colors",
                isLinked ? "animate-pulse-slow" : "",
              )}
              style={{
                backgroundColor: isLinked
                  ? "var(--accent-secondary)"
                  : "var(--text-muted)",
                boxShadow: isLinked
                  ? "0 0 6px var(--accent-secondary-glow)"
                  : "none",
              }}
            />
            <span className="font-mono text-[9px] text-[var(--text-muted)]">
              {port.speed ?? t("n/a")}
            </span>
          </div>
        </motion.button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="flex flex-col gap-1 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="font-medium">{port.name}</span>
            <span className="text-[var(--text-tertiary)]">
              {portTypeLabel[port.kind]} | {port.speed ?? t("n/a")}
            </span>
          </div>
          <span className="text-[var(--text-tertiary)]">
            {formatPortModeSummary(t, port, vlansById, virtualSwitchesById, false)}
          </span>
          {port.virtualSwitchId ? (
            <span className="text-[var(--accent-secondary)]">
              {t("bridge {name}", {
                name:
                  virtualSwitchesById[port.virtualSwitchId]?.name ??
                  port.virtualSwitchId,
              })}
            </span>
          ) : null}
          {snmpVerified ? (
            <span className="text-[var(--accent-primary)]">
              {t("SNMP verified link state")}
            </span>
          ) : null}
          {isLinked && otherDevice && otherPort ? (
            <span className="text-[var(--accent-secondary)]">
              {t("linked to {hostname}:{portLabel}", {
                hostname: otherDevice.hostname,
                portLabel: formatPortLabel(otherPort, { includeFace: true }),
              })}
            </span>
          ) : (
            <span className="text-[var(--text-muted)]">{t("no link")}</span>
          )}
          {link && (
            <span className="text-[var(--text-tertiary)]">
              {link.cableType || t("Cable")}{" "}
              {link.cableLength ? `| ${link.cableLength}` : ""}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
