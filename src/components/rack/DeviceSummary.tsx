import { useI18n } from "@/i18n";
import { useStore } from "@/lib/store";
import { localizedDeviceTypeIdLabel } from "@/lib/device-types";
import {
  summaryPlacement,
  SUMMARY_FIELDS,
  type SummaryDevice,
} from "@/lib/device-summary";
import { useSummaryPreferences } from "@/lib/device-summary-preferences";

export type DeviceSummaryData = SummaryDevice;

/** One ordered summary and personal field selection across every device canvas. */
export function DeviceSummary({ device }: { device: DeviceSummaryData }) {
  const { t } = useI18n();
  const { currentUser, devices, racks, rooms, deviceTypes } = useStore(
    (state) => state,
  );
  const { fields } = useSummaryPreferences(currentUser?.id ?? "");
  const placement = summaryPlacement(device, devices, racks, rooms);
  const startU = placement.startU != null ? `U${placement.startU}` : "";
  const placementName = placement.name || (device.placement === "shelf" ? t("On this shelf / tray")
    : device.placement === "virtual" ? t("Virtual") : device.placement === "rack" ? t("Rack mounted") : device.placement ? t("Loose / room") : "");
  const values = {
    hostname: device.hostname,
    deviceType: device.deviceType
      ? localizedDeviceTypeIdLabel(device.deviceType, deviceTypes, t)
      : "",
    displayName:
      device.displayName?.trim() !== device.hostname
        ? device.displayName?.trim()
        : "",
    manufacturer: device.manufacturer?.trim(),
    model: device.model?.trim(),
    managementIp: device.managementIp?.trim()
      ? `${t("IP")}: ${device.managementIp.trim()}`
      : "",
    macAddress: device.macAddress?.trim()
      ? `${t("MAC")}: ${device.macAddress.trim()}`
      : "",
    specs: device.specs?.trim().slice(0, 240),
    placement: fields.includes("startU") && startU && placementName ? `${placementName} | ${startU}` : placementName,
    startU: fields.includes("placement") && placementName ? "" : startU,
  };
  const rows = SUMMARY_FIELDS.filter(
    (field) => fields.includes(field) && values[field],
  );
  return (
    <span className="flex flex-col gap-1" data-testid="device-summary">
      {rows.length ? (
        rows.map((field) => (
          <span
            key={field}
            data-summary-field={field}
            className={
              field === "specs"
                ? "line-clamp-3 whitespace-pre-line break-words"
                : "break-words"
            }
          >
            {values[field]}
          </span>
        ))
      ) : (
        <span>{device.hostname}</span>
      )}
    </span>
  );
}
