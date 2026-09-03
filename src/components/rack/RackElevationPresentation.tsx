import type {
  CSSProperties,
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
} from "react";
import { useI18n } from "@/i18n";
import type { Device, DevicePhysicalLayout, Port, RackFace } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PhysicalFaceplate } from "./PhysicalFaceplate";

interface RackElevationShellProps {
  totalU: number;
  unitHeight: number;
  width?: number | string;
  railX?: number;
  railY?: number;
  rowOffset?: number;
  showColumns?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function RackElevationShell({
  totalU,
  unitHeight,
  width,
  railX = 14,
  railY = 8,
  rowOffset = railY,
  showColumns = true,
  className,
  style,
  children,
}: RackElevationShellProps) {
  return (
    <div
      className={cn(
        "relative border-[var(--border-strong)] bg-[var(--color-bg)] shadow-[inset_0_0_36px_rgb(0_0_0_/_0.35)]",
        className,
      )}
      style={{
        ...(width == null ? {} : { width }),
        height: totalU * unitHeight + railY * 2,
        borderLeftWidth: railX,
        borderRightWidth: railX,
        borderTopWidth: railY,
        borderBottomWidth: railY,
        ...style,
      }}
    >
      <div aria-hidden="true" className="absolute inset-0">
        {Array.from({ length: totalU }, (_, index) => {
          const u = totalU - index;
          return (
            <span
              key={u}
              className="absolute inset-x-0 border-b border-[var(--border-muted)]"
              style={{
                top: index * unitHeight + rowOffset,
                height: unitHeight,
              }}
            >
              <span className="absolute -left-11 top-1/2 w-8 -translate-y-1/2 text-right font-mono text-[9px] text-[var(--text-muted)]">
                {u}
              </span>
              <span className="absolute -right-11 top-1/2 w-8 -translate-y-1/2 font-mono text-[9px] text-[var(--text-muted)]">
                {u}
              </span>
              {showColumns &&
                Array.from({ length: 11 }, (_, column) => (
                  <span
                    key={column}
                    className="absolute inset-y-0 border-r border-dashed border-[var(--border-muted)] opacity-50"
                    style={{ left: `${((column + 1) / 12) * 100}%` }}
                  />
                ))}
            </span>
          );
        })}
      </div>
      {children}
    </div>
  );
}

interface RackElevationEquipmentFrameProps {
  device: Device;
  layout?: DevicePhysicalLayout;
  physicalFace: RackFace;
  ports: Port[];
  linkedPortIds?: Set<string>;
  selectedPortId?: string;
  rotation?: 0 | 90;
  rectWidth: number;
  rectHeight: number;
  selected?: boolean;
  matches?: boolean;
  healthClassName?: string;
  configurationWarning?: string;
  detail?: "full" | "simplified";
  className?: string;
  style?: CSSProperties;
  title?: string;
  testId?: string;
  selectionId?: string;
  onSelectDevice?: (deviceId: string) => void;
  onSelectPort?: (deviceId: string, portId: string) => void;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  children?: ReactNode;
}

export function RackElevationEquipmentFrame({
  device,
  layout,
  physicalFace,
  ports,
  linkedPortIds,
  selectedPortId,
  rotation = 0,
  rectWidth,
  rectHeight,
  selected = false,
  matches = true,
  healthClassName,
  configurationWarning,
  detail,
  className,
  style,
  title,
  testId,
  selectionId,
  onSelectDevice,
  onSelectPort,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
  children,
}: RackElevationEquipmentFrameProps) {
  const { t } = useI18n();
  const rotated = rotation === 90;
  const widthRatio = rectWidth > 0 ? rectHeight / rectWidth : 1;
  const heightRatio = rectHeight > 0 ? rectWidth / rectHeight : 1;
  const interactive = Boolean(onSelectDevice);
  const hasPortControls = Boolean(onSelectPort);

  return (
    <div
      role={interactive ? (hasPortControls ? "group" : "button") : undefined}
      tabIndex={interactive && !hasPortControls ? 0 : undefined}
      aria-label={interactive ? device.hostname : undefined}
      data-rack-cabling-interactive={interactive ? "true" : undefined}
      data-rack-cabling-equipment={interactive ? "true" : undefined}
      data-highlighted={selected ? "true" : "false"}
      data-cabling-selection-id={!hasPortControls ? selectionId : undefined}
      data-testid={testId}
      className={cn(
        "absolute overflow-hidden rounded-[2px] border bg-[var(--surface-1)] text-left outline-none transition-[box-shadow,border-color,opacity]",
        selected
          ? "z-30 border-[var(--accent-primary)] shadow-[0_0_0_2px_var(--accent-primary-border)]"
          : "z-10 border-[var(--border-strong)] hover:border-[var(--accent-primary)]",
        !matches && "opacity-20",
        healthClassName,
        className,
      )}
      style={style}
      title={title ?? device.hostname}
      onClick={
        onSelectDevice
          ? (event) => {
              event.stopPropagation();
              onSelectDevice(device.id);
            }
          : undefined
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(event) => {
        if (!hasPortControls && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onSelectDevice?.(device.id);
        }
        onKeyDown?.(event);
      }}
    >
      {layout ? (
        <PhysicalFaceplate
          layout={layout}
          face={physicalFace}
          ports={ports}
          linkedPortIds={linkedPortIds}
          selectedPortId={selectedPortId}
          compact
          detail={detail}
          fit="stretch"
          onSelectPort={
            onSelectPort
              ? (portId) => onSelectPort(device.id, portId)
              : undefined
          }
          className="absolute left-1/2 top-1/2 h-full w-full rounded-none border-0 shadow-none"
          style={
            rotated
              ? {
                  width: `${widthRatio * 100}%`,
                  height: `${heightRatio * 100}%`,
                  transform: "translate(-50%, -50%) rotate(90deg)",
                }
              : { transform: "translate(-50%, -50%)" }
          }
        />
      ) : (
        <span className="flex h-full items-center justify-center border border-dashed border-[var(--color-warning)]/60 px-2 text-center text-[8px] text-[var(--color-warning)]">
          {t("Physical layout")} · {t("Needs attention")}
        </span>
      )}
      {configurationWarning ? (
        <span className="pointer-events-none absolute inset-x-1 bottom-0.5 z-20 truncate rounded bg-[var(--color-warning)]/95 px-1 py-0.5 text-center text-[7px] font-semibold text-black">
          {configurationWarning}
        </span>
      ) : null}
      {interactive && hasPortControls ? (
        <button
          type="button"
          data-cabling-selection-id={selectionId}
          className="absolute left-1 top-0.5 z-10 max-w-[80%] truncate rounded bg-black/70 px-1 py-0.5 font-mono text-[7px] text-white"
          onClick={(event) => {
            event.stopPropagation();
            onSelectDevice?.(device.id);
          }}
        >
          {device.hostname}
        </button>
      ) : (
        <span className="pointer-events-none absolute left-1 top-0.5 z-10 max-w-[80%] truncate rounded bg-black/70 px-1 py-0.5 font-mono text-[7px] text-white">
          {device.hostname}
        </span>
      )}
      {children}
    </div>
  );
}
