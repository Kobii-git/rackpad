import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Clock,
  Inbox,
  Play,
  Power,
  RefreshCcw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { TopBar } from "@/components/layout/TopBar";
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
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { SortableHeader } from "@/components/shared/SortableHeader";
import {
  canEditInventory,
  createDevice,
  createDeviceMonitorConfig,
  createDiscoveryScanSchedule,
  deleteDiscoveredDeviceRecord,
  deleteDiscoveryScanScheduleRecord,
  runDeviceMonitorCheck,
  runDiscoveryScanScheduleNow,
  scanDiscoveredSubnet,
  updateDiscoveryScanScheduleRecord,
  updateDiscoveredDeviceRecord,
  useStore,
} from "@/lib/store";
import type {
  DhcpScope,
  Device,
  DiscoveredDevice,
  DiscoveryScanResult,
  DiscoveryScanJob,
  DiscoveryScanSchedule,
  IpAllocationMode,
  IpZone,
  Subnet,
} from "@/lib/types";
import { cidrContainsIp, ipToInt } from "@/lib/utils";
import {
  applySortDirection,
  compareDate,
  compareIp,
  compareNumber,
  compareText,
  toggleSort,
  type SortState,
} from "@/lib/sort";

type DiscoveryDraft = {
  hostname: string;
  displayName: string;
  deviceType: NonNullable<DiscoveredDevice["deviceType"]>;
  placement: NonNullable<DiscoveredDevice["placement"]>;
  notes: string;
  status: DiscoveredDevice["status"];
};

type DiscoveryFilter =
  | "active"
  | "all"
  | "new"
  | "imported"
  | "dismissed"
  | "duplicates"
  | "technical";
type DiscoverySortKey =
  | "ip"
  | "hostname"
  | "type"
  | "placement"
  | "vendor"
  | "match"
  | "status"
  | "lastSeen";
type DiscoveryScanTarget = "all" | "manual" | string;

const PLACEMENT_HINT_KEYS: Record<string, TranslationKey> = {
  "wifi-vlan-match": "Placed by VLAN/SSID match",
  "loose-multiple-aps": "Left loose: multiple APs",
  "loose-no-wifi-vlan": "Left loose: no WiFi VLAN",
  "loose-wired-device-type": "Left loose: wired device type",
  "loose-wired-hostname": "Left loose: wired hostname",
  "loose-existing-inventory": "Left loose: existing inventory",
  "loose-documented-ports": "Left loose: documented ports",
};

const DISCOVERY_STATUS_KEYS: Record<
  NonNullable<DiscoveredDevice["status"]>,
  TranslationKey
> = {
  new: "New",
  imported: "Imported",
  dismissed: "Dismissed",
};

export default function DiscoveryView() {
  const { t } = useI18n();
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const devices = useStore((s) => s.devices);
  const deviceTypes = useStore((s) => s.deviceTypes);
  const subnets = useStore((s) => s.subnets);
  const scopes = useStore((s) => s.scopes);
  const ipZones = useStore((s) => s.ipZones);
  const discoveredDevices = useStore((s) => s.discoveredDevices);
  const discoveryScanSchedules = useStore((s) => s.discoveryScanSchedules);
  const canEdit = canEditInventory(currentUser);
  const canManageDiscovery = currentUser?.role === "admin";
  const [scanCidr, setScanCidr] = useState("");
  const [scanTarget, setScanTarget] = useState<DiscoveryScanTarget>(
    subnets[0]?.id ?? "manual",
  );
  const [scheduleTarget, setScheduleTarget] = useState<DiscoveryScanTarget>(
    subnets[0]?.id ?? "manual",
  );
  const [scheduleCidr, setScheduleCidr] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState("60");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [draft, setDraft] = useState<DiscoveryDraft | null>(null);
  const [scanning, setScanning] = useState(false);
  const [activeScanJob, setActiveScanJob] = useState<DiscoveryScanJob | null>(
    null,
  );
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(
    null,
  );
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(
    null,
  );
  const [lastScanResult, setLastScanResult] =
    useState<DiscoveryScanResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [autoMapping, setAutoMapping] = useState(false);
  const [autoMapIcmpMonitors, setAutoMapIcmpMonitors] = useState(false);
  const [autoMapMessage, setAutoMapMessage] = useState("");
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter] = useState<DiscoveryFilter>("active");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<DiscoverySortKey>>({
    key: "ip",
    direction: "asc",
  });

  const deviceById = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, device) => {
      acc[device.id] = device;
      return acc;
    }, {});
  }, [devices]);

  const duplicateMatchesById = useMemo(() => {
    const byIp = new Map<string, Device[]>();
    const byHostname = new Map<string, Device[]>();

    for (const device of devices) {
      if (device.managementIp) {
        (
          byIp.get(device.managementIp) ??
          byIp.set(device.managementIp, []).get(device.managementIp)!
        ).push(device);
      }

      const hostKeys = [device.hostname, device.displayName]
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value));

      for (const key of hostKeys) {
        (byHostname.get(key) ?? byHostname.set(key, []).get(key)!).push(device);
      }
    }

    return discoveredDevices.reduce<Record<string, Device[]>>(
      (acc, discovered) => {
        if (discovered.importedDeviceId || discovered.status !== "new") {
          acc[discovered.id] = [];
          return acc;
        }

        const matches = new Map<string, Device>();

        for (const match of byIp.get(discovered.ipAddress) ?? []) {
          matches.set(match.id, match);
        }

        const hostKeys = [discovered.hostname, discovered.displayName]
          .map((value) => value?.trim().toLowerCase())
          .filter((value): value is string => Boolean(value));

        for (const key of hostKeys) {
          for (const match of byHostname.get(key) ?? []) {
            matches.set(match.id, match);
          }
        }

        acc[discovered.id] = [...matches.values()].sort((a, b) =>
          a.hostname.localeCompare(b.hostname),
        );
        return acc;
      },
      {},
    );
  }, [deviceById, devices, discoveredDevices]);

  const duplicateCount = useMemo(
    () =>
      discoveredDevices.filter(
        (device) =>
          !device.technicalRole &&
          (duplicateMatchesById[device.id] ?? []).length > 0,
      ).length,
    [discoveredDevices, duplicateMatchesById],
  );

  const filteredDevices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return discoveredDevices
      .filter((device) => {
        const matchesFilter =
          filter === "active"
            ? device.status === "new" && !device.technicalRole
            : filter === "all"
              ? !device.technicalRole
              : filter === "technical"
                ? Boolean(device.technicalRole)
                : filter === "duplicates"
                  ? device.status === "new" &&
                    !device.technicalRole &&
                    (duplicateMatchesById[device.id] ?? []).length > 0
                  : device.status === filter && !device.technicalRole;
        if (!matchesFilter) return false;
        if (!normalizedQuery) return true;
        const haystack = [
          device.ipAddress,
          device.hostname,
          device.displayName,
          device.deviceType,
          device.placement,
          device.vendor,
          device.macAddress,
          device.status,
          device.technicalRole,
          device.technicalReason,
          ...(duplicateMatchesById[device.id] ?? []).flatMap((match) => [
            match.hostname,
            match.managementIp,
            match.macAddress,
          ]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .sort((a, b) =>
        compareDiscoveredDevices(a, b, sort, duplicateMatchesById),
      );
  }, [discoveredDevices, duplicateMatchesById, filter, query, sort]);

  const autoMapCandidates = useMemo(
    () =>
      discoveredDevices.filter(
        (device) =>
          device.status === "new" &&
          !device.technicalRole &&
          (duplicateMatchesById[device.id] ?? []).length === 0,
      ),
    [discoveredDevices, duplicateMatchesById],
  );

  const selected = selectedId
    ? discoveredDevices.find((device) => device.id === selectedId)
    : undefined;
  const selectedIsTechnical = Boolean(selected?.technicalRole);
  const selectedMatches = selected
    ? selectedIsTechnical
      ? []
      : (duplicateMatchesById[selected.id] ?? [])
    : [];

  const drawerDefaults = useMemo(() => {
    if (!selected) return undefined;
    const ipPlan = ipPlanForDiscoveredHost(
      selected.ipAddress,
      subnets,
      scopes,
      ipZones,
    );
    return {
      hostname:
        selected.hostname ??
        selected.displayName ??
        selected.ipAddress.replaceAll(".", "-"),
      displayName: selected.displayName ?? "",
      deviceType: selected.deviceType ?? "endpoint",
      manufacturer: selected.vendor ?? "",
      managementIp: selected.ipAddress,
      macAddress: selected.macAddress ?? "",
      ipSubnetId: ipPlan.subnet?.id ?? "",
      ipAllocationMode: ipPlan.allocationMode,
      dhcpScopeId: ipPlan.dhcpScope?.id ?? "",
      placement: selected.placement ?? "room",
      notes: selected.notes ?? "",
      status: "online" as const,
    };
  }, [ipZones, scopes, selected, subnets]);

  useEffect(() => {
    if (scanTarget === "manual" || scanTarget === "all") return;
    if (subnets.some((subnet) => subnet.id === scanTarget)) return;
    setScanTarget(subnets[0]?.id ?? "manual");
  }, [scanTarget, subnets]);

  useEffect(() => {
    if (!filteredDevices.length) {
      setSelectedId(undefined);
      return;
    }
    if (
      !selectedId ||
      !filteredDevices.some((device) => device.id === selectedId)
    ) {
      setSelectedId(filteredDevices[0].id);
    }
  }, [filteredDevices, selectedId]);

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft({
      hostname: selected.hostname ?? "",
      displayName: selected.displayName ?? "",
      deviceType: selected.deviceType ?? "endpoint",
      placement: selected.placement ?? "room",
      notes: selected.notes ?? "",
      status: selected.status,
    });
    setError("");
  }, [selected]);

  async function handleScan() {
    const scanCidrs =
      scanTarget === "all"
        ? subnets.map((subnet) => subnet.cidr)
        : scanTarget === "manual"
          ? [scanCidr.trim()].filter(Boolean)
          : subnets
              .filter((subnet) => subnet.id === scanTarget)
              .map((subnet) => subnet.cidr);
    if (scanCidrs.length === 0) return;
    setScanning(true);
    setError("");
    setAutoMapMessage("");
    try {
      const results: DiscoveryScanResult[] = [];
      for (const cidr of scanCidrs) {
        results.push(await scanDiscoveredSubnet(cidr, setActiveScanJob));
      }
      setLastScanResult(mergeScanResults(results));
      setFilter("all");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Failed to scan subnet."),
      );
    } finally {
      setActiveScanJob(null);
      setScanning(false);
    }
  }

  function selectedScheduleCidrs() {
    return scheduleTarget === "all"
      ? subnets.map((subnet) => subnet.cidr)
      : scheduleTarget === "manual"
        ? [scheduleCidr.trim()].filter(Boolean)
        : subnets
            .filter((subnet) => subnet.id === scheduleTarget)
            .map((subnet) => subnet.cidr);
  }

  async function handleAddSchedule() {
    const cidrs = selectedScheduleCidrs();
    const intervalMinutes = Number.parseInt(scheduleIntervalMinutes, 10);
    if (cidrs.length === 0 || !Number.isFinite(intervalMinutes)) return;
    setSavingSchedule(true);
    setError("");
    try {
      for (const cidr of cidrs) {
        await createDiscoveryScanSchedule({
          name: scheduleName.trim() || null,
          cidr,
          intervalMs: Math.max(1, intervalMinutes) * 60_000,
          enabled: true,
        });
      }
      setScheduleName("");
      if (scheduleTarget === "manual") setScheduleCidr("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to save discovery schedule."),
      );
    } finally {
      setSavingSchedule(false);
    }
  }

  async function handleRunSchedule(schedule: DiscoveryScanSchedule) {
    setRunningScheduleId(schedule.id);
    setError("");
    try {
      const result = await runDiscoveryScanScheduleNow(schedule.id);
      if (result) {
        setLastScanResult(result);
        setFilter("all");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to run discovery schedule."),
      );
    } finally {
      setRunningScheduleId(null);
    }
  }

  async function handleToggleSchedule(schedule: DiscoveryScanSchedule) {
    setError("");
    try {
      await updateDiscoveryScanScheduleRecord(schedule.id, {
        enabled: !schedule.enabled,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to save discovery schedule."),
      );
    }
  }

  async function handleDeleteSchedule(schedule: DiscoveryScanSchedule) {
    if (
      !window.confirm(
        t("Delete discovery schedule {cidr}?", { cidr: schedule.cidr }),
      )
    )
      return;
    setDeletingScheduleId(schedule.id);
    setError("");
    try {
      await deleteDiscoveryScanScheduleRecord(schedule.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to delete discovery schedule."),
      );
    } finally {
      setDeletingScheduleId(null);
    }
  }

  async function handleSave() {
    if (!selected || !draft) return;
    const status = selected.technicalRole ? selected.status : draft.status;
    setSaving(true);
    setError("");
    try {
      await updateDiscoveredDeviceRecord(selected.id, {
        hostname: draft.hostname.trim() || null,
        displayName: draft.displayName.trim() || null,
        deviceType: draft.deviceType,
        placement: draft.placement,
        notes: draft.notes.trim() || null,
        status,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to save discovered device."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (
      !window.confirm(
        t("Delete discovered host {ipAddress}?", {
          ipAddress: selected.ipAddress,
        }),
      )
    )
      return;
    setDeleting(true);
    setError("");
    try {
      await deleteDiscoveredDeviceRecord(selected.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to delete discovered device."),
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleLinkExisting(deviceId: string) {
    if (!selected || selected.technicalRole) return;
    const device = deviceById[deviceId];
    setLinkingId(deviceId);
    setError("");
    try {
      await updateDiscoveredDeviceRecord(selected.id, {
        status: "imported",
        importedDeviceId: deviceId,
        hostname: device?.hostname ?? selected.hostname ?? null,
        displayName: device?.displayName ?? selected.displayName ?? null,
        deviceType: device?.deviceType ?? selected.deviceType ?? "endpoint",
        placement: device?.placement ?? selected.placement ?? "room",
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Failed to link discovered device."),
      );
    } finally {
      setLinkingId(null);
    }
  }

  async function handleImported(saved: Device) {
    if (!selected || selected.technicalRole) return;
    await updateDiscoveredDeviceRecord(selected.id, {
      status: "imported",
      importedDeviceId: saved.id,
    });
    setDrawerOpen(false);
  }

  async function handleAutoMap() {
    if (!autoMapCandidates.length) return;
    setAutoMapping(true);
    setAutoMapMessage("");
    setError("");
    const failures: string[] = [];
    let mapped = 0;
    let monitorsCreated = 0;

    for (const discovered of autoMapCandidates) {
      try {
        const ipPlan = ipPlanForDiscoveredHost(
          discovered.ipAddress,
          subnets,
          scopes,
          ipZones,
        );
        const created = await createDevice({
          hostname:
            discovered.hostname?.trim() ||
            discovered.displayName?.trim() ||
            discovered.ipAddress.replaceAll(".", "-"),
          displayName: discovered.displayName ?? undefined,
          deviceType: discovered.deviceType ?? "endpoint",
          manufacturer: discovered.vendor ?? undefined,
          managementIp: discovered.ipAddress,
          macAddress: discovered.macAddress ?? undefined,
          ipAllocationMode: ipPlan.allocationMode,
          dhcpScopeId: ipPlan.dhcpScope?.id ?? null,
          placement: autoMapPlacement(discovered),
          status: "online",
          notes: discovered.notes ?? undefined,
        });
        if (autoMapIcmpMonitors && canManageDiscovery) {
          const monitor = await createDeviceMonitorConfig(created.id, {
            name: "ICMP",
            type: "icmp",
            target: discovered.ipAddress,
            enabled: true,
          });
          await runDeviceMonitorCheck(monitor.id);
          monitorsCreated += 1;
        }
        await updateDiscoveredDeviceRecord(discovered.id, {
          status: "imported",
          importedDeviceId: created.id,
        });
        mapped += 1;
      } catch (err) {
        failures.push(
          `${discovered.ipAddress}: ${
            err instanceof Error ? err.message : "failed"
          }`,
        );
      }
    }

    if (failures.length > 0) {
      setError(
        t(
          "Auto-map imported {mapped} host(s); {failedCount} failed. {details}",
          {
            mapped,
            failedCount: failures.length,
            details: failures.slice(0, 3).join(" "),
          },
        ),
      );
    } else {
      setAutoMapMessage(
        monitorsCreated > 0
          ? t(
              "Auto-mapped {count} discovered host(s) and added {monitors} ICMP monitor(s).",
              { count: mapped, monitors: monitorsCreated },
            )
          : t("Auto-mapped {count} discovered host(s).", { count: mapped }),
      );
      setFilter("imported");
    }
    setAutoMapping(false);
  }

  function handleSort(key: DiscoverySortKey) {
    setSort((current) => toggleSort(current, key));
  }

  const newCount = discoveredDevices.filter(
    (device) => device.status === "new",
  ).length;
  const importedCount = discoveredDevices.filter(
    (device) => device.status === "imported",
  ).length;
  const dismissedCount = discoveredDevices.filter(
    (device) => device.status === "dismissed",
  ).length;
  const technicalCount = discoveredDevices.filter(
    (device) => device.technicalRole,
  ).length;

  return (
    <>
      <TopBar
        subtitle={t("Discovery inbox")}
        title={t("Discovery")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {t("{count} discovered in {lab}", {
              count: discoveredDevices.length,
              lab: lab.name,
            })}
          </span>
        }
        actions={
          canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={scanTarget}
                onChange={(event) => setScanTarget(event.target.value)}
                className="rk-control h-8 w-56 px-2 text-xs text-[var(--text-primary)]"
                disabled={!canManageDiscovery}
                aria-label={t("Discovery scan target")}
              >
                {subnets.length > 0 && (
                  <option value="all">{t("All IPAM subnets")}</option>
                )}
                {subnets.map((subnet) => (
                  <option key={subnet.id} value={subnet.id}>
                    {subnet.cidr} · {subnet.name}
                  </option>
                ))}
                <option value="manual">{t("Manual CIDR")}</option>
              </select>
              {scanTarget === "manual" && (
                <Input
                  value={scanCidr}
                  onChange={(event) => setScanCidr(event.target.value)}
                  placeholder="10.0.21.0/24"
                  className="w-40"
                  disabled={!canManageDiscovery}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleScan()}
                disabled={
                  !canManageDiscovery ||
                  scanning ||
                  (scanTarget === "manual" && !scanCidr.trim()) ||
                  (scanTarget === "all" && subnets.length === 0)
                }
              >
                <Search className="size-3.5" />
                {scanning
                  ? activeScanJob?.status === "queued"
                    ? t("{value1} #{value2}", {
                        value1: t("Queued"),
                        value2: activeScanJob.queuePosition ?? 1,
                      })
                    : t("Scanning...")
                  : scanTarget === "all"
                    ? t("Scan all")
                    : t("Scan subnet")}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
          <DiscoveryStat
            label={t("Total")}
            value={String(discoveredDevices.length)}
            hint={t("Reachable hosts in the inbox")}
          />
          <DiscoveryStat
            label={t("New")}
            value={String(newCount)}
            hint={t("Not reviewed yet")}
          />
          <DiscoveryStat
            label={t("Duplicates")}
            value={String(duplicateCount)}
            hint={t("Matches existing inventory")}
          />
          <DiscoveryStat
            label={t("Imported")}
            value={String(importedCount)}
            hint={t("Already linked to inventory")}
          />
          <DiscoveryStat
            label={t("Dismissed")}
            value={String(dismissedCount)}
            hint={t("Hidden from the active queue")}
          />
          <DiscoveryStat
            label={t("Technical")}
            value={String(technicalCount)}
            hint={t("IPAM gateway, DNS, reserved, or infra")}
          />
        </div>

        {lastScanResult && <ScanSummary result={lastScanResult} t={t} />}

        {canEdit && (
          <Card>
            <CardHeader>
              <CardTitle>
                <CardLabel>{t("Scheduled scans")}</CardLabel>
                <CardHeading>
                  {t("Keep selected CIDRs refreshed automatically.")}
                </CardHeading>
              </CardTitle>
              <Badge tone="neutral">
                <Clock className="size-3" />
                {t("{count} schedules", {
                  count: discoveryScanSchedules.length,
                })}
              </Badge>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid gap-2 md:grid-cols-[minmax(12rem,1.2fr)_minmax(8rem,1fr)_8rem_auto]">
                <select
                  value={scheduleTarget}
                  onChange={(event) => setScheduleTarget(event.target.value)}
                  className="rk-control h-9 px-2 text-xs text-[var(--text-primary)]"
                  disabled={!canManageDiscovery || savingSchedule}
                  aria-label={t("Discovery schedule target")}
                >
                  {subnets.length > 0 && (
                    <option value="all">{t("All IPAM subnets")}</option>
                  )}
                  {subnets.map((subnet) => (
                    <option key={subnet.id} value={subnet.id}>
                      {subnet.cidr} · {subnet.name}
                    </option>
                  ))}
                  <option value="manual">{t("Manual CIDR")}</option>
                </select>
                {scheduleTarget === "manual" ? (
                  <Input
                    value={scheduleCidr}
                    onChange={(event) => setScheduleCidr(event.target.value)}
                    placeholder="10.0.21.0/24"
                    disabled={!canManageDiscovery || savingSchedule}
                  />
                ) : (
                  <Input
                    value={scheduleName}
                    onChange={(event) => setScheduleName(event.target.value)}
                    placeholder={t("Schedule name")}
                    disabled={!canManageDiscovery || savingSchedule}
                  />
                )}
                <Input
                  type="number"
                  min={1}
                  value={scheduleIntervalMinutes}
                  onChange={(event) =>
                    setScheduleIntervalMinutes(event.target.value)
                  }
                  aria-label={t("Interval minutes")}
                  disabled={!canManageDiscovery || savingSchedule}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleAddSchedule()}
                  disabled={
                    !canManageDiscovery ||
                    savingSchedule ||
                    (scheduleTarget === "manual" && !scheduleCidr.trim()) ||
                    (scheduleTarget === "all" && subnets.length === 0)
                  }
                >
                  <Clock className="size-3.5" />
                  {savingSchedule ? t("Saving...") : t("Add schedule")}
                </Button>
              </div>
              {scheduleTarget === "manual" && (
                <Input
                  value={scheduleName}
                  onChange={(event) => setScheduleName(event.target.value)}
                  placeholder={t("Schedule name")}
                  disabled={!canManageDiscovery || savingSchedule}
                />
              )}
              {discoveryScanSchedules.length === 0 ? (
                <EmptyState
                  icon={Clock}
                  title={t("No scheduled scans yet")}
                  description={t(
                    "Add a CIDR schedule to keep discovery fresh automatically.",
                  )}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="rk-table min-w-[760px]">
                    <thead>
                      <tr>
                        <th>{t("CIDR")}</th>
                        <th>{t("Name")}</th>
                        <th>{t("Interval")}</th>
                        <th>{t("Status")}</th>
                        <th>{t("Last run")}</th>
                        <th>{t("Actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discoveryScanSchedules.map((schedule) => (
                        <tr key={schedule.id}>
                          <Td>
                            <Mono>{schedule.cidr}</Mono>
                          </Td>
                          <Td>{schedule.name || "-"}</Td>
                          <Td>
                            {t("Every {minutes} min", {
                              minutes: Math.max(
                                1,
                                Math.round(schedule.intervalMs / 60_000),
                              ),
                            })}
                          </Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              <Badge tone={schedule.enabled ? "ok" : "neutral"}>
                                {schedule.enabled
                                  ? t("Enabled")
                                  : t("Disabled")}
                              </Badge>
                              {schedule.lastResult && (
                                <Badge
                                  tone={
                                    schedule.lastResult === "success"
                                      ? "ok"
                                      : "warn"
                                  }
                                >
                                  {schedule.lastResult === "success"
                                    ? t("Success")
                                    : t("Error")}
                                </Badge>
                              )}
                            </div>
                          </Td>
                          <Td>
                            <div className="space-y-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                              <div>{schedule.lastRunAt ?? t("Never")}</div>
                              {schedule.lastMessage && (
                                <div>{schedule.lastMessage}</div>
                              )}
                            </div>
                          </Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleRunSchedule(schedule)}
                                disabled={
                                  !canManageDiscovery ||
                                  runningScheduleId === schedule.id
                                }
                              >
                                <Play className="size-3.5" />
                                {runningScheduleId === schedule.id
                                  ? t("Running...")
                                  : t("Run now")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void handleToggleSchedule(schedule)
                                }
                                disabled={!canManageDiscovery}
                              >
                                <Power className="size-3.5" />
                                {schedule.enabled ? t("Pause") : t("Resume")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void handleDeleteSchedule(schedule)
                                }
                                disabled={
                                  !canManageDiscovery ||
                                  deletingScheduleId === schedule.id
                                }
                              >
                                <Trash2 className="size-3.5" />
                                {t("Delete")}
                              </Button>
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <FilterButton
              active={filter === "active"}
              onClick={() => setFilter("active")}
            >
              {t("Active")}
            </FilterButton>
            <FilterButton
              active={filter === "all"}
              onClick={() => setFilter("all")}
            >
              {t("All")}
            </FilterButton>
            <FilterButton
              active={filter === "new"}
              onClick={() => setFilter("new")}
            >
              {t("New")}
            </FilterButton>
            <FilterButton
              active={filter === "duplicates"}
              onClick={() => setFilter("duplicates")}
            >
              {t("Duplicates")}
            </FilterButton>
            <FilterButton
              active={filter === "imported"}
              onClick={() => setFilter("imported")}
            >
              {t("Imported")}
            </FilterButton>
            <FilterButton
              active={filter === "dismissed"}
              onClick={() => setFilter("dismissed")}
            >
              {t("Dismissed")}
            </FilterButton>
            <FilterButton
              active={filter === "technical"}
              onClick={() => setFilter("technical")}
            >
              {t("Technical")}
            </FilterButton>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <>
                <label className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
                  <input
                    type="checkbox"
                    checked={autoMapIcmpMonitors}
                    onChange={(event) =>
                      setAutoMapIcmpMonitors(event.target.checked)
                    }
                    disabled={!canManageDiscovery}
                    className="size-3 accent-[var(--color-accent)]"
                  />
                  {t("ICMP monitor")}
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleAutoMap()}
                  disabled={autoMapping || autoMapCandidates.length === 0}
                >
                  {autoMapping
                    ? t("Auto-mapping...")
                    : t("Auto-map {count}", {
                        count: autoMapCandidates.length,
                      })}
                </Button>
              </>
            )}
            <div className="relative min-w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Search IP, hostname, MAC...")}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </div>

        {autoMapMessage && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--color-ok)]/30 bg-[var(--color-ok)]/10 px-3 py-2 text-sm text-[var(--color-fg)]">
            {autoMapMessage}
          </div>
        )}

        <div className="grid min-h-[22rem] gap-3 xl:grid-cols-[minmax(22rem,1fr)_minmax(20rem,0.4fr)] xl:items-start">
          <div
            className="min-h-[22rem] min-w-0 xl:max-h-[42rem] xl:overflow-y-auto"
            data-testid="discovery-inbox"
          >
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Inbox")}</CardLabel>
                  <CardHeading>{t("Discovered hosts")}</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="rk-table min-w-[980px]">
                  <thead>
                    <tr>
                      <SortableHeader
                        sortKey="ip"
                        sort={sort}
                        onSort={handleSort}
                      >
                        {t("IP")}
                      </SortableHeader>
                      <SortableHeader
                        sortKey="hostname"
                        sort={sort}
                        onSort={handleSort}
                      >
                        {t("Hostname")}
                      </SortableHeader>
                      <SortableHeader
                        sortKey="type"
                        sort={sort}
                        onSort={handleSort}
                      >
                        {t("Type")}
                      </SortableHeader>
                      <SortableHeader
                        sortKey="placement"
                        sort={sort}
                        onSort={handleSort}
                      >
                        {t("Placement")}
                      </SortableHeader>
                      <SortableHeader
                        sortKey="vendor"
                        sort={sort}
                        onSort={handleSort}
                      >
                        {t("Vendor / MAC")}
                      </SortableHeader>
                      <SortableHeader
                        sortKey="match"
                        sort={sort}
                        onSort={handleSort}
                      >
                        {t("Match")}
                      </SortableHeader>
                      <SortableHeader
                        sortKey="status"
                        sort={sort}
                        onSort={handleSort}
                      >
                        {t("Status")}
                      </SortableHeader>
                      <SortableHeader
                        sortKey="lastSeen"
                        sort={sort}
                        onSort={handleSort}
                      >
                        {t("Last seen")}
                      </SortableHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDevices.map((device) => {
                      const matches = duplicateMatchesById[device.id] ?? [];
                      return (
                        <tr
                          key={device.id}
                          onClick={() => setSelectedId(device.id)}
                          data-selected={selectedId === device.id}
                          className="cursor-pointer"
                        >
                          <Td>
                            <Mono>{device.ipAddress}</Mono>
                          </Td>
                          <Td>
                            {device.hostname || device.displayName || "-"}
                          </Td>
                          <Td>
                            <span className="inline-flex items-center gap-2">
                              <DeviceTypeIcon
                                type={device.deviceType ?? "endpoint"}
                                className="size-3.5 text-[var(--color-accent)]"
                              />
                              <span className="capitalize text-[var(--color-fg-muted)]">
                                {device.deviceType ?? t("endpoint")}
                              </span>
                            </span>
                          </Td>
                          <Td className="capitalize text-[var(--color-fg-muted)]">
                            {device.placement ?? t("room")}
                          </Td>
                          <Td>
                            <div className="space-y-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                              <div>{device.vendor ?? "-"}</div>
                              <Mono className="text-[10px] text-[var(--color-fg-faint)]">
                                {device.macAddress ?? t("MAC unavailable")}
                              </Mono>
                            </div>
                          </Td>
                          <Td>
                            {matches.length > 0 ? (
                              <Badge tone="warn">
                                <AlertTriangle className="size-3" />
                                {matches.length === 1
                                  ? t("{count} match", {
                                      count: matches.length,
                                    })
                                  : t("{count} matches", {
                                      count: matches.length,
                                    })}
                              </Badge>
                            ) : (
                              <span className="text-[11px] text-[var(--color-fg-faint)]">
                                {t("clean")}
                              </span>
                            )}
                          </Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              <DiscoveryBadge status={device.status} />
                              {device.placementHint && (
                                <Badge tone="info">
                                  {placementHintLabel(device.placementHint, t)}
                                </Badge>
                              )}
                              {device.technicalRole && (
                                <Badge tone="neutral">
                                  {device.technicalRole}
                                </Badge>
                              )}
                            </div>
                          </Td>
                          <Td className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
                            {device.lastSeen ?? device.lastScannedAt}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredDevices.length === 0 && (
                  <EmptyState
                    icon={Inbox}
                    className="m-4"
                    title={
                      discoveredDevices.length === 0
                        ? t("Discovery inbox is empty")
                        : t("No discovered devices match the current filter")
                    }
                    description={
                      discoveredDevices.length === 0
                        ? canManageDiscovery
                          ? t(
                              "Run a subnet scan to populate the discovery inbox.",
                            )
                          : t(
                              "An administrator can run subnet scans to populate the discovery inbox.",
                            )
                        : t(
                            "Try a broader filter to bring additional discovered hosts back into view.",
                          )
                    }
                  />
                )}
              </CardBody>
            </Card>
          </div>

          <div className="min-w-0 w-full">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>{t("Inspector")}</CardLabel>
                  <CardHeading>
                    {selected
                      ? selected.ipAddress
                      : t("Select a discovered host")}
                  </CardHeading>
                </CardTitle>
                {selected && <DiscoveryBadge status={selected.status} />}
              </CardHeader>
              <CardBody className="max-h-[22rem] space-y-4 overflow-y-auto">
                {!selected || !draft ? (
                  <EmptyState
                    icon={Search}
                    title={t("Select a discovered host")}
                    description={t(
                      "Review metadata, inspect likely matches, and import it into inventory from here.",
                    )}
                  />
                ) : (
                  <>
                    {selected.technicalRole && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-fg-subtle)]" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[var(--color-fg)]">
                              {t("IPAM technical address")}
                            </div>
                            <div className="mt-1 text-sm text-[var(--color-fg-subtle)]">
                              {selected.technicalReason ??
                                selected.technicalRole}
                            </div>
                            <div className="mt-2 text-xs leading-5 text-[var(--color-fg-subtle)]">
                              {t(
                                "Technical addresses stay out of the normal import flow. Update the related IPAM scope, zone, or assignment if this address changes.",
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedMatches.length > 0 && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/10 px-3 py-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[var(--color-fg)]">
                              {t("Possible duplicate inventory match")}
                            </div>
                            <div className="mt-1 text-sm text-[var(--color-fg-subtle)]">
                              {t(
                                "Rackpad found existing devices with the same IP or hostname. Review these before importing a duplicate record.",
                              )}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {selectedMatches.map((match) => (
                                <div
                                  key={match.id}
                                  className="inline-flex items-center gap-2 rounded-[var(--radius-xs)] border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-fg)]"
                                >
                                  <Link
                                    to={`/devices/${match.id}`}
                                    className="inline-flex items-center gap-2 hover:text-[var(--color-accent)]"
                                  >
                                    <DeviceTypeIcon
                                      type={match.deviceType}
                                      className="size-3.5 text-[var(--color-accent)]"
                                    />
                                    {match.hostname}
                                  </Link>
                                  {canEdit && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-2 text-[10px]"
                                      disabled={linkingId === match.id}
                                      onClick={() =>
                                        void handleLinkExisting(match.id)
                                      }
                                    >
                                      {linkingId === match.id
                                        ? t("Linking...")
                                        : t("Link existing")}
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <Field label={t("Hostname")}>
                      <Input
                        value={draft.hostname}
                        onChange={(event) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, hostname: event.target.value }
                              : prev,
                          )
                        }
                      />
                    </Field>
                    <Field label={t("Display name")}>
                      <Input
                        value={draft.displayName}
                        onChange={(event) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, displayName: event.target.value }
                              : prev,
                          )
                        }
                      />
                    </Field>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={t("MAC address")}>
                        <Input value={selected.macAddress ?? ""} disabled />
                      </Field>
                      <Field label={t("Vendor")}>
                        <Input value={selected.vendor ?? ""} disabled />
                      </Field>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={t("Device type")}>
                        <Select
                          value={draft.deviceType}
                          onChange={(value) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    deviceType:
                                      value as DiscoveryDraft["deviceType"],
                                  }
                                : prev,
                            )
                          }
                        >
                          {deviceTypes.map((deviceType) => (
                            <option key={deviceType.id} value={deviceType.id}>
                              {deviceType.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t("Placement")}>
                        <Select
                          value={draft.placement}
                          onChange={(value) =>
                            setDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    placement:
                                      value as DiscoveryDraft["placement"],
                                  }
                                : prev,
                            )
                          }
                        >
                          <option value="room">{t("Loose / room tech")}</option>
                          <option value="wireless">
                            {t("WiFi / AP linked")}
                          </option>
                          <option value="virtual">
                            {t("Virtual / hosted")}
                          </option>
                          <option value="rack">{t("Rack mounted")}</option>
                        </Select>
                      </Field>
                    </div>
                    <Field label={t("Status")}>
                      <Select
                        value={draft.status}
                        disabled={selectedIsTechnical}
                        onChange={(value) =>
                          setDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  status: value as DiscoveryDraft["status"],
                                }
                              : prev,
                          )
                        }
                      >
                        <option value="new">{t("New")}</option>
                        <option value="imported">{t("Imported")}</option>
                        <option value="dismissed">{t("Dismissed")}</option>
                      </Select>
                      {selectedIsTechnical && (
                        <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                          {t("Status is locked for IPAM technical addresses.")}
                        </div>
                      )}
                    </Field>
                    <Field label={t("Notes")}>
                      <textarea
                        rows={4}
                        value={draft.notes}
                        onChange={(event) =>
                          setDraft((prev) =>
                            prev
                              ? { ...prev, notes: event.target.value }
                              : prev,
                          )
                        }
                        className="rk-control rk-textarea w-full text-sm"
                      />
                    </Field>

                    {selected.importedDeviceId &&
                      deviceById[selected.importedDeviceId] && (
                        <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-fg)]">
                          {t("Imported as")}{" "}
                          <Link
                            to={`/devices/${selected.importedDeviceId}`}
                            className="text-[var(--color-accent)] hover:underline"
                          >
                            {deviceById[selected.importedDeviceId].hostname}
                          </Link>
                        </div>
                      )}

                    {error && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--color-err)]/30 bg-[var(--color-err)]/10 px-3 py-2 text-sm text-[var(--color-err)]">
                        {error}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleSave()}
                          disabled={saving}
                        >
                          <Save className="size-3.5" />
                          {saving ? t("Saving...") : t("Save")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleScan()}
                          disabled={!canManageDiscovery || scanning}
                        >
                          <RefreshCcw className="size-3.5" />
                          {t("Rescan")}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        {canEdit &&
                          !selectedIsTechnical &&
                          selected.status !== "imported" && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => setDrawerOpen(true)}
                            >
                              {selectedMatches.length > 0
                                ? t("Import anyway")
                                : t("Import")}
                            </Button>
                          )}
                        {canEdit && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void handleDelete()}
                            disabled={deleting}
                          >
                            <Trash2 className="size-3.5" />
                            {deleting ? t("Deleting...") : t("Delete")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>

      {selected && canEdit && !selectedIsTechnical && (
        <DeviceDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSaved={(device) => void handleImported(device)}
          defaults={drawerDefaults}
        />
      )}
    </>
  );
}

function ScanSummary({
  result,
  t,
}: {
  result: DiscoveryScanResult;
  t: ReturnType<typeof useI18n>["t"];
}) {
  const hasWarning = result.diagnostics.some(
    (diagnostic) => diagnostic.severity === "warning",
  );
  const scanSummaryText =
    result.technicalCount > 0
      ? t(
          "Last scan checked {hostCount} hosts, found {discovered} reachable, saw {macCount} MACs and {vendorCount} vendors, with {technicalCount} technical.",
          {
            hostCount: result.scannedHostCount,
            discovered: result.discoveredCount,
            macCount: result.macAddressCount,
            vendorCount: result.vendorCount,
            technicalCount: result.technicalCount,
          },
        )
      : t(
          "Last scan checked {hostCount} hosts, found {discovered} reachable, saw {macCount} MACs and {vendorCount} vendors.",
          {
            hostCount: result.scannedHostCount,
            discovered: result.discoveredCount,
            macCount: result.macAddressCount,
            vendorCount: result.vendorCount,
          },
        );
  return (
    <div
      className={`rounded-[var(--radius-sm)] border px-3 py-3 ${
        hasWarning
          ? "border-[var(--color-warn)]/30 bg-[var(--color-warn)]/10"
          : "border-[var(--color-line)] bg-[var(--color-bg-2)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg)]">
        {hasWarning && (
          <AlertTriangle className="size-4 shrink-0 text-[var(--color-warn)]" />
        )}
        <span>{scanSummaryText}</span>
      </div>
      {result.diagnostics.length > 0 && (
        <div className="mt-2 space-y-1 text-xs text-[var(--color-fg-subtle)]">
          {result.diagnostics.map((diagnostic) => (
            <div key={diagnostic.code}>
              <span className="font-medium text-[var(--color-fg)]">
                {diagnostic.message}
              </span>
              {diagnostic.detail
                ? t("{detail}", { detail: diagnostic.detail })
                : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiscoveryStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-fg)]">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
        {hint}
      </div>
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
  children: ReactNode;
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

function placementHintLabel(hint: string, t: ReturnType<typeof useI18n>["t"]) {
  const key = PLACEMENT_HINT_KEYS[hint];
  return key ? t(key) : hint;
}

function DiscoveryBadge({ status }: { status: DiscoveredDevice["status"] }) {
  const { t } = useI18n();
  const tone =
    status === "imported"
      ? "ok"
      : status === "dismissed"
        ? "neutral"
        : "accent";
  return <Badge tone={tone}>{t(DISCOVERY_STATUS_KEYS[status])}</Badge>;
}

function autoMapPlacement(
  discovered: DiscoveredDevice,
): NonNullable<DiscoveredDevice["placement"]> {
  if (
    discovered.placement === "wireless" ||
    discovered.placement === "virtual" ||
    discovered.placement === "room"
  ) {
    return discovered.placement;
  }
  return "room";
}

function ipPlanForDiscoveredHost(
  ipAddress: string,
  subnets: Subnet[],
  scopes: DhcpScope[],
  ipZones: IpZone[],
): {
  subnet?: Subnet;
  allocationMode: IpAllocationMode;
  dhcpScope?: DhcpScope;
} {
  const subnet = subnets.find((entry) => cidrContainsIp(entry.cidr, ipAddress));
  const inStaticZone = subnet
    ? ipZones.some(
        (zone) =>
          zone.subnetId === subnet.id &&
          zone.kind === "static" &&
          ipInRange(ipAddress, zone.startIp, zone.endIp),
      )
    : false;
  const dhcpScope = subnet
    ? scopes.find(
        (scope) =>
          !inStaticZone &&
          scope.subnetId === subnet.id &&
          ipInRange(ipAddress, scope.startIp, scope.endIp),
      )
    : undefined;
  return {
    subnet,
    allocationMode: dhcpScope ? "dhcp-reservation" : "static",
    dhcpScope,
  };
}

function mergeScanResults(results: DiscoveryScanResult[]): DiscoveryScanResult {
  const rowsById = new Map<string, DiscoveredDevice>();
  for (const result of results) {
    for (const row of result.rows) {
      rowsById.set(row.id, row);
    }
  }
  return {
    chunkCount: results.reduce(
      (sum, result) => sum + (result.chunkCount ?? 1),
      0,
    ),
    scannedHostCount: results.reduce(
      (sum, result) => sum + result.scannedHostCount,
      0,
    ),
    discoveredCount: results.reduce(
      (sum, result) => sum + result.discoveredCount,
      0,
    ),
    macAddressCount: results.reduce(
      (sum, result) => sum + result.macAddressCount,
      0,
    ),
    vendorCount: results.reduce((sum, result) => sum + result.vendorCount, 0),
    technicalCount: results.reduce(
      (sum, result) => sum + result.technicalCount,
      0,
    ),
    diagnostics: results.flatMap((result) => result.diagnostics),
    rows: [...rowsById.values()],
  };
}

function ipInRange(ipAddress: string, startIp: string, endIp: string) {
  const target = ipToInt(ipAddress);
  return target >= ipToInt(startIp) && target <= ipToInt(endIp);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="rk-field-label">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="rk-control h-8 w-full px-2 text-sm text-[var(--text-primary)]"
    >
      {children}
    </select>
  );
}

function Td({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={className}>{children}</td>;
}

function compareDiscoveredDevices(
  a: DiscoveredDevice,
  b: DiscoveredDevice,
  sort: SortState<DiscoverySortKey>,
  duplicateMatchesById: Record<string, Device[]>,
) {
  let result = 0;
  if (sort.key === "ip") {
    result = compareIp(a.ipAddress, b.ipAddress);
  } else if (sort.key === "hostname") {
    result = compareText(
      a.hostname ?? a.displayName ?? "",
      b.hostname ?? b.displayName ?? "",
    );
  } else if (sort.key === "type") {
    result = compareText(
      a.deviceType ?? "endpoint",
      b.deviceType ?? "endpoint",
    );
  } else if (sort.key === "placement") {
    result = compareText(a.placement ?? "room", b.placement ?? "room");
  } else if (sort.key === "vendor") {
    result =
      compareText(a.vendor, b.vendor) ||
      compareText(a.macAddress, b.macAddress);
  } else if (sort.key === "match") {
    result = compareNumber(
      duplicateMatchesById[a.id]?.length ?? 0,
      duplicateMatchesById[b.id]?.length ?? 0,
    );
  } else if (sort.key === "status") {
    result = compareText(a.status, b.status);
  } else {
    result = compareDate(
      a.lastSeen ?? a.lastScannedAt,
      b.lastSeen ?? b.lastScannedAt,
    );
  }

  if (result === 0) result = compareIp(a.ipAddress, b.ipAddress);
  return applySortDirection(result, sort.direction);
}
