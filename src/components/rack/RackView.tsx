import { useMemo, type CSSProperties } from "react";
import { motion } from "motion/react";
import type { Device, DeviceImage, Rack, RackFace } from "@/lib/types";
import { formatDeviceAddress } from "@/lib/network-labels";
import { cn, statusColor, statusGlow } from "@/lib/utils";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { StatusDot } from "@/components/shared/StatusDot";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { useI18n } from "@/i18n";

interface RackViewProps {
  rack: Rack;
  devices: Device[];
  deviceImages?: Record<string, DeviceImage[]>;
  face: RackFace | "both";
  onSelectDevice?: (deviceId: string) => void;
  selectedDeviceId?: string;
}

interface Slot {
  u: number;
}

interface RackTile {
  device: Device;
  heightU: number;
  topOffsetU: number;
  slot: NonNullable<Device["rackSlot"]>;
}

const DEVICE_ACCENT: Partial<Record<Device["deviceType"], string>> = {
  switch: "var(--accent-secondary)",
  patch_panel: "var(--info)",
  brush_panel: "var(--accent-secondary)",
  blanking_panel: "var(--neutral)",
  server: "var(--accent-primary)",
  storage: "var(--warning)",
  firewall: "var(--danger)",
  router: "var(--info)",
  rack_shelf: "var(--warning)",
  pdu: "var(--neutral)",
  ups: "var(--neutral)",
};

function buildSlots(rack: Rack): Slot[] {
  const slots: Slot[] = [];
  for (let u = rack.totalU; u >= 1; u--) {
    slots.push({ u });
  }
  return slots;
}

function buildTiles(rack: Rack, devices: Device[], face: RackFace): RackTile[] {
  return devices
    .filter(
      (device) => (device.face ?? "front") === face && device.startU != null,
    )
    .map((device) => {
      const heightU = Math.max(1, device.heightU ?? 1);
      const topU = Math.min(rack.totalU, (device.startU ?? 1) + heightU - 1);
      return {
        device,
        heightU,
        topOffsetU: Math.max(0, rack.totalU - topU),
        slot: device.rackSlot ?? "full",
      };
    })
    .sort((a, b) => {
      if (a.topOffsetU !== b.topOffsetU) return a.topOffsetU - b.topOffsetU;
      const slotOrder = { left: 0, full: 1, right: 2 };
      return slotOrder[a.slot] - slotOrder[b.slot];
    });
}

export function RackView({
  rack,
  devices,
  deviceImages = {},
  face,
  onSelectDevice,
  selectedDeviceId,
}: RackViewProps) {
  const faces: RackFace[] = face === "both" ? ["front", "rear"] : [face];
  return (
    <div className="flex flex-wrap items-start gap-4">
      {faces.map((rackFace) => (
        <RackFaceView
          key={rackFace}
          rack={rack}
          devices={devices}
          deviceImages={deviceImages}
          face={rackFace}
          onSelectDevice={onSelectDevice}
          selectedDeviceId={selectedDeviceId}
        />
      ))}
    </div>
  );
}

function RackFaceView({
  rack,
  devices,
  deviceImages,
  face,
  onSelectDevice,
  selectedDeviceId,
}: {
  rack: Rack;
  devices: Device[];
  deviceImages: Record<string, DeviceImage[]>;
  face: RackFace;
  onSelectDevice?: (deviceId: string) => void;
  selectedDeviceId?: string;
}) {
  const { t } = useI18n();
  const slots = useMemo(() => buildSlots(rack), [rack]);
  const tiles = useMemo(
    () => buildTiles(rack, devices, face),
    [rack, devices, face],
  );
  const childDevicesByParent = useMemo(() => {
    return devices.reduce<Record<string, Device[]>>((acc, device) => {
      if (!device.parentDeviceId) return acc;
      (acc[device.parentDeviceId] ??= []).push(device);
      return acc;
    }, {});
  }, [devices]);
  const occupiedUnits = useMemo(() => {
    const units = new Set<number>();
    for (const tile of tiles) {
      const start = tile.device.startU ?? 1;
      for (let u = start; u < start + tile.heightU; u += 1) {
        units.add(u);
      }
    }
    return units;
  }, [tiles]);
  const emptyCount = slots.filter((slot) => !occupiedUnits.has(slot.u)).length;

  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-stretch overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-2)] shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_46%,transparent)] px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            {rack.name} | {face}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {rack.totalU}
            {t("U")}
          </span>
        </div>

        <div className="flex bg-[var(--surface-1)]">
          <RackRail slots={slots} side="left" />

          <div
            className="relative flex-1 bg-[var(--surface-1)]"
            style={{
              width: 360,
              height: `calc(var(--u-height) * ${rack.totalU})`,
            }}
          >
            <div className="absolute inset-0 flex flex-col">
              {slots.map((slot) => (
                <EmptySlot key={slot.u} />
              ))}
            </div>
            {tiles.map((tile) => (
              <DeviceTile
                key={tile.device.id}
                device={tile.device}
                image={deviceImages[tile.device.id]?.[0]}
                heightU={tile.heightU}
                childDevices={childDevicesByParent[tile.device.id] ?? []}
                selected={selectedDeviceId === tile.device.id}
                onClick={() => onSelectDevice?.(tile.device.id)}
                style={tileStyle(tile)}
              />
            ))}
          </div>

          <RackRail slots={slots} side="right" />
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_46%,transparent)] px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            {tiles.length} {t("devices |")}
            {emptyCount}
            {t("U free")}
          </span>
        </div>
      </div>
    </div>
  );
}

function RackRail({ slots, side }: { slots: Slot[]; side: "left" | "right" }) {
  return (
    <div
      className={cn(
        "flex flex-col bg-[var(--bg-shell)]",
        side === "left"
          ? "border-r border-[var(--border-default)]"
          : "border-l border-[var(--border-default)]",
      )}
      style={{ width: 36 }}
    >
      {slots.map((slot) => (
        <div
          key={`${side}-${slot.u}`}
          className="flex items-center justify-center border-b border-[rgb(255_255_255_/_0.035)] font-mono text-[10px] text-[var(--text-muted)] select-none"
          style={{ height: "var(--u-height)" }}
        >
          {slot.u}
        </div>
      ))}
    </div>
  );
}

function tileStyle(tile: RackTile): CSSProperties {
  const base: CSSProperties = {
    top: `calc(var(--u-height) * ${tile.topOffsetU} + 1px)`,
    height: `calc(var(--u-height) * ${tile.heightU} - 2px)`,
  };
  if (tile.slot === "left") {
    return {
      ...base,
      left: 0,
      width: "calc(50% - 2px)",
    };
  }
  if (tile.slot === "right") {
    return {
      ...base,
      left: "calc(50% + 2px)",
      width: "calc(50% - 2px)",
    };
  }
  return {
    ...base,
    left: 0,
    right: 0,
  };
}

function DeviceTile({
  device,
  image,
  heightU,
  childDevices,
  selected,
  onClick,
  style,
}: {
  device: Device;
  image?: DeviceImage;
  heightU: number;
  childDevices: Device[];
  selected: boolean;
  onClick: () => void;
  style: CSSProperties;
}) {
  const { t } = useI18n();
  const tone = statusColor[device.status];
  const glow = statusGlow[device.status];
  const deviceAccent =
    DEVICE_ACCENT[device.deviceType] ?? "var(--accent-primary)";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <motion.button
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          onClick={onClick}
          className={cn(
            "group absolute flex items-center gap-2 px-3 text-left",
            "overflow-hidden rounded-[var(--radius-xs)] border border-[rgb(255_255_255_/_0.06)] transition-colors",
            selected
              ? "bg-[var(--surface-selected)] shadow-[inset_0_0_0_1px_var(--border-selected)]"
              : "bg-[var(--surface-2)] hover:bg-[var(--surface-hover)]",
            "cursor-pointer",
          )}
          style={{
            ...style,
            backgroundImage: `linear-gradient(180deg, rgb(255 255 255 / 0.03), transparent 38%), linear-gradient(90deg, ${deviceAccent}16, transparent 32%)`,
          }}
        >
          <span
            className="absolute inset-x-0 top-0 h-px opacity-70"
            style={{
              background: `linear-gradient(90deg, transparent, ${deviceAccent}55, transparent)`,
            }}
            aria-hidden
          />
          <span
            className="absolute left-0 top-0 h-full w-[3px]"
            style={{ backgroundColor: tone, boxShadow: `0 0 8px ${glow}` }}
            aria-hidden
          />

          {image ? (
            <span
              className={cn(
                "relative z-10 shrink-0 overflow-hidden rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-black/20",
                heightU > 1 ? "h-[calc(100%-8px)] w-16" : "size-6",
              )}
            >
              <img
                src={image.dataUrl}
                alt={t("{hostname} reference", { hostname: device.hostname })}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </span>
          ) : (
            <DeviceTypeIcon
              type={device.deviceType}
              className="relative z-10 size-4 shrink-0 text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]"
            />
          )}

          <div className="relative z-10 min-w-0 flex flex-1 flex-col leading-tight">
            <span className="truncate text-[13px] font-semibold tracking-normal text-[var(--text-primary)]">
              {device.hostname}
            </span>
            <span className="truncate font-mono text-[10px] text-[var(--text-tertiary)]">
              {childDevices.length > 0
                ? t("{length} devices on shelf", {
                    length: childDevices.length,
                  })
                : [device.manufacturer, device.model]
                    .filter(Boolean)
                    .join(" ") || device.deviceType.replace("_", " ")}
            </span>
          </div>

          {childDevices.length > 0 && (
            <span className="relative z-10 flex max-w-[9rem] shrink-0 gap-1 overflow-hidden">
              {childDevices.slice(0, 5).map((child) => (
                <span
                  key={child.id}
                  title={child.hostname}
                  className="grid size-5 place-items-center rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.045)] text-[var(--text-secondary)]"
                >
                  <DeviceTypeIcon type={child.deviceType} className="size-3" />
                </span>
              ))}
              {childDevices.length > 5 && (
                <span className="grid size-5 place-items-center rounded-[var(--radius-xs)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.045)] font-mono text-[9px] text-[var(--text-tertiary)]">
                  +{childDevices.length - 5}
                </span>
              )}
            </span>
          )}

          <span className="relative z-10 shrink-0 rounded-[999px] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.04)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--text-muted)]">
            {t("U")}
            {device.startU}
            {heightU > 1
              ? t("-{value1}", { value1: (device.startU ?? 0) + heightU - 1 })
              : ""}
            {(device.rackSlot ?? "full") !== "full"
              ? t("{value1}", {
                  value1: device.rackSlot === "left" ? "L" : "R",
                })
              : ""}
          </span>

          <span className="relative z-10">
            <StatusDot status={device.status} />
          </span>
        </motion.button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs">
        <div className="flex flex-col gap-1 text-[11px]">
          <span className="font-medium">
            {device.displayName ?? device.hostname}
          </span>
          <span className="text-[var(--text-tertiary)]">
            {[device.manufacturer, device.model].filter(Boolean).join(" ")}
          </span>
          {formatDeviceAddress(device) && (
            <span className="text-[var(--text-tertiary)]">
              {t("mgmt:")}
              {formatDeviceAddress(device)}
            </span>
          )}
          {(device.rackSlot ?? "full") !== "full" && (
            <span className="text-[var(--text-tertiary)]">
              {t("slot:")}
              {device.rackSlot === "left" ? t("left half") : t("right half")}
            </span>
          )}
          {childDevices.length > 0 && (
            <span className="text-[var(--text-tertiary)]">
              {t("shelf:")}
              {childDevices.map((child) => child.hostname).join(", ")}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function EmptySlot() {
  return (
    <div
      className="border-y border-[rgb(255_255_255_/_0.03)] bg-[var(--surface-1)]"
      style={{ height: "var(--u-height)" }}
    >
      <div className="flex h-full items-center justify-between px-2 opacity-55">
        <span className="size-1 rounded-full bg-[var(--text-muted)]" />
        <span className="size-1 rounded-full bg-[var(--text-muted)]" />
      </div>
    </div>
  );
}
