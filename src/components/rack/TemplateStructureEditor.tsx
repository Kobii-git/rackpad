import { useState, type Dispatch, type SetStateAction } from "react";
import { useI18n } from "@/i18n";
import type {
  HardwareTemplateV1,
  PhysicalFacePrimitiveV1,
  RackFace,
} from "@/lib/types";
import {
  deleteModulePosition,
  nextTemplatePartId,
  updateModulePosition,
} from "@/lib/hardware-template-builder";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const APPEARANCE_PRIMITIVES: PhysicalFacePrimitiveV1["kind"][] = [
  "panel",
  "handle",
  "vent",
  "bay",
  "display",
  "outlet",
  "screw",
  "indicator",
  "label",
];

function appearancePrimitive(
  kind: PhysicalFacePrimitiveV1["kind"],
  id: string,
  width: number,
  height: number,
): PhysicalFacePrimitiveV1 {
  if (kind === "screw" || kind === "indicator") {
    return { kind, id, x: 12, y: 12, radius: 8, tone: "dark" };
  }
  if (kind === "label") {
    return { kind, id, x: 12, y: 24, text: "Label", align: "start" };
  }
  return {
    kind,
    id,
    x: 0,
    y: 0,
    width: Math.min(100, width),
    height: Math.min(80, height),
    tone: "dark",
  };
}

export function TemplateStructureEditor({
  draft,
  setDraft,
  face,
  setFace,
  moduleSlotId,
  setModuleSlotId,
  elementId,
  setElementId,
}: {
  draft: HardwareTemplateV1;
  setDraft: Dispatch<SetStateAction<HardwareTemplateV1>>;
  face: RackFace;
  setFace: (face: RackFace) => void;
  moduleSlotId: string;
  setModuleSlotId: (id: string) => void;
  elementId: string;
  setElementId: (id: string) => void;
}) {
  const { t } = useI18n();
  const [elementKind, setElementKind] =
    useState<PhysicalFacePrimitiveV1["kind"]>("bay");
  const position = draft.moduleSlots.find((slot) => slot.id === moduleSlotId);
  const element = draft[face].elements.find((item) => item.id === elementId);
  const changeElement = (patch: Partial<PhysicalFacePrimitiveV1>) =>
    setDraft((current) => ({
      ...current,
      [face]: {
        ...current[face],
        elements: current[face].elements.map((item) =>
          item.id === elementId
            ? ({ ...item, ...patch } as PhysicalFacePrimitiveV1)
            : item,
        ),
      },
    }));
  const addElement = (source?: PhysicalFacePrimitiveV1) => {
    const id = nextTemplatePartId(
      `${face}-${elementKind}`,
      draft[face].elements.map((item) => item.id),
    );
    const next: PhysicalFacePrimitiveV1 = source
      ? { ...source, id }
      : appearancePrimitive(
          elementKind,
          id,
          draft[face].width,
          draft[face].height,
        );
    setDraft((current) => ({
      ...current,
      [face]: { ...current[face], elements: [...current[face].elements, next] },
    }));
    setElementId(id);
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section
        className="space-y-3 rounded border border-[var(--border-default)] p-3"
        data-testid="module-position-editor"
      >
        <h3 className="rk-kicker">{t("Module positions")}</h3>
        <p className="text-xs text-[var(--text-secondary)]">
          {t(
            "Modules fit into positions. Remove assigned modules before deleting a position.",
          )}{" "}
          {t("Modules move with their positions.")}
        </p>
        <label className="block text-xs">
          {t("Position")}
          <select
            className="rk-control mt-1 w-full"
            value={position?.id ?? ""}
            onChange={(event) => setModuleSlotId(event.target.value)}
          >
            <option value="">{t("New")}</option>
            {draft.moduleSlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.id} · {t(slot.face === "front" ? "Front" : "Rear")}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              const id = nextTemplatePartId(
                `${face}-module`,
                draft.moduleSlots.map((slot) => slot.id),
              );
              setDraft((current) => ({
                ...current,
                moduleSlots: [
                  ...current.moduleSlots,
                  {
                    id,
                    face,
                    x: 0,
                    y: 0,
                    width: Math.min(130, current[face].width),
                    height: Math.min(112, current[face].height),
                  },
                ],
              }));
              setModuleSlotId(id);
            }}
          >
            {t("Add")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={
              !position ||
              draft.modules.some((module) => module.slotId === position.id)
            }
            onClick={() => {
              if (position)
                setDraft((current) =>
                  deleteModulePosition(current, position.id),
                );
              setModuleSlotId("");
            }}
          >
            {t("Delete")}
          </Button>
        </div>
        {position && (
          <>
            <label className="block text-xs">
              {t("Face")}
              <select
                className="rk-control mt-1 w-full"
                value={position.face}
                onChange={(event) => {
                  const next = event.target.value as RackFace;
                  setDraft((current) =>
                    updateModulePosition(current, { ...position, face: next }),
                  );
                  setFace(next);
                }}
              >
                <option value="front">{t("Front")}</option>
                <option value="rear">{t("Rear")}</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "width", "height"] as const).map((key) => (
                <label className="text-xs" key={key}>
                  {key === "width"
                    ? t("Width")
                    : key === "height"
                      ? t("Height")
                      : t("{value1}: {name}", {
                          value1: t("Position"),
                          name: key.toUpperCase(),
                        })}
                  <Input
                    type="number"
                    value={position[key]}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value))
                        setDraft((current) =>
                          updateModulePosition(current, {
                            ...position,
                            [key]: value,
                          }),
                        );
                    }}
                  />
                </label>
              ))}
            </div>
            {draft.modules
              .filter((module) => module.slotId === position.id)
              .map((module) => (
                <div
                  key={module.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span>{module.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("Delete {name}", { name: module.name })}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        modules: current.modules.filter(
                          (item) => item.id !== module.id,
                        ),
                      }))
                    }
                  >
                    {t("Delete")}
                  </Button>
                </div>
              ))}
          </>
        )}
      </section>
      <section
        className="space-y-3 rounded border border-[var(--border-default)] p-3"
        data-testid="template-appearance-editor"
      >
        <h3 className="rk-kicker">{t("Bays and appearance")}</h3>
        <p className="text-xs text-[var(--text-secondary)]">
          {t(
            "Appearance changes do not add or delete inventory ports. Preview before applying a template.",
          )}
        </p>
        <label className="block text-xs">
          {t("Face")}
          <select
            className="rk-control mt-1 w-full"
            value={face}
            onChange={(event) => {
              setFace(event.target.value as RackFace);
              setElementId("");
            }}
          >
            <option value="front">{t("Front")}</option>
            <option value="rear">{t("Rear")}</option>
          </select>
        </label>
        <label className="block text-xs">
          {t("Physical layout")}
          <select
            className="rk-control mt-1 w-full"
            value={element?.id ?? ""}
            onChange={(event) => setElementId(event.target.value)}
          >
            <option value="">{t("New")}</option>
            {draft[face].elements.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id} ({item.kind})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          {t("Type")}
          <select
            className="rk-control mt-1 w-full"
            value={elementKind}
            onChange={(event) =>
              setElementKind(
                event.target.value as PhysicalFacePrimitiveV1["kind"],
              )
            }
          >
            {APPEARANCE_PRIMITIVES.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => addElement()}>
            {t("Add")}
          </Button>
          <Button
            size="sm"
            disabled={!element}
            onClick={() => element && addElement(element)}
          >
            {t("Duplicate")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!element}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                [face]: {
                  ...current[face],
                  elements: current[face].elements.filter(
                    (item) => item.id !== elementId,
                  ),
                },
              }))
            }
          >
            {t("Delete")}
          </Button>
        </div>
        {element && (
          <div className="grid grid-cols-2 gap-2">
            {(["x", "y", "width", "height", "radius"] as const).map((key) => {
              if (!(key in element)) return null;
              const value = (element as unknown as Record<string, number>)[key];
              return (
                <label key={key} className="text-xs">
                  {key === "width" ? (
                    t("Width")
                  ) : key === "height" ? (
                    t("Height")
                  ) : key === "radius" ? (
                    <code>r</code>
                  ) : (
                    t("{value1}: {name}", {
                      value1: t("Position"),
                      name: key.toUpperCase(),
                    })
                  )}
                  <Input
                    type="number"
                    min={key === "x" || key === "y" ? 0 : 1}
                    value={value}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next))
                        changeElement({
                          [key]: Math.max(
                            key === "x" || key === "y" ? 0 : 1,
                            next,
                          ),
                        });
                    }}
                  />
                </label>
              );
            })}
            {element.kind === "label" && (
              <label className="text-xs">
                {t("Name")}
                <Input
                  value={element.text}
                  onChange={(event) =>
                    changeElement({ text: event.target.value })
                  }
                />
              </label>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
