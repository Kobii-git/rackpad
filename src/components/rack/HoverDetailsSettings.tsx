import { useI18n } from "@/i18n";
import { useStore } from "@/lib/store";
import {
  DEFAULT_SUMMARY_FIELDS,
  SUMMARY_FIELDS,
  SUMMARY_LABELS,
} from "@/lib/device-summary";
import { useSummaryPreferences } from "@/lib/device-summary-preferences";
import { Button } from "@/components/ui/Button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";

export function HoverDetailsSettings() {
  const { t } = useI18n();
  const userId = useStore((state) => state.currentUser?.id ?? "");
  const { fields, save } = useSummaryPreferences(userId);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          {t("Hover details")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-[150] space-y-3 p-3"
        aria-label={t("Hover details")}
      >
        <fieldset className="grid grid-cols-2 gap-2 text-xs">
          <legend className="mb-2 font-semibold">{t("Hover details")}</legend>
          {SUMMARY_FIELDS.map((field) => (
            <label key={field} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={fields.includes(field)}
                disabled={fields.length === 1 && fields.includes(field)}
                onChange={(event) =>
                  save(
                    event.target.checked
                      ? [...fields, field]
                      : fields.filter((item) => item !== field),
                  )
                }
              />
              {t(SUMMARY_LABELS[field])}
            </label>
          ))}
        </fieldset>
        <Button
          size="sm"
          variant="outline"
          onClick={() => save(DEFAULT_SUMMARY_FIELDS)}
        >
          {t("Reset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
