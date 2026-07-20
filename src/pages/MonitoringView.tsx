import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ChevronDown,
  LayoutGrid,
  List,
  Plus,
  RefreshCcw,
  Search,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { useI18n } from "@/i18n";
import type { TranslationKey } from "@/i18n/translations";
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
import { api } from "@/lib/api";
import {
  createDeviceMonitorConfig,
  canEditInventory,
  runAllDeviceMonitorChecks,
  runDeviceMonitorCheck,
  runDeviceMonitorChecksForDevice,
  updateDeviceMonitorConfig,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DeviceMonitor,
  MonitorType,
  SnmpTrapLogEntry,
  SnmpTrapReceiverStatus,
} from "@/lib/types";
import { formatDeviceAddress } from "@/lib/network-labels";
import { statusLabel } from "@/lib/utils";
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
type BulkMonitorType = Exclude<MonitorType, "none" | "snmp">;

export default function MonitoringView() {
  const { t } = useI18n();
  const monitorStatusLabel = useMemo(
    (): Record<MonitorRollupStatus, string> => ({
      offline: t("Offline"),
      warning: t("Warning"),
      unknown: t("Unknown"),
      online: t("Online"),
      unmonitored: t("Unmonitored"),
    }),
    [t],
  );
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const devices = useStore((s) => s.devices);
  const deviceMonitors = useStore((s) => s.deviceMonitors);
  const canManageMonitoring = canEditInventory(currentUser, lab.id);
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
  const [bulkMonitorType, setBulkMonitorType] =
    useState<BulkMonitorType>("icmp");
  const [bulkMonitorName, setBulkMonitorName] = useState("");
  const [bulkMonitorPort, setBulkMonitorPort] = useState("");
  const [bulkMonitorPath, setBulkMonitorPath] = useState("/");
  const [bulkRunFirstCheck, setBulkRunFirstCheck] = useState(false);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [trapsOpen, setTrapsOpen] = useState(false);
  const [error, setError] = useState("");
  const [trapLog, setTrapLog] = useState<SnmpTrapLogEntry[]>([]);
  const [trapStatus, setTrapStatus] = useState<SnmpTrapReceiverStatus | null>(
    null,
  );

  useEffect(() => {
    void Promise.all([
      api.getSnmpTrapLog({ labId: lab.id, limit: 25 }),
      api.getSnmpTrapStatus(),
    ])
      .then(([log, status]) => {
        setTrapLog(log);
        setTrapStatus(status);
      })
      .catch(() => {
        setTrapLog([]);
        setTrapStatus(null);
      });
  }, [lab.id]);

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
        if (!isMonitorActive(monitor)) return acc;
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
  }, [filter, inventoryDevices, monitorStatusLabel, query, sort]);

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
      configuredTargets: inventoryDevices.reduce(
        (sum, entry) => sum + entry.allMonitors.length,
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
          : t("Failed to run all monitor checks."),
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
          : t("Failed to run device monitor checks."),
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
        t("Enabled ICMP on {count} device(s).", { count: updated }),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to enable ICMP monitoring."),
      );
    } finally {
      setBulkRunning(false);
    }
  }

  async function handleBulkCreateMonitoring() {
    if (selectedDevices.length === 0) return;
    setBulkRunning(true);
    setError("");
    setBulkMessage("");

    let updated = 0;
    let skipped = 0;
    const monitorName = bulkMonitorName.trim();
    const parsedPort = bulkMonitorPort.trim()
      ? Number.parseInt(bulkMonitorPort.trim(), 10)
      : defaultMonitorPort(bulkMonitorType);
    const monitorPath =
      bulkMonitorType === "http" || bulkMonitorType === "https"
        ? bulkMonitorPath.trim() || "/"
        : undefined;

    try {
      for (const device of selectedDevices) {
        if (!device.managementIp) {
          skipped += 1;
          continue;
        }
        const existing = (allDeviceMonitorMap[device.id] ?? []).find(
          (monitor) =>
            monitor.type === bulkMonitorType &&
            monitor.target === device.managementIp &&
            (bulkMonitorType === "icmp" ||
              Number(monitor.port ?? defaultMonitorPort(bulkMonitorType)) ===
                parsedPort) &&
            (bulkMonitorType !== "http" && bulkMonitorType !== "https"
              ? true
              : (monitor.path ?? "/") === monitorPath),
        );
        const payload = {
          name:
            monitorName ||
            defaultMonitorName(bulkMonitorType, parsedPort, monitorPath),
          type: bulkMonitorType,
          target: device.managementIp,
          port: bulkMonitorType === "icmp" ? undefined : parsedPort,
          path: monitorPath,
          enabled: true,
        };
        const monitor = existing
          ? await updateDeviceMonitorConfig(existing.id, payload)
          : await createDeviceMonitorConfig(device.id, payload);
        if (!monitor) {
          skipped += 1;
          continue;
        }
        if (bulkRunFirstCheck) {
          await runDeviceMonitorCheck(monitor.id);
        }
        updated += 1;
      }
      setBulkMessage(
        t("Created or updated {count} monitor target(s).", { count: updated }),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to create selected monitor targets."),
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
          if (!isMonitorActive(monitor)) continue;
          await updateDeviceMonitorConfig(monitor.id, { enabled: false });
          updated += 1;
        }
      }
      setBulkMessage(
        t("Disabled {count} monitor target(s).", { count: updated }),
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to disable selected monitor targets."),
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
        subtitle={t("Operations")}
        title={t("Monitoring")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {t("{monitored} of {total} monitored devices in {lab}", {
              monitored: stats.monitoredDevices,
              total: stats.inventoryDevices,
              lab: lab.name,
            })}
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
              {runningAll ? t("Running...") : t("Run all checks")}
            </Button>
          </div>
        }
      />

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <div className="grid gap-3 md:grid-cols-6">
          <MonitorStat
            label={t("Devices")}
            value={String(stats.inventoryDevices)}
            hint={t("{count} with active targets", {
              count: stats.monitoredDevices,
            })}
          />
          <MonitorStat
            label={t("Targets")}
            value={`${stats.monitorTargets} / ${stats.configuredTargets}`}
            hint={
              <>
                {t("Enabled")} / {t("Configured")}
              </>
            }
          />
          <MonitorStat
            label={t("Online")}
            value={String(stats.online)}
            hint={t("Healthy rollup state")}
            tone="ok"
          />
          <MonitorStat
            label={t("Offline")}
            value={String(stats.offline)}
            hint={t("At least one target failed")}
            tone="err"
          />
          <MonitorStat
            label={t("Unknown")}
            value={String(stats.unknown)}
            hint={t("Configured but not yet confirmed")}
            tone="neutral"
          />
          <MonitorStat
            label={t("Unmonitored")}
            value={String(stats.unmonitored)}
            hint={t("No active targets")}
            tone="neutral"
          />
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <button
            type="button"
            onClick={() => setTrapsOpen((value) => !value)}
            className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
          >
            <div>
              <div className="text-sm font-medium text-[var(--color-fg)]">
                {t("SNMP traps")}
              </div>
              <div className="text-xs text-[var(--color-fg-subtle)]">
                {t("Forward traps to UDP port {port}{status}", {
                  port: trapStatus?.port ?? 1162,
                  status: [
                    trapStatus?.listening ? ` (${t("Receiver active")})` : "",
                    trapStatus?.lastTrapAt
                      ? ` · ${t("Last trap {date}", {
                          date: new Date(
                            trapStatus.lastTrapAt,
                          ).toLocaleString(),
                        })}`
                      : "",
                  ].join(""),
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={trapStatus?.listening ? "ok" : "neutral"}>
                {t("{count} received", {
                  count: trapStatus?.trapsReceived ?? 0,
                })}
              </Badge>
              <ChevronDown
                className={`size-4 shrink-0 text-[var(--text-tertiary)] transition-transform ${trapsOpen ? "rotate-180" : ""}`}
              />
            </div>
          </button>
          {trapsOpen &&
            (trapLog.length === 0 ? (
              <EmptyState
                className="mt-3"
                title={t(
                  "No traps logged for this lab yet. Map device management IPs and enable interface monitors with ifIndex to react to linkUp/linkDown.",
                )}
              />
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
                    <tr>
                      <th className="px-2 py-1">{t("When")}</th>
                      <th className="px-2 py-1">{t("Source")}</th>
                      <th className="px-2 py-1">{t("Action")}</th>
                      <th className="px-2 py-1">{t("Message")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trapLog.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-t border-[var(--color-line)] text-[var(--color-fg)]"
                      >
                        <td className="px-2 py-2 whitespace-nowrap">
                          {new Date(entry.receivedAt).toLocaleString()}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">
                          {entry.sourceIp}
                          {entry.ifIndex != null
                            ? t("· if{ifIndex}", { ifIndex: entry.ifIndex })
                            : ""}
                        </td>
                        <td className="px-2 py-2">{entry.resultAction}</td>
                        <td className="px-2 py-2 text-[var(--color-fg-subtle)]">
                          {entry.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-[16rem] max-w-xl flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search device, target, or message...")}
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rk-kicker">{t("Layout")}</span>
            <Button
              variant={layout === "cards" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setLayout("cards")}
              className="h-8"
              aria-label={t("Show monitor cards")}
            >
              <LayoutGrid className="size-3.5" />
              {t("Box")}
            </Button>
            <Button
              variant={layout === "compact" ? "secondary" : "outline"}
              size="sm"
              onClick={() => setLayout("compact")}
              className="h-8"
              aria-label={t("Show compact monitor rows")}
            >
              <List className="size-3.5" />
              {t("Compact")}
            </Button>
            <span className="rk-kicker">{t("Sort")}</span>
            <SortButton
              active={sort.key === "hostname"}
              direction={sort.direction}
              onClick={() => handleSort("hostname")}
            >
              {t("Host")}
            </SortButton>
            <SortButton
              active={sort.key === "status"}
              direction={sort.direction}
              onClick={() => handleSort("status")}
            >
              {t("Status")}
            </SortButton>
            <SortButton
              active={sort.key === "targets"}
              direction={sort.direction}
              onClick={() => handleSort("targets")}
            >
              {t("Targets")}
            </SortButton>
            <SortButton
              active={sort.key === "lastCheck"}
              direction={sort.direction}
              onClick={() => handleSort("lastCheck")}
            >
              {t("Last check")}
            </SortButton>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterButton
            active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            {t("All")}
          </FilterButton>
          <FilterButton
            active={filter === "offline"}
            onClick={() => setFilter("offline")}
          >
            {t("Offline")}
          </FilterButton>
          <FilterButton
            active={filter === "warning"}
            onClick={() => setFilter("warning")}
          >
            {t("Warning")}
          </FilterButton>
          <FilterButton
            active={filter === "unknown"}
            onClick={() => setFilter("unknown")}
          >
            {t("Unknown")}
          </FilterButton>
          <FilterButton
            active={filter === "online"}
            onClick={() => setFilter("online")}
          >
            {t("Online")}
          </FilterButton>
          <FilterButton
            active={filter === "unmonitored"}
            onClick={() => setFilter("unmonitored")}
          >
            {t("Unmonitored")}
          </FilterButton>
        </div>

        {canManageMonitoring && (
          <Card>
            <CardBody className="space-y-3 p-3">
              <button
                type="button"
                onClick={() => setBulkOpen((value) => !value)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <div className="rk-kicker">{t("Bulk monitoring")}</div>
                  <div className="mt-1 text-xs text-[var(--text-tertiary)]">
                    {t("{selected} selected | {targets} configured target(s)", {
                      selected: selectedDevices.length,
                      targets: selectedMonitorCount,
                    })}
                  </div>
                </div>
                <ChevronDown
                  className={`size-4 shrink-0 text-[var(--text-tertiary)] transition-transform ${bulkOpen ? "rotate-180" : ""}`}
                />
              </button>
              {bulkOpen && (
                <>
                  <div className="grid gap-3 lg:grid-cols-[0.8fr_1fr_0.55fr_0.8fr_auto]">
                    <label className="block">
                      <span className="rk-field-label">{t("Type")}</span>
                      <Select
                        value={bulkMonitorType}
                        onChange={(value) =>
                          setBulkMonitorType(value as BulkMonitorType)
                        }
                      >
                        <option value="icmp">{t("ICMP")}</option>
                        <option value="tcp">{t("TCP")}</option>
                        <option value="http">{t("HTTP")}</option>
                        <option value="https">{t("HTTPS")}</option>
                      </Select>
                    </label>
                    <label className="block">
                      <span className="rk-field-label">{t("Name")}</span>
                      <Input
                        value={bulkMonitorName}
                        onChange={(event) =>
                          setBulkMonitorName(event.target.value)
                        }
                        placeholder={defaultMonitorName(
                          bulkMonitorType,
                          defaultMonitorPort(bulkMonitorType),
                        )}
                      />
                    </label>
                    {bulkMonitorType !== "icmp" ? (
                      <label className="block">
                        <span className="rk-field-label">{t("Port")}</span>
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          value={bulkMonitorPort}
                          onChange={(event) =>
                            setBulkMonitorPort(event.target.value)
                          }
                          placeholder={String(
                            defaultMonitorPort(bulkMonitorType),
                          )}
                        />
                      </label>
                    ) : (
                      <div />
                    )}
                    {bulkMonitorType === "http" ||
                    bulkMonitorType === "https" ? (
                      <label className="block">
                        <span className="rk-field-label">{t("Path")}</span>
                        <Input
                          value={bulkMonitorPath}
                          onChange={(event) =>
                            setBulkMonitorPath(event.target.value)
                          }
                          placeholder="/"
                        />
                      </label>
                    ) : (
                      <div />
                    )}
                    <label className="flex items-end gap-2 pb-2 text-xs text-[var(--text-tertiary)]">
                      <input
                        type="checkbox"
                        checked={bulkRunFirstCheck}
                        onChange={(event) =>
                          setBulkRunFirstCheck(event.target.checked)
                        }
                        className="accent-[var(--color-accent)]"
                      />
                      {t("Run first check")}
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={selectFilteredDevices}
                      disabled={filteredDevices.length === 0 || bulkRunning}
                    >
                      {t("Select filtered")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedDeviceIds(new Set())}
                      disabled={selectedDevices.length === 0 || bulkRunning}
                    >
                      {t("Clear")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleBulkCreateMonitoring()}
                      disabled={selectedDevices.length === 0 || bulkRunning}
                    >
                      <Plus className="size-3.5" />
                      {t("Add / enable target")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleBulkEnableIcmp()}
                      disabled={selectedDevices.length === 0 || bulkRunning}
                    >
                      {t("Enable ICMP")}
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
                      {t("Disable targets")}
                    </Button>
                  </div>
                </>
              )}
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

        <Card>
          <CardHeader>
            <CardTitle>
              <CardLabel>{t("Overview")}</CardLabel>
              <CardHeading>{t("Inventory monitoring")}</CardHeading>
            </CardTitle>
            <div className="inline-flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
              <Search className="size-3.5" />
              {t("Filter by host, target, or latest monitor message")}
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            {filteredDevices.length === 0 ? (
              <EmptyState
                icon={Search}
                title={
                  stats.inventoryDevices === 0
                    ? t("No devices in this lab yet")
                    : t("No devices match the current filter")
                }
                description={
                  stats.inventoryDevices === 0
                    ? t(
                        "Add inventory devices first, then enable monitoring from here or from a device page.",
                      )
                    : t(
                        "Try a broader filter or search to bring matching monitor targets back into view.",
                      )
                }
              />
            ) : (
              filteredDevices.map(
                ({ device, monitors, allMonitors, rollupStatus }) =>
                layout === "compact" ? (
                  <DeviceMonitorRow
                    key={device.id}
                    device={device}
                    monitors={monitors}
                    configuredMonitors={allMonitors}
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
                    configuredMonitors={allMonitors}
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
  configuredMonitors,
  rollupStatus,
  selected,
  onSelectedChange,
  running,
  onRun,
  canManageMonitoring,
}: {
  device: Device;
  monitors: DeviceMonitor[];
  configuredMonitors: DeviceMonitor[];
  rollupStatus: MonitorRollupStatus;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  running: boolean;
  onRun: () => void;
  canManageMonitoring: boolean;
}) {
  const { t, formatRelativeTime } = useI18n();
  const monitorStatusLabel = useMemo(
    (): Record<MonitorRollupStatus, string> => ({
      offline: t("Offline"),
      warning: t("Warning"),
      unknown: t("Unknown"),
      online: t("Online"),
      unmonitored: t("Unmonitored"),
    }),
    [t],
  );
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
    <div
      data-testid="device-monitor-card"
      data-device-id={device.id}
      className="rk-panel-inset rounded-[var(--radius-md)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {canManageMonitoring && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelectedChange(event.target.checked)}
              className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
              aria-label={t("Select {hostname}", { hostname: device.hostname })}
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
                  {t("inventory {status}", {
                    status: t(statusLabel[device.status] as TranslationKey),
                  })}
                </span>
              )}
              <span>
                {t("Enabled")}: {monitors.length} | {t("Configured")}: {" "}
                {configuredMonitors.length}
              </span>
              {latestCheckAt && (
                <span>
                  {t("Last checked {time}", {
                    time: formatRelativeTime(latestCheckAt),
                  })}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {failingMonitors.length > 0 && (
            <Badge tone="err">
              {t("{count} failing", { count: failingMonitors.length })}
            </Badge>
          )}
          {unknownMonitors.length > 0 && (
            <Badge tone="neutral">
              {t("{count} unknown", { count: unknownMonitors.length })}
            </Badge>
          )}
          {configuredMonitors.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRun}
              disabled={!canManageMonitoring || running || monitors.length === 0}
            >
              <Activity className="size-3.5" />
              {running ? t("Checking...") : t("Check now")}
            </Button>
          )}
        </div>
      </div>

      {configuredMonitors.length === 0 ? (
        <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
          {t(
            "No active monitor targets. Select this device and use Enable ICMP to add one in bulk.",
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {configuredMonitors.map((monitor) => (
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
                {isMonitorActive(monitor) ? (
                  <Badge
                    tone={
                      monitor.lastResult === "online"
                        ? "ok"
                        : monitor.lastResult === "offline"
                          ? "err"
                          : "neutral"
                    }
                  >
                    {monitor.lastResult ?? t("unknown")}
                  </Badge>
                ) : (
                  <Badge tone="neutral">{t("Disabled")}</Badge>
                )}
              </div>
              <div className="mt-2 space-y-1 text-[11px] text-[var(--text-tertiary)]">
                <div>
                  <span className="text-[var(--text-muted)]">
                    {t("Target")}:
                  </span>{" "}
                  <Mono>{formatMonitorTarget(monitor)}</Mono>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">
                    {t("Last check")}:
                  </span>{" "}
                  {monitor.lastCheckAt
                    ? formatRelativeTime(monitor.lastCheckAt)
                    : t("never")}
                </div>
                <div className="text-[var(--text-secondary)]">
                  {monitor.lastMessage ?? t("No result yet.")}
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
  configuredMonitors,
  rollupStatus,
  selected,
  onSelectedChange,
  running,
  onRun,
  canManageMonitoring,
}: {
  device: Device;
  monitors: DeviceMonitor[];
  configuredMonitors: DeviceMonitor[];
  rollupStatus: MonitorRollupStatus;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  running: boolean;
  onRun: () => void;
  canManageMonitoring: boolean;
}) {
  const { t, formatRelativeTime } = useI18n();
  const monitorStatusLabel = useMemo(
    (): Record<MonitorRollupStatus, string> => ({
      offline: t("Offline"),
      warning: t("Warning"),
      unknown: t("Unknown"),
      online: t("Online"),
      unmonitored: t("Unmonitored"),
    }),
    [t],
  );
  const latestCheckAt = latestMonitorCheck(monitors);
  const failingCount = monitors.filter(
    (monitor) => monitor.lastResult === "offline",
  ).length;
  const unknownCount = monitors.filter(
    (monitor) => monitor.lastResult === "unknown" || !monitor.lastResult,
  ).length;
  const disabledCount = configuredMonitors.length - monitors.length;
  const targetSummary = configuredMonitors
    .slice(0, 3)
    .map((monitor) =>
      isMonitorActive(monitor)
        ? `${monitor.name}:${monitor.lastResult ?? "unknown"}`
        : `${monitor.name}:${t("Disabled")}`,
    )
    .join(" | ");

  return (
    <div
      data-testid="device-monitor-row"
      data-device-id={device.id}
      className="grid grid-cols-12 items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-3 py-2"
    >
      <div className="col-span-12 flex min-w-0 items-center gap-2 md:col-span-3">
        {canManageMonitoring && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange(event.target.checked)}
            className="size-4 shrink-0 accent-[var(--color-accent)]"
            aria-label={t("Select {hostname}", { hostname: device.hostname })}
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
        {monitors.length} / {configuredMonitors.length} {t("Enabled")}
      </Mono>
      <div className="col-span-12 truncate text-xs text-[var(--text-tertiary)] md:col-span-3">
        {targetSummary || formatDeviceAddress(device) || t("No target summary")}
      </div>
      <div className="col-span-8 flex items-center gap-2 md:col-span-1">
        {failingCount > 0 && (
          <Badge tone="err">
            {t("{count} failing", { count: failingCount })}
          </Badge>
        )}
        {unknownCount > 0 && (
          <Badge tone="neutral">
            {t("{count} unknown", { count: unknownCount })}
          </Badge>
        )}
        {disabledCount > 0 && (
          <Badge tone="neutral">
            {disabledCount} {t("Disabled")}
          </Badge>
        )}
        {latestCheckAt && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {formatRelativeTime(latestCheckAt)}
          </span>
        )}
      </div>
      <div className="col-span-4 flex justify-end md:col-span-1">
        {configuredMonitors.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRun}
            disabled={!canManageMonitoring || running || monitors.length === 0}
          >
            <Activity className="size-3.5" />
            {running ? t("Checking...") : t("Check")}
          </Button>
        )}
      </div>
    </div>
  );
}

function isMonitorActive(monitor: DeviceMonitor) {
  return monitor.enabled && monitor.type !== "none";
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
  if (monitor.type === "snmp") {
    return `snmp://${monitor.target}:${monitor.port ?? 161} ${monitor.snmpOid ?? ""}`.trim();
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
  hint: ReactNode;
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

function defaultMonitorPort(type: BulkMonitorType) {
  if (type === "https") return 443;
  if (type === "http") return 80;
  if (type === "tcp") return 22;
  return undefined;
}

function defaultMonitorName(
  type: BulkMonitorType,
  port?: number,
  path?: string,
) {
  if (type === "icmp") return "Management ICMP";
  if (type === "tcp") return `TCP ${port ?? 22}`;
  if (type === "http") return `HTTP ${path ?? "/"}`;
  return `HTTPS ${path ?? "/"}`;
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rk-control h-8 w-full px-2 text-sm text-[var(--text-primary)]"
    >
      {children}
    </select>
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
          {/* i18n-ignore -- v is a direction glyph, not visible copy. */}
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
