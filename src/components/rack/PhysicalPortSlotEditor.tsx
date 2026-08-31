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
  layout: HardwareTemplateV1 | ResolvedPhysicalLayoutV1;
  face: RackFace;
  selectedSlotId?: string;
  className?: string;
  onSelectSlot?: (slotId: string) => void;
  onMoveSlot: (slotId: string, x: number, y: number) => void;
}

function faceOf(
  layout: HardwareTemplateV1 | ResolvedPhysicalLayoutV1,
  face: RackFace,
): FaceDefinitionV1 {
  return "faces" in layout ? layout.faces[face] : layout[face];
}

function fillOf(primitive: PhysicalFacePrimitiveV1) {
  const tone = "tone" in primitive ? primitive.tone : undefined;
  if (tone === "accent") return "var(--color-accent)";
  if (tone === "dark") return "var(--color-bg)";
  if (tone === "light") return "var(--color-line-strong)";
  return "var(--color-surface)";
}

export function PhysicalPortSlotEditor({
  layout,
  face,
  selectedSlotId,
  className,
  onSelectSlot,
  onMoveSlot,
}: PhysicalPortSlotEditorProps) {
  const { t } = useI18n();
  const definition = faceOf(layout, face);
  const [drag, setDrag] = useState<{
    slotId: string;
    offsetX: number;
    offsetY: number;
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

  return (
    <svg
      viewBox={`0 0 ${definition.width} ${definition.height}`}
      role="application"
      aria-label={t("Physical layout")}
      className={cn(
        "block w-full touch-none rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)]",
        className,
      )}
      onPointerMove={(event) => {
        if (!drag) return;
        const next = point(event);
        onMoveSlot(drag.slotId, next.x - drag.offsetX, next.y - drag.offsetY);
      }}
      onPointerUp={() => setDrag(undefined)}
      onPointerCancel={() => setDrag(undefined)}
    >
      <rect
        width={definition.width}
        height={definition.height}
        fill="var(--color-bg)"
      />
      {definition.elements.map((primitive) => (
        <Primitive key={primitive.id} primitive={primitive} />
      ))}
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
          strokeWidth="2"
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
            const svg = event.currentTarget.ownerSVGElement;
            if (!svg) return;
            const bounds = svg.getBoundingClientRect();
            const pointerX =
              ((event.clientX - bounds.left) / bounds.width) * definition.width;
            const pointerY =
              ((event.clientY - bounds.top) / bounds.height) *
              definition.height;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({
              slotId: slot.id,
              offsetX: pointerX - slot.x,
              offsetY: pointerY - slot.y,
            });
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
    </svg>
  );
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
        strokeWidth="2"
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
      strokeWidth="2"
      strokeDasharray={primitive.kind === "vent" ? "5 5" : undefined}
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
        fill="var(--color-bg)"
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
