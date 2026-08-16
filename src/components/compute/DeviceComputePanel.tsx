import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Cpu, ExternalLink, Network } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
import { selectComputeInventory } from "@/lib/compute";
import { localizedDeviceTypeIdLabel } from "@/lib/device-types";
import { useStore } from "@/lib/store";
import { statusLabel } from "@/lib/utils";

export function DeviceComputePanel({ deviceId }: { deviceId: string }) {
  const { t } = useI18n();
  const devices = useStore((state) => state.devices);
  const deviceTypes = useStore((state) => state.deviceTypes);
  const ports = useStore((state) => state.ports);
  const virtualSwitches = useStore((state) => state.virtualSwitches);
  const inventory = useMemo(
    () => selectComputeInventory(devices, deviceTypes),
    [devices, deviceTypes],
  );
  const host = devices.find((device) => device.id === deviceId);
  const guests = inventory.guestsByHostId[deviceId] ?? [];
  const switches = virtualSwitches.filter(
    (entry) => entry.hostDeviceId === deviceId,
  );

  if (!host) return null;

  return (
    <div className="space-y-4" data-testid="device-compute-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-1)] p-3">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <ComputeMetric
            label={t("Status")}
            value={t(statusLabel[host.status] as TranslationKey)}
          />
          <ComputeMetric
            label={t("CPU")}
            value={String(host.cpuCores ?? "—")}
          />
          <ComputeMetric
            label={t("Memory GB")}
            value={String(host.memoryGb ?? "—")}
          />
          <ComputeMetric
            label={t("Storage GB")}
            value={String(host.storageGb ?? "—")}
          />
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/compute">
            {t("Compute")}
            <ExternalLink className="size-3.5" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>{t("Virtualization inventory")}</CardLabel>
              <CardHeading>
                {t("Guest members")} · {guests.length}
              </CardHeading>
            </CardTitle>
            <Cpu className="size-4 text-[var(--text-muted)]" />
          </CardHeader>
          <CardBody className="space-y-2">
            {guests.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)]">
                {t("Guest members")}: 0
              </div>
            ) : (
              guests.map((guest) => (
                <Link
                  key={guest.id}
                  to={`/devices/${guest.id}`}
                  className="block rounded-[var(--radius-sm)] border border-[var(--border-default)] p-3 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                  data-testid={`compute-guest-${guest.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 break-words font-medium">
                      {guest.displayName || guest.hostname}
                    </span>
                    <Badge tone={guest.status === "online" ? "ok" : "neutral"}>
                      {t(statusLabel[guest.status] as TranslationKey)}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-[var(--text-secondary)]">
                    {localizedDeviceTypeIdLabel(
                      guest.deviceType,
                      deviceTypes,
                      t,
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px] text-[var(--text-muted)]">
                    <span>
                      {t("CPU")}: {guest.cpuCores ?? "—"}
                    </span>
                    <span>
                      {t("Memory GB")}: {guest.memoryGb ?? "—"}
                    </span>
                    <span>
                      {t("Storage GB")}: {guest.storageGb ?? "—"}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>{t("Network")}</CardLabel>
              <CardHeading>
                {t("Virtual switches")} · {switches.length}
              </CardHeading>
            </CardTitle>
            <Network className="size-4 text-[var(--text-muted)]" />
          </CardHeader>
          <CardBody className="space-y-2">
            {switches.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Network className="size-4" />
                {t("Virtual switches")}: 0
              </div>
            ) : (
              switches.map((entry) => {
                const memberCount = ports.filter(
                  (port) => port.virtualSwitchId === entry.id,
                ).length;
                return (
                  <Link
                    key={entry.id}
                    to="/compute"
                    className="block rounded-[var(--radius-sm)] border border-[var(--border-default)] p-3 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
                    data-testid={`compute-switch-${entry.id}`}
                  >
                    <div className="font-medium">{entry.name}</div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {entry.kind} · {t("Ports")}: {memberCount}
                    </div>
                    {entry.notes && (
                      <div className="mt-2 text-xs text-[var(--text-secondary)]">
                        {entry.notes}
                      </div>
                    )}
                  </Link>
                );
              })
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function ComputeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}
