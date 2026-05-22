import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCcw, Save, Search, Trash2 } from "lucide-react";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
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
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { SortableHeader } from "@/components/shared/SortableHeader";
import {
  canEditInventory,
  deleteDiscoveredDeviceRecord,
  scanDiscoveredSubnet,
  updateDiscoveredDeviceRecord,
  useStore,
} from "@/lib/store";
import type { Device, DiscoveredDevice, DiscoveryScanResult } from "@/lib/types";
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

type DiscoveryFilter = "all" | "new" | "imported" | "dismissed" | "duplicates";
type DiscoverySortKey =
  | "ip"
  | "hostname"
  | "type"
  | "placement"
  | "vendor"
  | "match"
  | "status"
  | "lastSeen";

export default function DiscoveryView() {
  const currentUser = useStore((s) => s.currentUser);
  const lab = useStore((s) => s.lab);
  const devices = useStore((s) => s.devices);
  const deviceTypes = useStore((s) => s.deviceTypes);
  const subnets = useStore((s) => s.subnets);
  const discoveredDevices = useStore((s) => s.discoveredDevices);
  const canEdit = canEditInventory(currentUser);
  const canManageDiscovery = currentUser?.role === "admin";
  const [scanCidr, setScanCidr] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [draft, setDraft] = useState<DiscoveryDraft | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastScanResult, setLastScanResult] =
    useState<DiscoveryScanResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter] = useState<DiscoveryFilter>("all");
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

        if (
          discovered.importedDeviceId &&
          deviceById[discovered.importedDeviceId]
        ) {
          matches.set(
            discovered.importedDeviceId,
            deviceById[discovered.importedDeviceId],
          );
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
        (device) => (duplicateMatchesById[device.id] ?? []).length > 0,
      ).length,
    [discoveredDevices, duplicateMatchesById],
  );

  const filteredDevices = useMemo(() => {
    return discoveredDevices
      .filter((device) => {
        if (filter === "all") return true;
        if (filter === "duplicates")
          return (duplicateMatchesById[device.id] ?? []).length > 0;
        return device.status === filter;
      })
      .sort((a, b) =>
        compareDiscoveredDevices(a, b, sort, duplicateMatchesById),
      );
  }, [discoveredDevices, duplicateMatchesById, filter, sort]);

  const selected = selectedId
    ? discoveredDevices.find((device) => device.id === selectedId)
    : undefined;
  const selectedMatches = selected
    ? (duplicateMatchesById[selected.id] ?? [])
    : [];

  const drawerDefaults = useMemo(() => {
    if (!selected) return undefined;
    return {
      hostname:
        selected.hostname ??
        selected.displayName ??
        selected.ipAddress.replaceAll(".", "-"),
      displayName: selected.displayName ?? "",
      deviceType: selected.deviceType ?? "endpoint",
      manufacturer: selected.vendor ?? "",
      managementIp: selected.ipAddress,
      placement: selected.placement ?? "room",
      notes: selected.notes ?? "",
      status: "unknown" as const,
    };
  }, [selected]);

  useEffect(() => {
    if (!scanCidr) {
      setScanCidr(subnets[0]?.cidr ?? "");
    }
  }, [scanCidr, subnets]);

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
    if (!scanCidr.trim()) return;
    setScanning(true);
    setError("");
    try {
      const result = await scanDiscoveredSubnet(scanCidr.trim());
      setLastScanResult(result);
      setFilter("all");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan subnet.");
    } finally {
      setScanning(false);
    }
  }

  async function handleSave() {
    if (!selected || !draft) return;
    setSaving(true);
    setError("");
    try {
      await updateDiscoveredDeviceRecord(selected.id, {
        hostname: draft.hostname.trim() || null,
        displayName: draft.displayName.trim() || null,
        deviceType: draft.deviceType,
        placement: draft.placement,
        notes: draft.notes.trim() || null,
        status: draft.status,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save discovered device.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!window.confirm(`Delete discovered host ${selected.ipAddress}?`))
      return;
    setDeleting(true);
    setError("");
    try {
      await deleteDiscoveredDeviceRecord(selected.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete discovered device.",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleLinkExisting(deviceId: string) {
    if (!selected) return;
    setLinkingId(deviceId);
    setError("");
    try {
      await updateDiscoveredDeviceRecord(selected.id, {
        status: "imported",
        importedDeviceId: deviceId,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to link discovered device.",
      );
    } finally {
      setLinkingId(null);
    }
  }

  async function handleImported(saved: Device) {
    if (!selected) return;
    await updateDiscoveredDeviceRecord(selected.id, {
      status: "imported",
      importedDeviceId: saved.id,
    });
    setDrawerOpen(false);
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

  return (
    <>
      <TopBar
        subtitle="Discovery inbox"
        title="Discovery"
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {discoveredDevices.length} discovered in {lab.name}
          </span>
        }
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Input
                value={scanCidr}
                onChange={(event) => setScanCidr(event.target.value)}
                placeholder="10.0.21.0/24"
                className="w-40"
                disabled={!canManageDiscovery}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleScan()}
                disabled={!canManageDiscovery || scanning}
              >
                <Search className="size-3.5" />
                {scanning ? "Scanning..." : "Scan subnet"}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-1 flex-col gap-5 overflow-hidden px-6 py-5">
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-5">
          <DiscoveryStat
            label="Total"
            value={String(discoveredDevices.length)}
            hint="Reachable hosts in the inbox"
          />
          <DiscoveryStat
            label="New"
            value={String(newCount)}
            hint="Not reviewed yet"
          />
          <DiscoveryStat
            label="Duplicates"
            value={String(duplicateCount)}
            hint="Matches existing inventory"
          />
          <DiscoveryStat
            label="Imported"
            value={String(importedCount)}
            hint="Already linked to inventory"
          />
          <DiscoveryStat
            label="Dismissed"
            value={String(dismissedCount)}
            hint="Hidden from the active queue"
          />
        </div>

        {lastScanResult && <ScanSummary result={lastScanResult} />}

        <div className="flex flex-wrap gap-2">
          <FilterButton
            active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </FilterButton>
          <FilterButton
            active={filter === "new"}
            onClick={() => setFilter("new")}
          >
            New
          </FilterButton>
          <FilterButton
            active={filter === "duplicates"}
            onClick={() => setFilter("duplicates")}
          >
            Duplicates
          </FilterButton>
          <FilterButton
            active={filter === "imported"}
            onClick={() => setFilter("imported")}
          >
            Imported
          </FilterButton>
          <FilterButton
            active={filter === "dismissed"}
            onClick={() => setFilter("dismissed")}
          >
            Dismissed
          </FilterButton>
        </div>

        <div className="flex min-h-0 flex-1 gap-5 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-y-auto">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>Inbox</CardLabel>
                  <CardHeading>Discovered hosts</CardHeading>
                </CardTitle>
              </CardHeader>
              <CardBody className="overflow-x-auto p-0">
                <table className="rk-table min-w-[980px]">
                  <thead>
                    <tr>
                      <SortableHeader sortKey="ip" sort={sort} onSort={handleSort}>
                        IP
                      </SortableHeader>
                      <SortableHeader
                        sortKey="hostname"
                        sort={sort}
                        onSort={handleSort}
                      >
                        Hostname
                      </SortableHeader>
                      <SortableHeader
                        sortKey="type"
                        sort={sort}
                        onSort={handleSort}
                      >
                        Type
                      </SortableHeader>
                      <SortableHeader
                        sortKey="placement"
                        sort={sort}
                        onSort={handleSort}
                      >
                        Placement
                      </SortableHeader>
                      <SortableHeader
                        sortKey="vendor"
                        sort={sort}
                        onSort={handleSort}
                      >
                        Vendor / MAC
                      </SortableHeader>
                      <SortableHeader
                        sortKey="match"
                        sort={sort}
                        onSort={handleSort}
                      >
                        Match
                      </SortableHeader>
                      <SortableHeader
                        sortKey="status"
                        sort={sort}
                        onSort={handleSort}
                      >
                        Status
                      </SortableHeader>
                      <SortableHeader
                        sortKey="lastSeen"
                        sort={sort}
                        onSort={handleSort}
                      >
                        Last seen
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
                                {device.deviceType ?? "endpoint"}
                              </span>
                            </span>
                          </Td>
                          <Td className="capitalize text-[var(--color-fg-muted)]">
                            {device.placement ?? "room"}
                          </Td>
                          <Td>
                            <div className="space-y-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                              <div>{device.vendor ?? "-"}</div>
                              <Mono className="text-[10px] text-[var(--color-fg-faint)]">
                                {device.macAddress ?? "MAC unavailable"}
                              </Mono>
                            </div>
                          </Td>
                          <Td>
                            {matches.length > 0 ? (
                              <Badge tone="warn">
                                <AlertTriangle className="size-3" />
                                {matches.length} match
                                {matches.length === 1 ? "" : "es"}
                              </Badge>
                            ) : (
                              <span className="text-[11px] text-[var(--color-fg-faint)]">
                                clean
                              </span>
                            )}
                          </Td>
                          <Td>
                            <DiscoveryBadge status={device.status} />
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
                  <div className="rk-empty m-4 text-center">
                    <div className="rk-empty-title">
                      {discoveredDevices.length === 0
                        ? "Discovery inbox is empty"
                        : "No discovered devices match the current filter"}
                    </div>
                    <div className="rk-empty-copy">
                      {discoveredDevices.length === 0
                        ? canManageDiscovery
                          ? "Run a subnet scan to populate the discovery inbox."
                          : "An administrator can run subnet scans to populate the discovery inbox."
                        : "Try a broader filter to bring additional discovered hosts back into view."}
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="w-full max-w-md shrink-0 overflow-y-auto">
            <Card>
              <CardHeader>
                <CardTitle>
                  <CardLabel>Inspector</CardLabel>
                  <CardHeading>
                    {selected ? selected.ipAddress : "Select a discovered host"}
                  </CardHeading>
                </CardTitle>
                {selected && <DiscoveryBadge status={selected.status} />}
              </CardHeader>
              <CardBody className="space-y-4">
                {!selected || !draft ? (
                  <div className="rk-empty">
                    <div className="rk-empty-title">
                      Select a discovered host
                    </div>
                    <div className="rk-empty-copy">
                      Review metadata, inspect likely matches, and import it
                      into inventory from here.
                    </div>
                  </div>
                ) : (
                  <>
                    {selectedMatches.length > 0 && (
                      <div className="rounded-[var(--radius-sm)] border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/10 px-3 py-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[var(--color-fg)]">
                              Possible duplicate inventory match
                            </div>
                            <div className="mt-1 text-sm text-[var(--color-fg-subtle)]">
                              Rackpad found existing devices with the same IP or
                              hostname. Review these before importing a
                              duplicate record.
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
                                        ? "Linking..."
                                        : "Link existing"}
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    <Field label="Hostname">
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
                    <Field label="Display name">
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
                      <Field label="MAC address">
                        <Input value={selected.macAddress ?? ""} disabled />
                      </Field>
                      <Field label="Vendor">
                        <Input value={selected.vendor ?? ""} disabled />
                      </Field>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Device type">
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
                      <Field label="Placement">
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
                          <option value="room">room</option>
                          <option value="wireless">wireless</option>
                          <option value="virtual">virtual</option>
                          <option value="rack">rack</option>
                        </Select>
                      </Field>
                    </div>
                    <Field label="Status">
                      <Select
                        value={draft.status}
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
                        <option value="new">new</option>
                        <option value="imported">imported</option>
                        <option value="dismissed">dismissed</option>
                      </Select>
                    </Field>
                    <Field label="Notes">
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
                          Imported as{" "}
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
                          {saving ? "Saving..." : "Save"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleScan()}
                          disabled={!canManageDiscovery || scanning}
                        >
                          <RefreshCcw className="size-3.5" />
                          Rescan
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        {canEdit && selected.status !== "imported" && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => setDrawerOpen(true)}
                          >
                            {selectedMatches.length > 0
                              ? "Import anyway"
                              : "Import"}
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
                            {deleting ? "Deleting..." : "Delete"}
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

      {selected && canEdit && (
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

function ScanSummary({ result }: { result: DiscoveryScanResult }) {
  const hasWarning = result.diagnostics.some(
    (diagnostic) => diagnostic.severity === "warning",
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
        <span>
          Last scan checked{" "}
          <Mono className="text-xs">{result.scannedHostCount}</Mono> hosts,
          found <Mono className="text-xs">{result.discoveredCount}</Mono>{" "}
          reachable, saw{" "}
          <Mono className="text-xs">{result.macAddressCount}</Mono> MACs and{" "}
          <Mono className="text-xs">{result.vendorCount}</Mono> vendors.
        </span>
      </div>
      {result.diagnostics.length > 0 && (
        <div className="mt-2 space-y-1 text-xs text-[var(--color-fg-subtle)]">
          {result.diagnostics.map((diagnostic) => (
            <div key={diagnostic.code}>
              <span className="font-medium text-[var(--color-fg)]">
                {diagnostic.message}
              </span>
              {diagnostic.detail ? ` ${diagnostic.detail}` : ""}
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

function DiscoveryBadge({ status }: { status: DiscoveredDevice["status"] }) {
  const tone =
    status === "imported"
      ? "ok"
      : status === "dismissed"
        ? "neutral"
        : "accent";
  return <Badge tone={tone}>{status}</Badge>;
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
    result = compareText(a.deviceType ?? "endpoint", b.deviceType ?? "endpoint");
  } else if (sort.key === "placement") {
    result = compareText(a.placement ?? "room", b.placement ?? "room");
  } else if (sort.key === "vendor") {
    result =
      compareText(a.vendor, b.vendor) || compareText(a.macAddress, b.macAddress);
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
