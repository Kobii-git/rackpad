import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/Button";

export function HeaderColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <label className="rk-field-label flex items-center gap-3">
        {t("Header color")}
        <input
          type="color"
          value={value || "#334155"}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!value}
        onClick={() => onChange("")}
      >
        {t("Reset")}
      </Button>
    </div>
  );
}
