import { useI18n } from "@/i18n";
import { Input } from "@/components/ui/Input";
import { COLOR_PRESETS, normalizeColorToCss } from "@/lib/utils";

interface ColorInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function ColorInput({
  value,
  onChange,
  placeholder = "#4a78c4 or blue",
}: ColorInputProps) {
  const { t } = useI18n();
  const normalizedValue = value.trim().toLowerCase();
  const selectedPreset = COLOR_PRESETS.find(
    (entry) =>
      entry.value === normalizedValue ||
      entry.hex.toLowerCase() === normalizedValue,
  );
  const previewColor = normalizeColorToCss(value) ?? "#7a7a7a";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_110px] gap-2">
        <select
          value={selectedPreset?.value ?? ""}
          onChange={(event) => {
            const preset = COLOR_PRESETS.find(
              (entry) => entry.value === event.target.value,
            );
            onChange(preset?.value ?? "");
          }}
          className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-fg)] focus-visible:border-[var(--color-accent-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-soft)]"
        >
          <option value="">{t("Custom / none")}</option>
          {COLOR_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5">
          <span
            className="size-3 rounded-[3px] border border-[var(--color-line-strong)]"
            style={{ backgroundColor: previewColor }}
          />
          <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
            {selectedPreset?.hex ?? (value.trim() || t("auto"))}
          </span>
        </div>
      </div>

      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
