import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { formatPortEndpointLabel } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardLabel,
  CardHeading,
  CardBody,
} from "@/components/ui/Card";
import type { ReactNode } from "react";
import type { VisualizerModel, TraceModeState } from "./types";
function LayoutField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0 text-xs">
      {label}
      {children}
    </label>
  );
}
export function TracePicker({
  model,
  traceMode,
  onTracePortSelect,
  onClearTrace,
  eligiblePortIds,
  showMessage = true,
}: {
  eligiblePortIds?: Set<string>;
  showMessage?: boolean;
  model: VisualizerModel;
  traceMode: TraceModeState;
  onTracePortSelect: (deviceId: string, portId: string) => void;
  onClearTrace: () => void;
}) {
  const { t } = useI18n();
  const traceDevices = useMemo(
    () =>
      model.nodes
        .filter((node) =>
          (model.portsByDeviceId[node.device.id] ?? []).some(
            (port) => !eligiblePortIds || eligiblePortIds.has(port.id),
          ),
        )
        .sort((a, b) => a.device.hostname.localeCompare(b.device.hostname)),
    [model, eligiblePortIds],
  );
  const [deviceId, setDeviceId] = useState(traceDevices[0]?.device.id ?? "");
  const devicePorts = useMemo(
    () =>
      deviceId
        ? (model.portsByDeviceId[deviceId] ?? []).filter(
            (port) => !eligiblePortIds || eligiblePortIds.has(port.id),
          )
        : [],
    [deviceId, model.portsByDeviceId, eligiblePortIds],
  );
  const [portId, setPortId] = useState(devicePorts[0]?.id ?? "");

  useEffect(() => {
    if (traceDevices.some((node) => node.device.id === deviceId)) return;
    setDeviceId(traceDevices[0]?.device.id ?? "");
  }, [deviceId, traceDevices]);

  useEffect(() => {
    if (devicePorts.some((port) => port.id === portId)) return;
    setPortId(devicePorts[0]?.id ?? "");
  }, [devicePorts, portId]);

  const firstPort = traceMode.firstPortId
    ? model.portById[traceMode.firstPortId]
    : undefined;
  const firstDevice = firstPort
    ? model.deviceById[firstPort.deviceId]
    : undefined;

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Trace")}</CardLabel>
          <CardHeading>{t("Device and port")}</CardHeading>
        </CardTitle>
        {traceMode.firstPortId && (
          <Button variant="ghost" size="sm" onClick={onClearTrace}>
            {t("Reset")}
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {firstPort && firstDevice && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--accent-primary-border)] bg-[var(--accent-primary)]/8 px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              {t("Start port")}
            </div>
            <div className="mt-1 truncate text-xs text-[var(--text-primary)]">
              {firstDevice.hostname} / {firstPort.name}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <LayoutField label={t("Device")}>
            <select
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              className="rk-control h-8 w-full px-2 text-xs text-[var(--text-primary)]"
              data-testid="trace-device-select"
            >
              {traceDevices.map((node) => (
                <option key={node.device.id} value={node.device.id}>
                  {node.device.hostname}
                </option>
              ))}
            </select>
          </LayoutField>
          <LayoutField label={t("Port")}>
            <select
              value={portId}
              onChange={(event) => setPortId(event.target.value)}
              className="rk-control h-8 w-full px-2 text-xs text-[var(--text-primary)]"
              data-testid="trace-port-select"
            >
              {devicePorts.map((port) => (
                <option key={port.id} value={port.id}>
                  {formatPortEndpointLabel(
                    port,
                    model.deviceById[port.deviceId],
                  )}
                </option>
              ))}
            </select>
          </LayoutField>
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={
            !traceDevices.some((node) => node.device.id === deviceId) ||
            !devicePorts.some((port) => port.id === portId)
          }
          onClick={() => onTracePortSelect(deviceId, portId)}
          data-testid="trace-submit"
        >
          {traceMode.firstPortId ? t("Trace to port") : t("Set start port")}
        </Button>
        {showMessage && traceMode.message && (
          <div className="text-xs text-[var(--text-tertiary)]">
            {traceMode.message}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
