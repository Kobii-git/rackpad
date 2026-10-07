import { reorderTemplateArtwork } from "@/lib/template-artwork";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { HardwareTemplateV1, HardwareModuleV1 } from "@/lib/types";
import {
  templateItems,
  templateItemValue,
  transferTemplateItem,
  updateModuleGrid,
  updateTemplateItem,
  type TemplateItem,
} from "@/lib/hardware-template-editing";

export function HexColorInput({
  value,
  onChange,
}: {
  value?: string;
  onChange: (color: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const valid = text === "" || /^#[0-9a-f]{6}$/i.test(text);
  return (
    <div className="space-y-1" data-testid="template-item-color">
      <label className="block text-xs">
        {t("Color")}
        <div className="flex gap-2">
          <input
            type="color"
            value={value ?? "#7a7a7a"}
            aria-label={t("Color")}
            onChange={(event) => {
              setText(event.target.value);
              onChange(event.target.value);
            }}
          />
          <Input
            value={text}
            aria-label={t("Color")}
            aria-invalid={!valid}
            onChange={(event) => {
              const next = event.target.value;
              setText(next);
              if (!next || /^#[0-9a-f]{6}$/i.test(next))
                onChange(next.toLowerCase());
            }}
          />
        </div>
      </label>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setText("");
          onChange("");
        }}
      >
        {t("Reset")}
      </Button>
      {!valid && (
        <div role="alert" className="text-xs text-[var(--danger)]">
          {t("Use a six-digit hexadecimal color.")}
        </div>
      )}
    </div>
  );
}

function ModuleGrid({
  module,
  apply,
}: {
  module: HardwareModuleV1;
  apply: (count: number, rows: number, columns: number) => void;
}) {
  const { t } = useI18n();
  const [count, setCount] = useState(module.portSlots.length);
  const [rows, setRows] = useState(
    module.portGrid?.rows ?? (count > 2 ? 2 : 1),
  );
  const [columns, setColumns] = useState(
    module.portGrid?.columns ?? Math.ceil(count / rows),
  );
  if (!module.portSlots.length) return null;
  return (
    <div
      className="flex flex-wrap items-end gap-2"
      data-testid="template-module-grid"
    >
      {(
        [
          [t("Ports"), count, setCount],
          [t("Rows"), rows, setRows],
          [t("Columns"), columns, setColumns],
        ] as const
      ).map(([label, value, setValue]) => (
        <label className="text-xs" key={label}>
          {label}
          <Input
            className="w-20"
            type="number"
            min={1}
            max={16}
            value={value}
            onChange={(event) => setValue(Number(event.target.value))}
          />
        </label>
      ))}
      <Button size="sm" onClick={() => apply(count, rows, columns)}>
        {t("Update")}
      </Button>
    </div>
  );
}

export function TemplateItemControls({
  draft,
  selected,
  onSelect,
  onChange,
}: {
  draft: HardwareTemplateV1;
  selected?: TemplateItem;
  onSelect: (item: TemplateItem) => void;
  onChange: (template: HardwareTemplateV1) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [statusVersion, setStatusVersion] = useState(0);
  const items = templateItems(draft);
  const key = (item: TemplateItem) =>
    `${item.kind}:${item.moduleId ?? ""}:${item.face}:${item.id}`;
  const value = selected ? templateItemValue(draft, selected) : undefined;
  function apply(operation: () => HardwareTemplateV1) {
    try {
      onChange(operation());
      setError("");
    } catch {
      setError(t("Could not update template item."));
    }
  }
  return (
    <section
      className="space-y-3 rounded border border-[var(--border-default)] p-3"
      data-testid="template-item-controls"
    >
      <label className="block text-xs">
        {t("Physical layout")}
        <select
          className="rk-control mt-1 w-full"
          value={selected && value ? key(selected) : ""}
          onChange={(event) => {
            const next = items.find((item) => key(item) === event.target.value);
            if (next) {
              onSelect(next);
              setError("");
            }
          }}
        >
          <option value="">{t("Select")}</option>
          {items.map((item) => (
            <option key={key(item)} value={key(item)}>
              {item.moduleId
                ? t("{value1}: {name}", {
                    value1: item.moduleId,
                    name: item.id,
                  })
                : item.id}{" "}
              · {t(item.face === "front" ? "Front" : "Rear")}
            </option>
          ))}
        </select>
      </label>
      {selected && value && (
        <>
          {(selected.kind === "element" ||
            selected.kind === "port" ||
            selected.kind === "block") && (
            <HexColorInput
              value={"color" in value ? String(value.color ?? "") : undefined}
              onChange={(color) =>
                apply(() => updateTemplateItem(draft, selected, { color }))
              }
            />
          )}
          {"x" in value && (
            <div className="flex flex-wrap gap-2">
              {(["width", "height", "radius"] as const)
                .filter((field) => field in value)
                .map((field) => (
                  <label className="text-xs" key={field}>
                    {field === "radius" ? (
                      <code>r</code>
                    ) : (
                      t(field === "width" ? "Width" : "Height")
                    )}
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      value={Number(
                        (value as unknown as Record<string, number>)[field],
                      )}
                      onChange={(event) =>
                        apply(() =>
                          updateTemplateItem(draft, selected, {
                            [field]: Number(event.target.value),
                          }),
                        )
                      }
                    />
                  </label>
                ))}
            </div>
          )}
          {selected.kind === "module" && (
            <ModuleGrid
              key={selected.id}
              module={value as HardwareModuleV1}
              apply={(count, rows, columns) =>
                apply(() =>
                  updateModuleGrid(draft, selected.id, count, rows, columns),
                )
              }
            />
          )}
          {selected.kind === "element" && <div className="flex flex-wrap gap-2">
            {([ ["forward", "Bring forward"], ["backward", "Send backward"], ["front", "Bring to front"], ["back", "Send to back"] ] as const).map(([direction, label]) =>
              <Button key={direction} size="sm" variant="outline" onClick={() => apply(() => reorderTemplateArtwork(draft, selected.face, {elementId: selected.id, ...(selected.moduleId ? {moduleId: selected.moduleId} : {})}, direction))}>{t(label)}</Button>
            )}
          </div>}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!!selected.moduleId}
              onClick={() =>
                apply(() => {
                  const next = transferTemplateItem(draft, selected, true);
                  setStatusVersion(value => value + 1);
                  setStatus(t("Copied {name} to {face}.", {name: selected.id, face: t(selected.face === "front" ? "Rear" : "Front")}));
                  return next;
                })
              }
            >
              {t("Copy to other face")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!selected.moduleId}
              onClick={() =>
                apply(() => {
                  const next = transferTemplateItem(draft, selected, false);
                  onSelect({
                    ...selected,
                    face: selected.face === "front" ? "rear" : "front",
                  });
                  return next;
                })
              }
            >
              {t("Move to other face")}
            </Button>
          </div>
          {selected.moduleId && (
            <p className="text-xs">{t("Modules move with their positions.")}</p>
          )}
        </>
      )}
      <p role="status" aria-live="polite" className="text-xs"><span key={statusVersion}>{status}</span></p>
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
