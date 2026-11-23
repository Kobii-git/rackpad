import { useI18n } from "@/i18n";
import type { FaceDefinitionV1 } from "@/lib/types";

export function FaceAppearanceControls({
  definition,
  disabled,
  onChange,
}: {
  definition: FaceDefinitionV1;
  disabled?: boolean;
  onChange: (definition: FaceDefinitionV1) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2" data-testid="face-appearance-controls">
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-xs">
          <span className="block">{t("Chassis skin")}</span>
          <select
            className="rk-control h-8 px-2"
            disabled={disabled}
            value={definition.skin ?? ""}
            onChange={(event) =>
              onChange({
                ...definition,
                skin: event.target.value
                  ? (event.target.value as FaceDefinitionV1["skin"])
                  : undefined,
              })
            }
          >
            <option value="">{t("Automatic")}</option>
            <option value="graphite">{t("Graphite")}</option>
            <option value="silver">{t("Silver")}</option>
            <option value="ivory">{t("Ivory")}</option>
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="block">{t("Orientation")}</span>
          <select
            className="rk-control h-8 px-2"
            disabled={disabled}
            value={definition.rotation ?? 0}
            onChange={(event) =>
              onChange({
                ...definition,
                rotation: Number(
                  event.target.value,
                ) as FaceDefinitionV1["rotation"],
              })
            }
          >
            {[0, 90, 180, 270].map((value) => (
              <option key={value} value={value}>
                {value}°
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {t("Rotation keeps the assigned rack footprint.")}
      </p>
    </div>
  );
}
