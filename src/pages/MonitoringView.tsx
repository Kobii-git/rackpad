import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, LayoutGrid, List, RefreshCcw, Search } from "lucide-react";
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
  createDeviceMonitorConfig,
  runAllDeviceMonitorChecks,
  runDeviceMonitorChecksForDevice,
  updateDeviceMonitorConfig,
  useStore,
} from "@/lib/store";
import type { Device, DeviceMonitor } from "@/lib/types";
import { formatDeviceAddress } from "@/lib/network-labels";
import { relativeTime, statusLabel } from "@/lib/utils";
import {
  applySortDirection,
  compareDate,
  compareNumber,
  compareText,
  toggleSort,
  type SortState,
} from "@/lib/sort";

type MonitorFilter =
  | "all"
  | "offline"
  | "warning"
  | "unknown"
  | "online"
  | "unmonitored";
type MonitorRollupStatus = Exclude<MonitorFilter, "all">;
type MonitorSortKey = "hostname" | "status" | "targets" | "lastCheck";
type MonitorLayout = "cards" | "compact";

const monitorStatusLabel: Record<MonitorRollupStatus, string> = {
  offline: "Offline",
  warning: "Warning",
  unknown: "Unknown",
  online: "Online",
  unmonitored: "Unmonitored",
};

export default function MonitoringView() {
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const devices = useStore((s) => s.devices);
  const deviceMonitors = useStore((s) => s.deviceMonitors);
  const canManageMonitoring = currentUser?.role === "admin";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MonitorFilter>("all");
  const [sort, setSort] = useState<SortState<MonitorSortKey>>({
    key: "hostname",
    direction: "asc",
  });
  const [layout, setLayout] = useState<MonitorLayout>("cards");
  const [runningAll, setRunningAll] = useState(false);
  const [runningDeviceId, setRunningDeviceId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkMessage, setBulkMessage] = useState("");
  const [error, setError] = useState("");

  const allDeviceMonitorMap = useMemo(() => {
    return deviceMonitors.reduce<Record<string, DeviceMonitor[]>>(
      (acc, monitor) => {
        (acc[monitor.deviceId] ??= []).push(monitor);
        return acc;
      },
      {},
    );
  }, [deviceMonitors]);

  const activeDeviceMonitorMap = useMemo(() => {
    return deviceMonitors.reduce<Record<string, DeviceMonitor[]>>(
      (acc, monitor) => {
        if (!monitor.enabled || monitor.type === "none") return acc;
        (acc[monitor.deviceId] ??= []).push(monitor);
        return acc;
      },
      {},
    );
  }, [deviceMonitors]);

  const inventoryDevices = useMemo(() => {
    return devices
      .map((device) => ({
        device,
        monitors: [...(activeDeviceMonitorMap[device.id] ?? [])].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        ),
        allMonitors: [...(allDeviceMonitorMap[device.id] ?? [])].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        ),
      }))
      .map((entry) => ({
        ...entry,
        rollupStatus: getMonitorRollupStatus(entry.device, entry.monitors),
      }));
  }, [activeDeviceMonitorMap, allDeviceMonitorMap, devices]);

  const filteredDevices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return inventoryDevices
      .filter(({ device, monitors, allMonitors, rollupStatus }) => {
        if (filter === "unmonitored" && monitors.length > 0) return false;
        if (
          filter !== "all" &&
          filter !== "unmonitored" &&
          rollupStatus !== filter
        ) {
          return false;
        }
        if (!normalizedQuery) return true;

        const haystack = [
          device.hostname,
          device.displayName,
          device.managementIp,
          device.macAddress,
          rollupStatus,
          monitorStatusLabel[rollupStatus],
          ...allMonitors.flatMap((monitor) => [
            monitor.name,
            monitor.target,
            monitor.type,
            monitor.lastResult,
            monitor.lastMessage,
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) => compareMonitorEntries(a, b, sort));
  }, [filter, inventoryDevices, query, sort]);

  const stats = useMemo(
    () => ({
      inventoryDevices: inventoryDevices.length,
      monitoredDevices: inventoryDevices.filter(
        (entry) => entry.monitors.length > 0,
      ).length,
      monitorTargets: inventoryDevices.reduce(
        (sum, entry) => sum + entry.monitors.length,
        0,
      ),
      offline: inventoryDevices.filter(
        (entry) => entry.rollupStatus === "offline",
      ).length,
      warning: inventoryDevices.filter(
        (entry) => entry.rollupStatus === "warning",
      ).length,
      unknown: inventoryDevices.filter(
        (entry) => entry.rollupStatus === "unknown",
      ).length,
      online: inventoryDevices.filter(
        (entry) => entry.rollupStatus === "online",
      ).length,
      unmonitored: inventoryDevices.filter(
        (entry) => entry.rollupStatus === "unmonitored",
      ).length,
    }),
    [inventoryDevices],
  );

  const selectedDevices = useMemo(
    () => devices.filter((device) => selectedDeviceIds.has(device.id)),
    [devices, selectedDeviceIds],
  );

  const selectedMonitorCount = useMemo(
    () =>
      selectedDevices.reduce(
        (sum, device) => sum + (allDeviceMonitorMap[device.id] ?? []).length,
        0,
      ),
    [allDeviceMonitorMap, selectedDevices],
  );

  useEffect(() => {
    const deviceIds = new Set(devices.map((device) => device.id));
    setSelectedDeviceIds((current) => {
      const next = new Set(
        [...current].filter((deviceId) => deviceIds.has(deviceId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [devices]);

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

  function toggleDeviceSelection(deviceId: string, selected: boolean) {
    setSelectedDeviceIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(deviceId);
      } else {
        next.delete(deviceId);
      }
      return next;
    });
    setBulkMessage("");
  }

  function selectFilteredDevices() {
    setSelectedDeviceIds(
      new Set(filteredDevices.map((entry) => entry.device.id)),
    );
    setBulkMessage("");
  }

  async function handleBulkEnableIcmp() {
    if (selectedDevices.length === 0) return;
    setBulkRunning(true);
    setError("");
    setBulkMessage("");
    let updated = 0;
    let skipped = 0;
    try {
      for (const device of selectedDevices) {
        if (!device.managementIp) {
          skipped += 1;
          continue;
        }
        const existingIcmp = (allDeviceMonitorMap[device.id] ?? []).find(
          (monitor) => monitor.type === "icmp",
        );
        if (existingIcmp) {
          await updateDeviceMonitorConfig(existingIcmp.id, {
            type: "icmp",
            target: device.managementIp,
            enabled: true,
          });
        } else {
          await createDeviceMonitorConfig(device.id, {
            name: "ICMP",
            type: "icmp",
            target: device.managementIp,
            enabled: true,
          });
        }
        updated += 1;
      }
      setBulkMessage(
        `Enabled ICMP monitoring for ${updated} device${
          updated === 1 ? "" : "s"
        }${skipped > 0 ? `; skipped ${skipped} without management IP` : ""}.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to enable ICMP monitoring.",
      );
    } finally {
      setBulkRunning(false);
    }
  }

  async function handleBulkDisableMonitoring() {
    if (selectedDevices.length === 0) return;
    setBulkRunning(true);
    setError("");
    setBulkMessage("");
    let updated = 0;
    try {
      for (const device of selectedDevices) {
        const monitors = allDeviceMonitorMap[device.id] ?? [];
        for (const monitor of monitors) {
          if (!monitor.enabled) continue;
          await updateDeviceMonitorConfig(monitor.id, { enabled: false });
          updated += 1;
        }
      }
      setBulkMessage(
        `Disabled ${updated} monitor target${updated === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to disable selected monitor targets.",
      );
    } finally {
      setBulkRunning(false);
    }
  }

  function handleSort(key: MonitorSortKey) {
    setSort((current) => toggleSort(current, key));
  }

  return (
    <>
      <TopBar
        subtitle="Operations"
        title="Monitoring"
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {stats.monitoredDevices}/{stats.inventoryDevices} monitored devices
            in {lab.name}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRunAll()}
              disabled={
                !canManageMonitoring || runningAll || stats.monitorTargets === 0
              }
            >
              <RefreshCcw className="size-3.5" />
              {runningAll ? "Running..." : "Run all checks"}
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-6 py-5">
        <div className="grid gap-3 md:grid-cols-6">
          <MonitorStat
            label="Devices"
            value={String(stats.inventoryDevices)}
            hint={`${stats.monitoredDevices} with active targets`}
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
          <MonitorStat
            label="Unmonitored"
            value={String(stats.unmonitored)}
            hint="No active targets"
            tone="neutral"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[16rem] max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search device, target, or message..."
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rk-kicker">Layout</span>
            <Button
              variant={layout === "cards" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setLayout("cards")}
              className="h-8"
              aria-label="Show monitor cards"
            >
              <LayoutGrid className="size-3.5" />
              Box
            </Button>
            <Button
              variant={layout === "compact" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setLayout("compact")}
              className="h-8"
              aria-label="Show compact monitor rows"
            >
              <List className="size-3.5" />
              Compact
            </Button>
            <span className="rk-kicker">Sort</span>
            <SortButton
              active={sort.key === "hostname"}
              direction={sort.direction}
              onClick={() => handleSort("hostname")}
            >
              Host
            </SortButton>
            <SortButton
              active={sort.key === "status"}
              direction={sort.direction}
              onClick={() => handleSort("status")}
            >
              Status
            </SortButton>
            <SortButton
              active={sort.key === "targets"}
              direction={sort.direction}
              onClick={() => handleSort("targets")}
            >
              Targets
            </SortButton>
            <SortButton
              active={sort.key === "lastCheck"}
              direction={sort.direction}
              onClick={() => handleSort("lastCheck")}
            >
              Last check
            </SortButton>
          </div>
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
          <FilterButton
            active={filter === "unmonitored"}
            onClick={() => setFilter("unmonitored")}
          >
            Unmonitored
          </FilterButton>
        </div>

        {canManageMonitoring && (
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="rk-kicker">Bulk monitoring</div>
                <div className="mt-1 text-xs text-[var(--text-tertiary)]">
                  {selectedDevices.length} selected | {selectedMonitorCount}{" "}
                  configured target{selectedMonitorCount === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectFilteredDevices}
                  disabled={filteredDevices.length === 0 || bulkRunning}
                >
                  Select filtered
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDeviceIds(new Set())}
                  disabled={selectedDevices.length === 0 || bulkRunning}
                >
                  Clear
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleBulkEnableIcmp()}
                  disabled={selectedDevices.length === 0 || bulkRunning}
                >
                  Enable ICMP
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleBulkDisableMonitoring()}
                  disabled={
                    selectedDevices.length === 0 ||
                    selectedMonitorCount === 0 ||
                    bulkRunning
                  }
                >
                  Disable targets
                </Button>
              </div>
              {bulkMessage && (
                <div className="basis-full rounded-[var(--radius-sm)] border border-[var(--color-ok)]/30 bg-[var(--color-ok)]/10 px-3 py-2 text-sm text-[var(--color-fg)]">
                  {bulkMessage}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {error && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
            {error}
          </div>
        )}

        <Card className="min-h-0 flex flex-1 flex-col">
          <CardHeader>
            <CardTitle>
              <CardLabel>Overview</CardLabel>
              <CardHeading>Inventory monitoring</CardHeading>
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
                  {stats.inventoryDevices === 0
                    ? "No devices in this lab yet"
                    : "No devices match the current filter"}
                </div>
                <div className="rk-empty-copy">
                  {stats.inventoryDevices === 0
                    ? "Add inventory devices first, then enable monitoring from here or from a device page."
                    : "Try a broader filter or search to bring matching monitor targets back into view."}
                </div>
              </div>
            ) : (
              filteredDevices.map(({ device, monitors, rollupStatus }) =>
                layout === "compact" ? (
                  <DeviceMonitorRow
                    key={device.id}
                    device={device}
                    monitors={monitors}
                    rollupStatus={rollupStatus}
                    selected={selectedDeviceIds.has(device.id)}
                    onSelectedChange={(selected) =>
                      toggleDeviceSelection(device.id, selected)
                    }
                    running={runningDeviceId === device.id}
                    onRun={() => void handleRunDevice(device.id)}
                    canManageMonitoring={canManageMonitoring}
                  />
                ) : (
                  <DeviceMonitorCard
                    key={device.id}
                    device={device}
                    monitors={monitors}
                    rollupStatus={rollupStatus}
                    selected={selectedDeviceIds.has(device.id)}
                    onSelectedChange={(selected) =>
                      toggleDeviceSelection(device.id, selected)
                    }
                    running={runningDeviceId === device.id}
                    onRun={() => void handleRunDevice(device.id)}
                    canManageMonitoring={canManageMonitoring}
                  />
                ),
              )
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
  rollupStatus,
  selected,
  onSelectedChange,
  running,
  onRun,
  canManageMonitoring,
}: {
  device: Device;
  monitors: DeviceMonitor[];
  rollupStatus: MonitorRollupStatus;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
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
        <div className="flex min-w-0 items-start gap-3">
          {canManageMonitoring && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelectedChange(event.target.checked)}
              className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
              aria-label={`Select ${device.hostname}`}
            />
          )}
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
              <Badge tone={monitorBadgeTone(rollupStatus)}>
                <StatusDot status={monitorDotStatus(rollupStatus)} />
                {monitorStatusLabel[rollupStatus]}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
              {device.displayName && <span>{device.displayName}</span>}
              {formatDeviceAddress(device) && (
                <Mono>{formatDeviceAddress(device)}</Mono>
              )}
              {device.status !== rollupStatus && (
                <span>
                  inventory {statusLabel[device.status].toLowerCase()}
                </span>
              )}
              <span>
                {monitors.length} target{monitors.length === 1 ? "" : "s"}
              </span>
              {latestCheckAt && (
                <span>last checked {relativeTime(latestCheckAt)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {failingMonitors.length > 0 && (
            <Badge tone="err">{failingMonitors.length} failing</Badge>
          )}
          {unknownMonitors.length > 0 && (
            <Badge tone="neutral">{unknownMonitors.length} unknown</Badge>
          )}
          {monitors.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRun}
              disabled={!canManageMonitoring || running}
            >
              <Activity className="size-3.5" />
              {running ? "Checking..." : "Check now"}
            </Button>
          )}
        </div>
      </div>

      {monitors.length === 0 ? (
        <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
          No active monitor targets. Select this device and use Enable ICMP to
          add one in bulk.
        </div>
      ) : (
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
      )}
    </div>
  );
}

function DeviceMonitorRow({
  device,
  monitors,
  rollupStatus,
  selected,
  onSelectedChange,
  running,
  onRun,
  canManageMonitoring,
}: {
  device: Device;
  monitors: DeviceMonitor[];
  rollupStatus: MonitorRollupStatus;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  running: boolean;
  onRun: () => void;
  canManageMonitoring: boolean;
}) {
  const latestCheckAt = latestMonitorCheck(monitors);
  const failingCount = monitors.filter(
    (monitor) => monitor.lastResult === "offline",
  ).length;
  const unknownCount = monitors.filter(
    (monitor) => monitor.lastResult === "unknown" || !monitor.lastResult,
  ).length;
  const targetSummary = monitors
    .slice(0, 3)
    .map((monitor) => `${monitor.name}:${monitor.lastResult ?? "unknown"}`)
    .join(" | ");

  return (
    <div className="grid grid-cols-12 items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-3 py-2">
      <div className="col-span-12 flex min-w-0 items-center gap-2 md:col-span-3">
        {canManageMonitoring && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange(event.target.checked)}
            className="size-4 shrink-0 accent-[var(--color-accent)]"
            aria-label={`Select ${device.hostname}`}
          />
        )}
        <DeviceTypeIcon
          type={device.deviceType}
          className="size-4 shrink-0 text-[var(--color-accent)]"
        />
        <Link
          to={`/devices/${device.id}`}
          className="truncate text-sm font-medium text-[var(--text-primary)] hover:text-[var(--color-accent)]"
        >
          {device.hostname}
        </Link>
      </div>
      <div className="col-span-4 md:col-span-2">
        <Badge tone={monitorBadgeTone(rollupStatus)}>
          <StatusDot status={monitorDotStatus(rollupStatus)} />
          {monitorStatusLabel[rollupStatus]}
        </Badge>
      </div>
      <Mono className="col-span-4 text-[10px] text-[var(--text-tertiary)] md:col-span-2">
        {monitors.length} targets
      </Mono>
      <div className="col-span-12 truncate text-xs text-[var(--text-tertiary)] md:col-span-3">
        {targetSummary || formatDeviceAddress(device) || "No target summary"}
      </div>
      <div className="col-span-8 flex items-center gap-2 md:col-span-1">
        {failingCount > 0 && <Badge tone="err">{failingCount} failing</Badge>}
        {unknownCount > 0 && (
          <Badge tone="neutral">{unknownCount} unknown</Badge>
        )}
        {latestCheckAt && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {relativeTime(latestCheckAt)}
          </span>
        )}
      </div>
      <div className="col-span-4 flex justify-end md:col-span-1">
        {monitors.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRun}
            disabled={!canManageMonitoring || running}
          >
            <Activity className="size-3.5" />
            {running ? "Checking..." : "Check"}
          </Button>
        )}
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

function getMonitorRollupStatus(
  device: Device,
  monitors: DeviceMonitor[],
): MonitorRollupStatus {
  if (monitors.length === 0) return "unmonitored";

  if (
    device.status === "offline" ||
    monitors.some((monitor) => monitor.lastResult === "offline")
  ) {
    return "offline";
  }

  if (
    monitors.some(
      (monitor) => monitor.lastResult === "unknown" || !monitor.lastResult,
    )
  ) {
    return "unknown";
  }

  if (device.status === "warning" || device.status === "maintenance") {
    return "warning";
  }

  if (device.status === "unknown") {
    return "unknown";
  }

  return "online";
}

function monitorBadgeTone(status: MonitorRollupStatus) {
  if (status === "online") return "ok" as const;
  if (status === "offline") return "err" as const;
  return "neutral" as const;
}

function monitorDotStatus(status: MonitorRollupStatus): Device["status"] {
  return status === "unmonitored" ? "unknown" : status;
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

function SortButton({
  active,
  direction,
  onClick,
  children,
}: {
  active: boolean;
  direction: SortState<MonitorSortKey>["direction"];
  onClick: () => void;
  children: string;
}) {
  return (
    <Button
      variant={active ? "secondary" : "outline"}
      size="sm"
      onClick={onClick}
      className="h-8"
    >
      {children}
      {active && (
        <span className="font-mono text-[9px]" aria-hidden>
          {direction === "asc" ? "^" : "v"}
        </span>
      )}
    </Button>
  );
}

function compareMonitorEntries(
  a: {
    device: Device;
    monitors: DeviceMonitor[];
    rollupStatus: MonitorRollupStatus;
  },
  b: {
    device: Device;
    monitors: DeviceMonitor[];
    rollupStatus: MonitorRollupStatus;
  },
  sort: SortState<MonitorSortKey>,
) {
  let result = 0;
  if (sort.key === "hostname") {
    result = compareText(a.device.hostname, b.device.hostname);
  } else if (sort.key === "status") {
    result = compareText(a.rollupStatus, b.rollupStatus);
  } else if (sort.key === "targets") {
    result = compareNumber(a.monitors.length, b.monitors.length);
  } else {
    result = compareDate(
      latestMonitorCheck(a.monitors),
      latestMonitorCheck(b.monitors),
    );
  }

  if (result === 0) result = compareText(a.device.hostname, b.device.hostname);
  return applySortDirection(result, sort.direction);
}

function latestMonitorCheck(monitors: DeviceMonitor[]) {
  return monitors
    .map((monitor) => monitor.lastCheckAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}
