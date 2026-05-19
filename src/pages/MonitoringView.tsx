import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, RefreshCcw, Search } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardBody,
  CardHeader,
  CardHeading,
  CardLabel,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Mono } from "@/components/shared/Mono";
import { StatusDot } from "@/components/shared/StatusDot";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import {
  runAllDeviceMonitorChecks,
  runDeviceMonitorChecksForDevice,
  useStore,
} from "@/lib/store";
import type { Device, DeviceMonitor } from "@/lib/types";
import { relativeTime, statusLabel } from "@/lib/utils";

type MonitorFilter = "all" | "offline" | "warning" | "unknown" | "online";

export default function MonitoringView() {
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const devices = useStore((s) => s.devices);
  const deviceMonitors = useStore((s) => s.deviceMonitors);
  const canManageMonitoring = currentUser?.role === "admin";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [runningAll, setRunningAll] = useState(false);
  const [runningDeviceId, setRunningDeviceId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const deviceMonitorMap = useMemo(() => {
    return deviceMonitors.reduce<Record<string, DeviceMonitor[]>>(
      (acc, monitor) => {
        if (!monitor.enabled || monitor.type === "none") return acc;
        (acc[monitor.deviceId] ??= []).push(monitor);
        return acc;
      },
      {},
    );
  }, [deviceMonitors]);

  const monitoredDevices = useMemo(() => {
    return devices
      .filter((device) => (deviceMonitorMap[device.id] ?? []).length > 0)
      .map((device) => ({
        device,
        monitors: [...(deviceMonitorMap[device.id] ?? [])].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        ),
      }));
  }, [deviceMonitorMap, devices]);

  const filteredDevices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return monitoredDevices.filter(({ device, monitors }) => {
      if (filter !== "all" && device.status !== filter) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        device.hostname,
        device.displayName,
        device.managementIp,
        ...monitors.flatMap((monitor) => [
          monitor.name,
          monitor.target,
          monitor.lastMessage,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [filter, monitoredDevices, query]);

  const stats = useMemo(
    () => ({
      monitoredDevices: monitoredDevices.length,
      monitorTargets: monitoredDevices.reduce(
        (sum, entry) => sum + entry.monitors.length,
        0,
      ),
      offline: monitoredDevices.filter(
        (entry) => entry.device.status === "offline",
      ).length,
      warning: monitoredDevices.filter(
        (entry) => entry.device.status === "warning",
      ).length,
      unknown: monitoredDevices.filter(
        (entry) => entry.device.status === "unknown",
      ).length,
      online: monitoredDevices.filter(
        (entry) => entry.device.status === "online",
      ).length,
    }),
    [monitoredDevices],
  );

  async function handleRunAll() {
    setRunningAll(true);
    setError("");
    try {
      await runAllDeviceMonitorChecks();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to run all monitor checks.",
      );
    } finally {
      setRunningAll(false);
    }
  }

  async function handleRunDevice(deviceId: string) {
    setRunningDeviceId(deviceId);
    setError("");
    try {
      await runDeviceMonitorChecksForDevice(deviceId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to run device monitor checks.",
      );
    } finally {
      setRunningDeviceId(null);
    }
  }

  return (
    <>
      <TopBar
        subtitle="Operations"
        title="Monitoring"
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {stats.monitoredDevices} monitored devices in {lab.name}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search device, target, or message..."
              className="w-64"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRunAll()}
              disabled={
                !canManageMonitoring ||
                runningAll ||
                stats.monitorTargets === 0
              }
            >
              <RefreshCcw className="size-3.5" />
              {runningAll ? "Running..." : "Run all checks"}
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-6 py-5">
        <div className="grid gap-3 md:grid-cols-5">
          <MonitorStat
            label="Devices"
            value={String(stats.monitoredDevices)}
            hint="With active monitor targets"
          />
          <MonitorStat
            label="Targets"
            value={String(stats.monitorTargets)}
            hint="Enabled ICMP/TCP/HTTP probes"
          />
          <MonitorStat
            label="Online"
            value={String(stats.online)}
            hint="Healthy rollup state"
            tone="ok"
          />
          <MonitorStat
            label="Offline"
            value={String(stats.offline)}
            hint="At least one target failed"
            tone="err"
          />
          <MonitorStat
            label="Unknown"
            value={String(stats.unknown)}
            hint="Configured but not yet confirmed"
            tone="neutral"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterButton
            active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </FilterButton>
          <FilterButton
            active={filter === "offline"}
            onClick={() => setFilter("offline")}
          >
            Offline
          </FilterButton>
          <FilterButton
            active={filter === "warning"}
            onClick={() => setFilter("warning")}
          >
            Warning
          </FilterButton>
          <FilterButton
            active={filter === "unknown"}
            onClick={() => setFilter("unknown")}
          >
            Unknown
          </FilterButton>
          <FilterButton
            active={filter === "online"}
            onClick={() => setFilter("online")}
          >
            Online
          </FilterButton>
        </div>

        {error && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
            {error}
          </div>
        )}

        <Card className="min-h-0 flex flex-1 flex-col">
          <CardHeader>
            <CardTitle>
              <CardLabel>Overview</CardLabel>
              <CardHeading>Monitored inventory</CardHeading>
            </CardTitle>
            <div className="inline-flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
              <Search className="size-3.5" />
              Filter by host, target, or latest monitor message
            </div>
          </CardHeader>
          <CardBody className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {filteredDevices.length === 0 ? (
              <div className="rk-empty">
                <div className="rk-empty-title">
                  {stats.monitoredDevices === 0
                    ? "No monitored devices yet"
                    : "No devices match the current filter"}
                </div>
                <div className="rk-empty-copy">
                  {stats.monitoredDevices === 0
                    ? "Open a device and add one or more monitor targets to start building an operations view."
                    : "Try a broader filter or search to bring matching monitor targets back into view."}
                </div>
              </div>
            ) : (
              filteredDevices.map(({ device, monitors }) => (
                <DeviceMonitorCard
                  key={device.id}
                  device={device}
                  monitors={monitors}
                  running={runningDeviceId === device.id}
                  onRun={() => void handleRunDevice(device.id)}
                  canManageMonitoring={canManageMonitoring}
                />
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function DeviceMonitorCard({
  device,
  monitors,
  running,
  onRun,
  canManageMonitoring,
}: {
  device: Device;
  monitors: DeviceMonitor[];
  running: boolean;
  onRun: () => void;
  canManageMonitoring: boolean;
}) {
  const latestCheckAt = monitors
    .map((monitor) => monitor.lastCheckAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const failingMonitors = monitors.filter(
    (monitor) => monitor.lastResult === "offline",
  );
  const unknownMonitors = monitors.filter(
    (monitor) => monitor.lastResult === "unknown" || !monitor.lastResult,
  );

  return (
    <div className="rk-panel-inset rounded-[var(--radius-md)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <DeviceTypeIcon
              type={device.deviceType}
              className="size-4 text-[var(--color-accent)]"
            />
            <Link
              to={`/devices/${device.id}`}
              className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--color-accent)]"
            >
              {device.hostname}
            </Link>
            <Badge
              tone={
                device.status === "online"
                  ? "ok"
                  : device.status === "offline"
                    ? "err"
                    : "neutral"
              }
            >
              <StatusDot status={device.status} />
              {statusLabel[device.status]}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
            {device.displayName && <span>{device.displayName}</span>}
            {device.managementIp && <Mono>{device.managementIp}</Mono>}
            <span>
              {monitors.length} target{monitors.length === 1 ? "" : "s"}
            </span>
            {latestCheckAt && (
              <span>last checked {relativeTime(latestCheckAt)}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {failingMonitors.length > 0 && (
            <Badge tone="err">{failingMonitors.length} failing</Badge>
          )}
          {unknownMonitors.length > 0 && (
            <Badge tone="neutral">{unknownMonitors.length} unknown</Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRun}
            disabled={!canManageMonitoring || running}
          >
            <Activity className="size-3.5" />
            {running ? "Checking..." : "Check now"}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {monitors.map((monitor) => (
          <div
            key={monitor.id}
            className="rk-panel rounded-[var(--radius-md)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                  {monitor.name}
                </div>
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  {monitor.type}
                </div>
              </div>
              <Badge
                tone={
                  monitor.lastResult === "online"
                    ? "ok"
                    : monitor.lastResult === "offline"
                      ? "err"
                      : "neutral"
                }
              >
                {monitor.lastResult ?? "unknown"}
              </Badge>
            </div>
            <div className="mt-2 space-y-1 text-[11px] text-[var(--text-tertiary)]">
              <div>
                <span className="text-[var(--text-muted)]">Target:</span>{" "}
                <Mono>{formatMonitorTarget(monitor)}</Mono>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Last check:</span>{" "}
                {monitor.lastCheckAt
                  ? relativeTime(monitor.lastCheckAt)
                  : "never"}
              </div>
              <div className="text-[var(--text-secondary)]">
                {monitor.lastMessage ?? "No result yet."}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatMonitorTarget(monitor: DeviceMonitor) {
  if (!monitor.target) return "n/a";
  if (monitor.type === "http" || monitor.type === "https") {
    const port = monitor.port ?? (monitor.type === "https" ? 443 : 80);
    const path = monitor.path?.trim() || "/";
    return `${monitor.type}://${monitor.target}:${port}${path.startsWith("/") ? path : `/${path}`}`;
  }
  if (monitor.type === "tcp") {
    return `${monitor.target}:${monitor.port ?? 22}`;
  }
  return monitor.target;
}

function MonitorStat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "ok" | "err";
}) {
  const toneClass =
    tone === "ok"
      ? "text-[var(--color-ok)]"
      : tone === "err"
        ? "text-[var(--color-err)]"
        : "text-[var(--color-fg)]";

  return (
    <div className="rk-panel-inset rounded-[var(--radius-md)] p-3">
      <div className="rk-kicker">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tracking-[-0.03em] ${toneClass}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">{hint}</div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
