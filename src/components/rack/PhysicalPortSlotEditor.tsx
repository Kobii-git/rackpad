import { templateItemValue, type TemplateItem } from "@/lib/hardware-template-editing";
import { physicalItemColor } from "@/lib/faceplate-artwork";
import {
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useI18n } from "@/i18n";
import type {
  FaceDefinitionV1,
  HardwareTemplateV1,
  PhysicalFacePrimitiveV1,
  PhysicalPortSlotV1,
  RackFace,
  ResolvedPhysicalLayoutV1,
} from "@/lib/types";
import { cn } from "@/lib/utils";

interface PhysicalPortSlotEditorProps {
  selectedItem?: TemplateItem;
  onEditStart?: () => void;
  onEditCancel?: () => void;
  onResizeItem?: (item: TemplateItem, dimensions: {width?: number; height?: number; radius?: number}) => void;
  layout: HardwareTemplateV1 | ResolvedPhysicalLayoutV1;
  face: RackFace;
  selectedSlotId?: string;
  selectedElementId?: string;
  selectedModuleSlotId?: string;
  className?: string;
  onSelectSlot?: (slotId: string) => void;
  onSelectElement?: (elementId: string) => void;
  onSelectModuleSlot?: (slotId: string) => void;
  onMoveSlot: (slotId: string, x: number, y: number) => void;
  onMoveElement?: (elementId: string, x: number, y: number) => void;
  onMoveModuleSlot?: (slotId: string, x: number, y: number) => void;
}

function faceOf(
  layout: HardwareTemplateV1 | ResolvedPhysicalLayoutV1,
  face: RackFace,
): FaceDefinitionV1 {
  return "faces" in layout ? layout.faces[face] : layout[face];
}

function fillOf(primitive: PhysicalFacePrimitiveV1) {
  const tone = "tone" in primitive ? primitive.tone : undefined;
  if (primitive.color) return physicalItemColor(primitive.color, "var(--color-surface)");
  if (tone === "accent") return "var(--color-accent)";
  if (tone === "dark") return "var(--color-bg)";
  if (tone === "light") return "var(--color-line-strong)";
  return "var(--color-surface)";
}

export function PhysicalPortSlotEditor({
  layout,
  selectedItem,
  onEditStart,
  onEditCancel,
  onResizeItem,
  face,
  selectedSlotId,
  selectedElementId,
  selectedModuleSlotId,
  className,
  onSelectSlot,
  onSelectElement,
  onSelectModuleSlot,
  onMoveSlot,
  onMoveElement,
  onMoveModuleSlot,
}: PhysicalPortSlotEditorProps) {
  const { t } = useI18n();
  const definition = faceOf(layout, face);
  const [drag, setDrag] = useState<{
    kind: "slot" | "element" | "module-slot";
    id: string;
    offsetX: number;
    offsetY: number;
    pointerId: number;
    resize?: TemplateItem;
  }>();
  const slots = layout.portSlots.filter((slot) => slot.face === face);
  const moduleSlots =
    "moduleSlots" in layout
      ? layout.moduleSlots.filter((slot) => slot.face === face)
      : [];

  function point(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * definition.width,
      y: ((event.clientY - bounds.top) / bounds.height) * definition.height,
    };
  }

  function beginDrag(
    event: ReactPointerEvent<SVGElement>,
    kind: "slot" | "element" | "module-slot",
    id: string,
    x: number,
    y: number,
  ) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const pointerX =
      ((event.clientX - bounds.left) / bounds.width) * definition.width;
    const pointerY =
      ((event.clientY - bounds.top) / bounds.height) * definition.height;
    onEditStart?.();
    svg.focus();
    svg.setPointerCapture(event.pointerId);
    setDrag({ kind, id, pointerId: event.pointerId, offsetX: pointerX - x, offsetY: pointerY - y });
  }

  return (
    <svg
      viewBox={`0 0 ${definition.width} ${definition.height}`}
      role="application"
      tabIndex={0}
      aria-label={t("Physical layout")}
      className={cn(
        "block w-full touch-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)]",
        className,
      )}
      onPointerMove={(event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const next = point(event);
        if (drag.resize && "moduleSlots" in layout) {
          const value = templateItemValue(layout, drag.resize);
          if (!value || !("x" in value)) return;
          if ("radius" in value) {
            onResizeItem?.(drag.resize, {radius: Math.max(1, Math.min(100, value.x, value.y, definition.width-value.x, definition.height-value.y, next.x-value.x))});
          } else if ("width" in value) {
            const minimum = drag.resize.kind === "port" ? 4 : 1;
            const maximum = drag.resize.kind === "port" ? 200 : 1000;
            onResizeItem?.(drag.resize, {width: Math.max(minimum, Math.min(maximum, definition.width-value.x, next.x-value.x)), height: Math.max(minimum, Math.min(maximum, definition.height-value.y, next.y-value.y))});
          }
          return;
        }
        if (drag.kind === "slot") {
          onMoveSlot(drag.id, next.x - drag.offsetX, next.y - drag.offsetY);
        } else if (drag.kind === "element") {
          onMoveElement?.(
            drag.id,
            next.x - drag.offsetX,
            next.y - drag.offsetY,
          );
        } else {
          onMoveModuleSlot?.(
            drag.id,
            next.x - drag.offsetX,
            next.y - drag.offsetY,
          );
        }
      }}
      onPointerUp={() => setDrag(undefined)}
      onPointerCancel={() => {onEditCancel?.(); setDrag(undefined);}}
      onKeyDown={event => {if (event.key === "Escape" && drag) {event.preventDefault(); onEditCancel?.(); setDrag(undefined);}}}
    >
      <rect
        width={definition.width}
        height={definition.height}
        fill="var(--color-bg)"
      />
      {definition.elements.map((primitive) => (
        <Primitive
          key={primitive.id}
          primitive={primitive}
          selected={selectedElementId === primitive.id}
          onPointerDown={
            onMoveElement
              ? (event) => {
                  beginDrag(
                    event,
                    "element",
                    primitive.id,
                    primitive.x,
                    primitive.y,
                  );
                  onSelectElement?.(primitive.id);
                }
              : undefined
          }
        />
      ))}
      {"modules" in layout &&
        layout.modules
          .filter((module) => module.face === face)
          .map((module) => {
            const moduleSlot = moduleSlots.find(
              (slot) => slot.id === module.slotId,
            );
            return (
              <g
                key={module.id}
                data-testid="template-module-preview"
                role={moduleSlot && onMoveModuleSlot ? "button" : undefined}
                tabIndex={moduleSlot && onMoveModuleSlot ? 0 : undefined}
                aria-label={module.name}
                className={
                  moduleSlot && onMoveModuleSlot ? "cursor-move" : undefined
                }
                onPointerDown={
                  moduleSlot && onMoveModuleSlot
                    ? (event) => {
                        beginDrag(
                          event,
                          "module-slot",
                          moduleSlot.id,
                          moduleSlot.x,
                          moduleSlot.y,
                        );
                        onSelectModuleSlot?.(moduleSlot.id);
                      }
                    : undefined
                }
                onKeyDown={
                  moduleSlot && onMoveModuleSlot
                    ? (event) => {
                        const step = event.shiftKey ? 10 : 1;
                        const delta =
                          event.key === "ArrowLeft"
                            ? [-step, 0]
                            : event.key === "ArrowRight"
                              ? [step, 0]
                              : event.key === "ArrowUp"
                                ? [0, -step]
                                : event.key === "ArrowDown"
                                  ? [0, step]
                                  : undefined;
                        if (!delta) return;
                        event.preventDefault();
                        onSelectModuleSlot?.(moduleSlot.id);
                        onMoveModuleSlot(
                          moduleSlot.id,
                          moduleSlot.x + delta[0],
                          moduleSlot.y + delta[1],
                        );
                      }
                    : undefined
                }
              >
                {module.elements.map((primitive) => (
                  <Primitive key={primitive.id} primitive={primitive} />
                ))}
                {module.portSlots.map((slot) => (
                  <rect
                    key={slot.id}
                    x={slot.x}
                    y={slot.y}
                    width={slot.width}
                    height={slot.height}
                    fill={physicalItemColor(slot.color, "var(--color-bg)")}
                    stroke="var(--color-accent)"
                  >
                    <title>{slot.label ?? slot.id}</title>
                  </rect>
                ))}
              </g>
            );
          })}
      {moduleSlots.map((slot) => (
        <rect
          key={slot.id}
          x={slot.x}
          y={slot.y}
          width={slot.width}
          height={slot.height}
          fill="none"
          stroke="var(--color-warning)"
          strokeDasharray="8 6"
          strokeWidth={selectedModuleSlotId === slot.id ? "5" : "2"}
          className={onMoveModuleSlot ? "cursor-move" : undefined}
          onPointerDown={
            onMoveModuleSlot
              ? (event) => {
                  beginDrag(event, "module-slot", slot.id, slot.x, slot.y);
                  onSelectModuleSlot?.(slot.id);
                }
              : undefined
          }
        >
          <title>{slot.id}</title>
        </rect>
      ))}
      {slots.map((slot) => (
        <EditableSlot
          key={slot.id}
          slot={slot}
          selected={selectedSlotId === slot.id}
          onPointerDown={(event) => {
            beginDrag(event, "slot", slot.id, slot.x, slot.y);
            onSelectSlot?.(slot.id);
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 1;
            const delta =
              event.key === "ArrowLeft"
                ? [-step, 0]
                : event.key === "ArrowRight"
                  ? [step, 0]
                  : event.key === "ArrowUp"
                    ? [0, -step]
                    : event.key === "ArrowDown"
                      ? [0, step]
                      : undefined;
            if (!delta) return;
            event.preventDefault();
            onMoveSlot(slot.id, slot.x + delta[0], slot.y + delta[1]);
          }}
        />
      ))}
      {onResizeItem && selectedItem?.face === face && "moduleSlots" in layout && (() => {
        const value = templateItemValue(layout, selectedItem);
        if (!value || !("x" in value) || (!("width" in value) && !("radius" in value))) return null;
        const x = value.x + ("width" in value ? value.width : value.radius);
        const y = value.y + ("height" in value ? value.height : 0);
        return <rect data-testid="template-resize-handle" x={x-6} y={y-6} width={12} height={12} fill="var(--color-warning)" stroke="var(--color-bg)" className="cursor-nwse-resize" role="button" tabIndex={0} aria-label={t("Resize item")}
          onPointerDown={event => {event.stopPropagation(); onEditStart?.(); const svg = event.currentTarget.ownerSVGElement!; svg.focus(); svg.setPointerCapture(event.pointerId); setDrag({kind: "element", id: selectedItem.id, offsetX: 0, offsetY: 0, pointerId: event.pointerId, resize: selectedItem});}} />;
      })()}
    </svg>
  );
}

function Primitive({
  primitive,
  selected = false,
  onPointerDown,
}: {
  primitive: PhysicalFacePrimitiveV1;
  selected?: boolean;
  onPointerDown?: (event: ReactPointerEvent<SVGElement>) => void;
}) {
  const interactive = onPointerDown ? "cursor-move" : undefined;
  if (primitive.kind === "label") {
    return (
      <text
        x={primitive.x}
        y={primitive.y}
        textAnchor={primitive.align ?? "start"}
        fill={physicalItemColor(primitive.color, "var(--color-fg-subtle)")}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize="15"
        className={interactive}
        onPointerDown={onPointerDown}
      >
        {primitive.text}
      </text>
    );
  }
  if (primitive.kind === "screw" || primitive.kind === "indicator") {
    return (
      <circle
        cx={primitive.x}
        cy={primitive.y}
        r={primitive.radius}
        fill={fillOf(primitive)}
        stroke="var(--color-line-strong)"
        strokeWidth={selected ? "5" : "2"}
        className={interactive}
        onPointerDown={onPointerDown}
      />
    );
  }
  if (!("width" in primitive)) return null;
  return (
    <rect
      x={primitive.x}
      y={primitive.y}
      width={primitive.width}
      height={primitive.height}
      rx={primitive.kind === "handle" ? 8 : 3}
      fill={fillOf(primitive)}
      stroke="var(--color-line-strong)"
      strokeWidth={selected ? "5" : "2"}
      strokeDasharray={primitive.kind === "vent" ? "5 5" : undefined}
      className={interactive}
      onPointerDown={onPointerDown}
    />
  );
}

function EditableSlot({
  slot,
  selected,
  onPointerDown,
  onKeyDown,
}: {
  slot: PhysicalPortSlotV1;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => void;
}) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={slot.label ?? slot.id}
      className="cursor-move outline-none"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <title>{slot.label ?? slot.id}</title>
      <rect
        x={slot.x}
        y={slot.y}
        width={slot.width}
        height={slot.height}
        rx={slot.connector === "rj45" ? 3 : 1.5}
        fill={physicalItemColor(slot.color, "var(--color-bg)")}
        stroke={selected ? "var(--color-warning)" : "var(--color-accent)"}
        strokeWidth={selected ? 5 : 3}
      />
      <text
        x={slot.x + slot.width / 2}
        y={slot.y + slot.height + 12}
        textAnchor="middle"
        fill="var(--color-fg-subtle)"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontSize="10"
      >
        {slot.label ?? slot.id}
      </text>
    </g>
  );
}
