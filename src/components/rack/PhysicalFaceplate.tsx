import { useMemo, type CSSProperties } from "react";
import { useI18n } from "@/i18n";
import type {
  DevicePhysicalLayout,
  PhysicalFacePrimitiveV1,
  PhysicalPortSlotV1,
  Port,
  RackFace,
  ResolvedPhysicalLayoutV1,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface PhysicalFaceplateProps {
  layout: DevicePhysicalLayout | ResolvedPhysicalLayoutV1;
  face: RackFace;
  ports: Port[];
  linkedPortIds?: Set<string>;
  selectedPortId?: string;
  compact?: boolean;
  detail?: "full" | "simplified";
  fit?: "meet" | "stretch";
  className?: string;
  style?: CSSProperties;
  connectionLabel?: (portId: string) => string | undefined;
  onSelectPort?: (portId: string) => void;
}

function snapshotOf(layout: DevicePhysicalLayout | ResolvedPhysicalLayoutV1) {
  return "snapshot" in layout ? layout.snapshot : layout;
}

function bindingsOf(layout: DevicePhysicalLayout | ResolvedPhysicalLayoutV1) {
  return "bindings" in layout ? layout.bindings : [];
}

function primitiveFill(primitive: PhysicalFacePrimitiveV1) {
  const tone = "tone" in primitive ? primitive.tone : undefined;
  if (tone === "accent") return "var(--color-accent)";
  if (tone === "light") return "var(--color-line-strong)";
  if (tone === "dark") return "var(--color-bg)";
  return "var(--color-surface)";
}

function Primitive({ primitive }: { primitive: PhysicalFacePrimitiveV1 }) {
  if (primitive.kind === "label") {
    return (
      <text
        x={primitive.x}
        y={primitive.y}
        textAnchor={primitive.align ?? "start"}
        fill="var(--color-fg-subtle)"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize="15"
        letterSpacing="1.4"
        style={{ textTransform: "uppercase" }}
      >
        {primitive.text}
      </text>
    );
  }
  if (primitive.kind === "screw" || primitive.kind === "indicator") {
    return (
      <g>
        <circle
          cx={primitive.x}
          cy={primitive.y}
          r={primitive.radius}
          fill={primitiveFill(primitive)}
          stroke="var(--color-line-strong)"
          strokeWidth="2"
        />
        {primitive.kind === "screw" && (
          <path
            d={`M ${primitive.x - primitive.radius * 0.55} ${primitive.y} H ${primitive.x + primitive.radius * 0.55}`}
            stroke="var(--color-fg-subtle)"
            strokeWidth="1.5"
          />
        )}
      </g>
    );
  }
  if (!("width" in primitive)) return null;
  return (
    <rect
      x={primitive.x}
      y={primitive.y}
      width={primitive.width}
      height={primitive.height}
      rx={primitive.kind === "handle" ? 8 : primitive.kind === "panel" ? 5 : 2}
      fill={primitiveFill(primitive)}
      fillOpacity={primitive.kind === "vent" ? 0.68 : 1}
      stroke="var(--color-line-strong)"
      strokeWidth={primitive.kind === "panel" ? 3 : 1.5}
      strokeDasharray={primitive.kind === "vent" ? "5 5" : undefined}
    />
  );
}

function PortConnector({
  slot,
  port,
  linked,
  selected,
  compact,
  connection,
  onSelect,
}: {
  slot: PhysicalPortSlotV1;
  port: Port | undefined;
  linked: boolean;
  selected: boolean;
  compact: boolean;
  connection?: string;
  onSelect?: () => void;
}) {
  const centerX = slot.x + slot.width / 2;
  const centerY = slot.y + slot.height / 2;
  const connectorFill = port
    ? linked
      ? "var(--color-accent)"
      : "var(--color-bg)"
    : "var(--color-surface)";
  const connectorStroke = selected
    ? "var(--color-warning)"
    : linked
      ? "var(--color-accent)"
      : "var(--color-fg-subtle)";
  const title = port
    ? `${port.name} · ${port.kind}${connection ? ` · ${connection}` : ""}`
    : slot.label ?? slot.id;

  return (
    <g
      role={onSelect && port ? "button" : undefined}
      tabIndex={onSelect && port ? 0 : undefined}
      aria-label={title}
      className={cn(onSelect && port && "cursor-pointer outline-none")}
      transform={`rotate(${slot.rotation} ${centerX} ${centerY})`}
      onPointerDown={
        port && onSelect
          ? (event) => {
              event.stopPropagation();
            }
          : undefined
      }
      onClick={
        port && onSelect
          ? (event) => {
              event.stopPropagation();
              onSelect();
            }
          : undefined
      }
      onKeyDown={
        port && onSelect
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
    >
      <title>{title}</title>
      {slot.connector === "power" ? (
        <g>
          <rect
            x={slot.x}
            y={slot.y}
            width={slot.width}
            height={slot.height}
            rx="6"
            fill={connectorFill}
            stroke={connectorStroke}
            strokeWidth={selected ? 5 : linked ? 4 : 2}
          />
          <circle cx={centerX} cy={centerY} r={Math.min(slot.width, slot.height) * 0.18} fill="var(--color-fg-subtle)" />
        </g>
      ) : (
        <g>
          <rect
            x={slot.x}
            y={slot.y}
            width={slot.width}
            height={slot.height}
            rx={slot.connector === "rj45" ? 3 : 1.5}
            fill={connectorFill}
            stroke={connectorStroke}
            strokeWidth={selected ? 5 : linked ? 4 : 2}
          />
          {slot.connector === "rj45" && (
            <path
              d={`M ${slot.x + slot.width * 0.22} ${slot.y + slot.height * 0.25} H ${slot.x + slot.width * 0.78} V ${slot.y + slot.height * 0.55} H ${slot.x + slot.width * 0.22} Z`}
              fill="none"
              stroke="var(--color-fg-subtle)"
              strokeWidth="1.5"
            />
          )}
          {(slot.connector === "sfp" ||
            slot.connector === "sfp_plus" ||
            slot.connector === "qsfp" ||
            slot.connector === "fiber") && (
            <line
              x1={slot.x + slot.width * 0.18}
              x2={slot.x + slot.width * 0.82}
              y1={centerY}
              y2={centerY}
              stroke="var(--color-fg-subtle)"
              strokeWidth="2"
            />
          )}
        </g>
      )}
      {!compact && port && (
        <text
          x={centerX}
          y={slot.y + slot.height + 13}
          textAnchor="middle"
          fill="var(--color-fg-subtle)"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontSize="11"
        >
          {port.name}
        </text>
      )}
    </g>
  );
}

export function PhysicalFaceplate({
  layout,
  face,
  ports,
  linkedPortIds = new Set(),
  selectedPortId,
  compact = false,
  detail = "full",
  fit = "meet",
  className,
  style,
  connectionLabel,
  onSelectPort,
}: PhysicalFaceplateProps) {
  const { t } = useI18n();
  const snapshot = snapshotOf(layout);
  const bindings = bindingsOf(layout);
  const faceDefinition = snapshot.faces[face];
  const portById = useMemo(
    () => new Map(ports.map((port) => [port.id, port])),
    [ports],
  );
  const portIdBySlot = useMemo(
    () => new Map(bindings.map((binding) => [binding.slotId, binding.portId])),
    [bindings],
  );
  const visibleElements = useMemo(
    () =>
      detail === "full"
        ? faceDefinition.elements
        : faceDefinition.elements.filter((primitive) =>
            [
              "panel",
              "handle",
              "bay",
              "display",
              "outlet",
              "indicator",
            ].includes(primitive.kind),
          ),
    [detail, faceDefinition.elements],
  );

  return (
    <svg
      viewBox={`0 0 ${faceDefinition.width} ${faceDefinition.height}`}
      role="img"
      aria-label={t("{hostname} port layout", {
        hostname: face === "front" ? t("Front") : t("Rear"),
      })}
      className={cn(
        "block w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] shadow-[0_12px_32px_rgb(0_0_0_/_0.16)]",
        className,
      )}
      style={style}
      preserveAspectRatio={fit === "stretch" ? "none" : "xMidYMid meet"}
    >
      <rect width="1000" height={faceDefinition.height} fill="var(--color-bg)" />
      {visibleElements.map((primitive) => (
        <Primitive key={primitive.id} primitive={primitive} />
      ))}
      {snapshot.portSlots
        .filter((slot) => slot.face === face)
        .map((slot) => {
          const portId = portIdBySlot.get(slot.id);
          const port = portId ? portById.get(portId) : undefined;
          return (
            <PortConnector
              key={slot.id}
              slot={slot}
              port={port}
              linked={Boolean(portId && linkedPortIds.has(portId))}
              selected={Boolean(portId && selectedPortId === portId)}
              compact={compact}
              connection={portId ? connectionLabel?.(portId) : undefined}
              onSelect={portId && onSelectPort ? () => onSelectPort(portId) : undefined}
            />
          );
        })}
    </svg>
  );
}
