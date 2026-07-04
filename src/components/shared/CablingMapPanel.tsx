import { useMemo, useState } from "react";
import { Copy, Download } from "lucide-react";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
import {
  buildCablingMapLines,
  buildCablingMapText,
  type CablingMapMode,
} from "@/lib/cabling-map";
import type {
  Device,
  DeviceType,
  DeviceTypeDefinition,
  Port,
  PortLink,
} from "@/lib/types";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Mono } from "@/components/shared/Mono";

interface CablingMapPanelProps {
  device: Device;
  devices: Device[];
  ports: Port[];
  portLinks: PortLink[];
  deviceTypes?: DeviceTypeDefinition[];
  effectiveDeviceTypeByDeviceId?: Record<string, DeviceType>;
  className?: string;
}

const MODE_LABELS: Record<CablingMapMode, TranslationKey> = {
  direct: "Direct",
  active: "Active endpoints",
  full: "Full path",
};

export function CablingMapPanel({
  device,
  devices,
  ports,
  portLinks,
  deviceTypes,
  effectiveDeviceTypeByDeviceId,
  className,
}: CablingMapPanelProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<CablingMapMode>("active");
  const [copied, setCopied] = useState(false);
  const lines = useMemo(
    () =>
      buildCablingMapLines(
        {
          deviceId: device.id,
          devices,
          ports,
          portLinks,
          deviceTypes,
          effectiveDeviceTypeByDeviceId,
        },
        mode,
      ),
    [
      device.id,
      deviceTypes,
      devices,
      effectiveDeviceTypeByDeviceId,
      mode,
      portLinks,
      ports,
    ],
  );
  const text = buildCablingMapText(lines);

  async function copyMap() {
    await copyText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function downloadMap() {
    downloadText(`${device.hostname}-cabling-map.txt`, text);
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Cabling map")}</CardLabel>
          <CardHeading>{t("Device cabling")}</CardHeading>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as CablingMapMode)}
            className="rk-control h-8 px-2 text-xs text-[var(--text-primary)]"
            aria-label={t("Cabling map mode")}
          >
            {(Object.keys(MODE_LABELS) as CablingMapMode[]).map((entry) => (
              <option key={entry} value={entry}>
                {t(MODE_LABELS[entry])}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyMap()}
            disabled={!text}
          >
            <Copy className="size-3.5" />
            {copied ? t("Copied") : t("Copy")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadMap}
            disabled={!text}
          >
            <Download className="size-3.5" />
            {t("Download")}
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        {lines.length === 0 ? (
          <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] p-3 text-xs text-[var(--text-tertiary)]">
            {t("No ports documented")}
          </div>
        ) : (
          <div
            data-visualizer-scrollable="true"
            className="max-h-72 space-y-1 overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(0_0_0_/_0.14)] p-2"
          >
            {lines.map((line) => (
              <Mono
                key={line.portId}
                className="block whitespace-pre-wrap break-words rounded-[var(--radius-xs)] px-2 py-1 text-[11px] text-[var(--text-secondary)]"
              >
                {line.text}
              </Mono>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
