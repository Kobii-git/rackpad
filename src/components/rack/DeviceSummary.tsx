import { useI18n } from "@/i18n";
import type { Device } from "@/lib/types";

export type DeviceSummaryData = Pick<
  Device,
  | "hostname"
  | "displayName"
  | "manufacturer"
  | "model"
  | "managementIp"
  | "macAddress"
>;

/** Shared inventory details for classic racks and zoomable device canvases. */
export function DeviceSummary({ device }: { device: DeviceSummaryData }) {
  const { t } = useI18n();
  const name = device.displayName?.trim() || device.hostname;
  const hardware = [device.manufacturer?.trim(), device.model?.trim()]
    .filter(Boolean)
    .join(" ");
  return (
    <span className="flex flex-col gap-1" data-testid="device-summary">
      <span className="break-all font-medium">{name}</span>
      {name !== device.hostname && (
        <span className="break-all font-mono">{device.hostname}</span>
      )}
      {hardware && <span>{hardware}</span>}
      {device.managementIp?.trim() && (
        <span>
          {t("IP")}: {device.managementIp.trim()}
        </span>
      )}
      {device.macAddress?.trim() && (
        <span>
          {t("MAC")}: {device.macAddress.trim()}
        </span>
      )}
    </span>
  );
}
