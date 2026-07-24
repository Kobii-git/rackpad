import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { TopBar } from "@/components/layout/TopBar";
import { useI18n } from "@/i18n";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Mono } from "@/components/shared/Mono";
import { SortableHeader } from "@/components/shared/SortableHeader";
import { StatusDot } from "@/components/shared/StatusDot";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import {
  bulkUpdateDevices,
  canEditInventory,
  deleteDevice,
  useStore,
} from "@/lib/store";
import type {
  Device,
  DeviceStatus,
  DeviceType,
  Port,
  Rack,
  Room,
} from "@/lib/types";
import {
  AlertTriangle,
  ChevronRight,
  Filter,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { statusLabel } from "@/lib/utils";
import { deviceTypeLabel } from "@/lib/device-types";
import {
  applySortDirection,
  compareIp,
  compareNumber,
  compareText,
  toggleSort,
  type SortState,
} from "@/lib/sort";

type SortKey =
  | "hostname"
  | "type"
  | "model"
  | "managementIp"
  | "macAddress"
  | "placement"
  | "ports"
  | "status";

interface BulkDeviceForm {
  tags: string;
  placement: "" | "loose" | "room" | "wireless";
  roomId: string;
  parentDeviceId: string;
  wifiSsidId: string;
  deviceType: string;
  manufacturer: string;
  model: string;
  status: string;
  cpuCores: string;
  memoryGb: string;
  storageGb: string;
  specs: string;
}

const EMPTY_BULK_DEVICE_FORM: BulkDeviceForm = {
  tags: "",
  placement: "",
  roomId: "",
  parentDeviceId: "",
  wifiSsidId: "",
  deviceType: "",
  manufacturer: "",
  model: "",
  status: "",
  cpuCores: "",
  memoryGb: "",
  storageGb: "",
  specs: "",
};

export default function DevicesList() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useStore((s) => s.currentUser);
  const deviceTypes = useStore((s) => s.deviceTypes);
  const rooms = useStore((s) => s.rooms);
  const devices = useStore((s) => s.devices);
  const wifiSsids = useStore((s) => s.wifiSsids);
  const racks = useStore((s) => s.racks);
  const ports = useStore((s) => s.ports);
  const deviceMonitors = useStore((s) => s.deviceMonitors);
  const canEdit = canEditInventory(currentUser);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<DeviceType | null>(null);
  const [sort, setSort] = useState<SortState<SortKey>>({
    key: "hostname",
    direction: "asc",
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkFields, setBulkFields] = useState<Set<keyof BulkDeviceForm>>(
    new Set(),
  );
  const [bulkForm, setBulkForm] = useState<BulkDeviceForm>(
    EMPTY_BULK_DEVICE_FORM,
  );
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const typeParam = searchParams.get("type");
  const placementParam = searchParams.get("placement");
  const macParam = searchParams.get("mac");
  const showUnplacedOnly = placementParam === "unplaced";
  const showDuplicateMacs = macParam === "duplicates";

  useEffect(() => {
    if (typeParam && typeParam !== type) {
      setType(typeParam);
      return;
    }
    if (!typeParam && type !== null) {
      setType(null);
    }
  }, [type, typeParam]);

  const rackById = useMemo(() => {
    return racks.reduce<Record<string, Rack>>((acc, rack) => {
      acc[rack.id] = rack;
      return acc;
    }, {});
  }, [racks]);

  const roomById = useMemo(() => {
    return rooms.reduce<Record<string, Room>>((acc, room) => {
      acc[room.id] = room;
      return acc;
    }, {});
  }, [rooms]);

  const accessPointCandidates = useMemo(
    () =>
      devices
        .filter((device) => device.deviceType === "ap")
        .sort((a, b) => a.hostname.localeCompare(b.hostname)),
    [devices],
  );

  const deviceById = useMemo(() => {
    return devices.reduce<Record<string, Device>>((acc, device) => {
      acc[device.id] = device;
      return acc;
    }, {});
  }, [devices]);

  const portsByDeviceId = useMemo(() => {
    return ports.reduce<Record<string, Port[]>>((acc, port) => {
      (acc[port.deviceId] ??= []).push(port);
      return acc;
    }, {});
  }, [ports]);

  const duplicateMacGroups = useMemo(() => {
    const groups = new Map<string, Device[]>();
    for (const device of devices) {
      const macAddress = canonicalMacAddress(device.macAddress);
      if (!macAddress) continue;
      const entries = groups.get(macAddress) ?? [];
      entries.push(device);
      groups.set(macAddress, entries);
    }
    return [...groups.entries()]
      .filter(([, entries]) => entries.length > 1)
      .map(([macAddress, entries]) => ({
        macAddress,
        devices: [...entries].sort((a, b) =>
          a.hostname.localeCompare(b.hostname),
        ),
      }))
      .sort((a, b) => a.macAddress.localeCompare(b.macAddress));
  }, [devices]);

  const duplicateMacDeviceIds = useMemo(
    () =>
      new Set(
        duplicateMacGroups.flatMap((group) =>
          group.devices.map((device) => device.id),
        ),
      ),
    [duplicateMacGroups],
  );

  const filtered = useMemo(() => {
    return devices
      .filter((device) => {
        if (type && device.deviceType !== type) return false;
        if (showUnplacedOnly && !isUnplacedDevice(device)) return false;
        if (showDuplicateMacs && !duplicateMacDeviceIds.has(device.id))
          return false;
        if (!query) return true;
        const haystack = [
          device.hostname,
          device.displayName,
          device.manufacturer,
          device.model,
          device.managementIp,
          device.macAddress,
          device.deviceType,
          ...(device.tags ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
      .sort((a, b) =>
        compareDevices(
          a,
          b,
          sort,
          rackById,
          roomById,
          deviceById,
          portsByDeviceId,
        ),
      );
  }, [
    deviceById,
    devices,
    duplicateMacDeviceIds,
    portsByDeviceId,
    query,
    rackById,
    roomById,
    sort,
    showUnplacedOnly,
    showDuplicateMacs,
    type,
  ]);
  const selectedDeviceCount = selectedDeviceIds.size;
  const selectedDevices = useMemo(
    () => devices.filter((device) => selectedDeviceIds.has(device.id)),
    [devices, selectedDeviceIds],
  );
  const selectedMonitorCount = useMemo(
    () =>
      deviceMonitors.filter((monitor) =>
        selectedDeviceIds.has(monitor.deviceId),
      ).length,
    [deviceMonitors, selectedDeviceIds],
  );
  const selectedPortCount = useMemo(
    () => ports.filter((port) => selectedDeviceIds.has(port.deviceId)).length,
    [ports, selectedDeviceIds],
  );
  const monitoredStatusCount = useMemo(
    () =>
      selectedDevices.filter((device) =>
        deviceMonitors.some(
          (monitor) => monitor.deviceId === device.id && monitor.enabled,
        ),
      ).length,
    [deviceMonitors, selectedDevices],
  );
  const allFilteredSelected =
    filtered.length > 0 &&
    filtered.every((device) => selectedDeviceIds.has(device.id));

  useEffect(() => {
    const deviceIds = new Set(devices.map((device) => device.id));
    setSelectedDeviceIds((current) => {
      const next = new Set(
        [...current].filter((deviceId) => deviceIds.has(deviceId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [devices]);

  function handleSort(key: SortKey) {
    setSort((current) => toggleSort(current, key));
  }

  function toggleDeviceSelection(deviceId: string) {
    setSelectedDeviceIds((current) => {
      const next = new Set(current);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelectedDeviceIds((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        for (const device of filtered) next.delete(device.id);
      } else {
        for (const device of filtered) next.add(device.id);
      }
      return next;
    });
  }

  function toggleBulkField(key: keyof BulkDeviceForm) {
    setBulkFields((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const bulkPlacementInvalid =
    bulkFields.has("placement") &&
    bulkForm.placement === "wireless" &&
    !bulkForm.parentDeviceId;

  async function handleBulkSave() {
    if (selectedDeviceIds.size === 0 || bulkFields.size === 0) return;
    const changes: Record<string, unknown> = {};
    if (bulkFields.has("tags")) {
      changes.tags = bulkForm.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    if (bulkFields.has("placement")) {
      if (bulkForm.placement === "wireless") {
        changes.placement = "wireless";
        changes.parentDeviceId = bulkForm.parentDeviceId;
        if (bulkForm.wifiSsidId) {
          changes.wifiSsidId = bulkForm.wifiSsidId;
        }
      } else if (bulkForm.placement === "loose") {
        changes.placement = "room";
        changes.roomId = null;
        changes.parentDeviceId = null;
      } else if (bulkForm.placement === "room") {
        changes.placement = "room";
        changes.roomId = bulkForm.roomId || null;
        changes.parentDeviceId = null;
      }
    } else if (bulkFields.has("roomId")) {
      changes.placement = "room";
      changes.roomId = bulkForm.roomId || null;
      changes.parentDeviceId = null;
    }
    if (bulkFields.has("deviceType") && bulkForm.deviceType) {
      changes.deviceType = bulkForm.deviceType;
    }
    if (bulkFields.has("manufacturer")) {
      changes.manufacturer = bulkForm.manufacturer.trim() || null;
    }
    if (bulkFields.has("model")) {
      changes.model = bulkForm.model.trim() || null;
    }
    if (bulkFields.has("status") && bulkForm.status) {
      changes.status = bulkForm.status as DeviceStatus;
    }
    if (bulkFields.has("cpuCores")) {
      changes.cpuCores = bulkForm.cpuCores
        ? Number.parseInt(bulkForm.cpuCores, 10)
        : null;
    }
    if (bulkFields.has("memoryGb")) {
      changes.memoryGb = bulkForm.memoryGb
        ? Number.parseFloat(bulkForm.memoryGb)
        : null;
    }
    if (bulkFields.has("storageGb")) {
      changes.storageGb = bulkForm.storageGb
        ? Number.parseFloat(bulkForm.storageGb)
        : null;
    }
    if (bulkFields.has("specs")) {
      changes.specs = bulkForm.specs.trim() || null;
    }

    setBulkSaving(true);
    setBulkError("");
    try {
      await bulkUpdateDevices({
        deviceIds: [...selectedDeviceIds],
        changes,
      });
      setSelectedDeviceIds(new Set());
      setBulkFields(new Set());
      setBulkForm(EMPTY_BULK_DEVICE_FORM);
    } catch (err) {
      setBulkError(
        err instanceof Error ? err.message : t("Failed to update devices."),
      );
    } finally {
      setBulkSaving(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedDeviceIds.size === 0) return;
    const dependencyParts = [
      selectedPortCount ? `${selectedPortCount} ports/cable endpoints` : "",
      selectedMonitorCount ? `${selectedMonitorCount} monitor targets` : "",
    ].filter(Boolean);
    const confirmed = window.confirm(
      [
        `Delete ${selectedDeviceIds.size} selected device${selectedDeviceIds.size === 1 ? "" : "s"}?`,
        dependencyParts.length
          ? `Related ${dependencyParts.join(" and ")} will be cleaned up.`
          : "Related inventory references will be cleaned up.",
        "This cannot be undone.",
      ].join("\n\n"),
    );
    if (!confirmed) return;

    setBulkSaving(true);
    setBulkError("");
    try {
      for (const deviceId of selectedDeviceIds) {
        await deleteDevice(deviceId);
      }
      setSelectedDeviceIds(new Set());
      setBulkFields(new Set());
      setBulkForm(EMPTY_BULK_DEVICE_FORM);
    } catch (err) {
      setBulkError(
        err instanceof Error ? err.message : "Failed to delete devices.",
      );
    } finally {
      setBulkSaving(false);
    }
  }

  function setTypeFilter(nextType: DeviceType | null) {
    setType(nextType);
    const nextParams = new URLSearchParams(searchParams);
    if (nextType) {
      nextParams.set("type", nextType);
    } else {
      nextParams.delete("type");
    }
    setSearchParams(nextParams);
  }

  function setPlacementFilter(unplacedOnly: boolean) {
    const nextParams = new URLSearchParams(searchParams);
    if (unplacedOnly) {
      nextParams.set("placement", "unplaced");
    } else {
      nextParams.delete("placement");
    }
    setSearchParams(nextParams);
  }

  function setDuplicateMacFilter(duplicatesOnly: boolean) {
    const nextParams = new URLSearchParams(searchParams);
    if (duplicatesOnly) {
      nextParams.set("mac", "duplicates");
    } else {
      nextParams.delete("mac");
    }
    setSearchParams(nextParams);
  }

  const typeCounts = useMemo(() => {
    return devices.reduce<Record<string, number>>((acc, device) => {
      acc[device.deviceType] = (acc[device.deviceType] ?? 0) + 1;
      return acc;
    }, {});
  }, [devices]);

  return (
    <>
      <TopBar
        subtitle={t("Inventory")}
        title={t("Devices")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {devices.length} {t("total")}
          </span>
        }
        actions={
          canEdit ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDrawerOpen(true)}
            >
              <Plus className="size-3.5" />
              {t("Add device")}
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 space-y-4 overflow-y-auto rk-page-pad">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setTypeFilter(null)}
            className="rk-filter-pill"
            data-active={type === null}
          >
            <span className="font-mono text-[10px] uppercase tracking-wider">
              {t("All")}
            </span>
            <Mono className="ml-2 text-[10px]">{devices.length}</Mono>
          </button>
          <button
            onClick={() => setPlacementFilter(!showUnplacedOnly)}
            className="rk-filter-pill"
            data-active={showUnplacedOnly}
          >
            <span className="font-mono text-[10px] uppercase tracking-wider">
              {t("Unplaced")}
            </span>
            <Mono className="ml-2 text-[10px]">
              {devices.filter(isUnplacedDevice).length}
            </Mono>
          </button>
          <button
            onClick={() => setDuplicateMacFilter(!showDuplicateMacs)}
            className="rk-filter-pill"
            data-active={showDuplicateMacs}
          >
            <AlertTriangle className="size-3" />
            <span className="font-mono text-[10px] uppercase tracking-wider">
              {t("Duplicate MACs")}
            </span>
            <Mono className="text-[10px]">
              {duplicateMacDeviceIds.size}
            </Mono>
          </button>
          {deviceTypes.map((entry) => {
            const count = typeCounts[entry.id] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={entry.id}
                onClick={() => setTypeFilter(entry.id)}
                className="rk-filter-pill"
                data-active={type === entry.id}
              >
                <DeviceTypeIcon type={entry.id} className="size-3" />
                <span className="font-mono text-[10px] uppercase tracking-wider capitalize">
                  {entry.label}
                </span>
                <Mono className="text-[10px]">{count}</Mono>
              </button>
            );
          })}
        </div>

        <div className="relative max-w-md">
          <Filter className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-faint)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search hostname, model, IP, MAC, tag...")}
            className="pl-7"
          />
        </div>

        {showDuplicateMacs && (
          <Card data-testid="duplicate-mac-summary">
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="rk-kicker">{t("Duplicate MAC addresses")}</div>
                  <div className="mt-1 text-sm text-[var(--color-fg-subtle)]">
                    {t(
                      "{groups} duplicate group(s) across {devices} device(s).",
                      {
                        groups: duplicateMacGroups.length,
                        devices: duplicateMacDeviceIds.size,
                      },
                    )}
                  </div>
                </div>
                <Badge tone={duplicateMacGroups.length > 0 ? "warn" : "ok"}>
                  {duplicateMacDeviceIds.size} {t("affected")}
                </Badge>
              </div>

              {duplicateMacGroups.length === 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] px-3 py-4 text-sm text-[var(--color-fg-subtle)]">
                  {t("No duplicate device MAC addresses found.")}
                </div>
              ) : (
                <div className="grid gap-2 xl:grid-cols-2">
                  {duplicateMacGroups.map((group) => (
                    <div
                      key={group.macAddress}
                      data-testid="duplicate-mac-group"
                      className="rounded-[var(--radius-sm)] border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/6 p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Mono className="text-xs text-[var(--color-fg)]">
                          {group.macAddress}
                        </Mono>
                        <Badge tone="warn">
                          {group.devices.length} {t("devices")}
                        </Badge>
                      </div>
                      <div className="mt-2 divide-y divide-[var(--color-line)]">
                        {group.devices.map((device) => (
                          <div
                            key={device.id}
                            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-xs"
                          >
                            <Link
                              to={`/devices/${device.id}`}
                              className="font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                            >
                              {device.hostname}
                            </Link>
                            <div className="flex items-center gap-3 text-[var(--color-fg-subtle)]">
                              <Mono>{device.managementIp ?? t("No IP")}</Mono>
                              <span className="inline-flex items-center gap-1.5">
                                <StatusDot status={device.status} />
                                {statusLabel[device.status]}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {canEdit && selectedDeviceCount > 0 && (
          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge tone="cyan">
                    {selectedDeviceCount} {t("selected")}
                  </Badge>
                  <span className="text-sm text-[var(--color-fg-subtle)]">
                    {t("Apply only checked fields to all selected devices.")}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDeviceIds(new Set())}
                >
                  <X className="size-3.5" />
                  {t("Clear")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={bulkSaving}
                  onClick={() => void handleBulkDelete()}
                >
                  <Trash2 className="size-3.5" />
                  {t("Delete selected")}
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <BulkField
                  label={t("Tags")}
                  checked={bulkFields.has("tags")}
                  onChecked={() => toggleBulkField("tags")}
                >
                  <Input
                    value={bulkForm.tags}
                    onChange={(event) =>
                      setBulkForm((prev) => ({
                        ...prev,
                        tags: event.target.value,
                      }))
                    }
                    placeholder={t("prod, lab, core")}
                  />
                </BulkField>
                <BulkField
                  label={t("Placement")}
                  checked={bulkFields.has("placement")}
                  onChecked={() => toggleBulkField("placement")}
                >
                  <Select
                    value={bulkForm.placement}
                    onChange={(value) =>
                      setBulkForm((prev) => ({
                        ...prev,
                        placement: value as BulkDeviceForm["placement"],
                        parentDeviceId:
                          value === "wireless" ? prev.parentDeviceId : "",
                        roomId: value === "room" ? prev.roomId : "",
                      }))
                    }
                  >
                    <option value="">{t("Keep current placement")}</option>
                    <option value="loose">{t("Loose / no room")}</option>
                    <option value="room">{t("Room")}</option>
                    <option value="wireless">{t("WiFi / AP linked")}</option>
                  </Select>
                  {bulkForm.placement === "room" && (
                    <Select
                      value={bulkForm.roomId}
                      onChange={(value) =>
                        setBulkForm((prev) => ({ ...prev, roomId: value }))
                      }
                    >
                      <option value="">{t("Loose / no room")}</option>
                      {rooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </Select>
                  )}
                  {bulkForm.placement === "wireless" && (
                    <>
                      <Select
                        value={bulkForm.parentDeviceId}
                        onChange={(value) =>
                          setBulkForm((prev) => ({
                            ...prev,
                            parentDeviceId: value,
                            wifiSsidId: "",
                          }))
                        }
                      >
                        <option value="">{t("No AP selected")}</option>
                        {accessPointCandidates.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.hostname}
                          </option>
                        ))}
                      </Select>
                      {bulkForm.parentDeviceId && (
                        <Select
                          value={bulkForm.wifiSsidId}
                          onChange={(value) =>
                            setBulkForm((prev) => ({
                              ...prev,
                              wifiSsidId: value,
                            }))
                          }
                        >
                          <option value="">{t("SSID (optional)")}</option>
                          {wifiSsids.map((ssid) => (
                            <option key={ssid.id} value={ssid.id}>
                              {ssid.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </>
                  )}
                </BulkField>
                <BulkField
                  label={t("Device type")}
                  checked={bulkFields.has("deviceType")}
                  onChecked={() => toggleBulkField("deviceType")}
                >
                  <Select
                    value={bulkForm.deviceType}
                    onChange={(value) =>
                      setBulkForm((prev) => ({ ...prev, deviceType: value }))
                    }
                  >
                    <option value="">{t("Keep current type")}</option>
                    {deviceTypes.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </Select>
                </BulkField>
                <BulkField
                  label={t("Manufacturer")}
                  checked={bulkFields.has("manufacturer")}
                  onChecked={() => toggleBulkField("manufacturer")}
                >
                  <Input
                    value={bulkForm.manufacturer}
                    onChange={(event) =>
                      setBulkForm((prev) => ({
                        ...prev,
                        manufacturer: event.target.value,
                      }))
                    }
                  />
                </BulkField>
                <BulkField
                  label={t("Model")}
                  checked={bulkFields.has("model")}
                  onChecked={() => toggleBulkField("model")}
                >
                  <Input
                    value={bulkForm.model}
                    onChange={(event) =>
                      setBulkForm((prev) => ({
                        ...prev,
                        model: event.target.value,
                      }))
                    }
                  />
                </BulkField>
                <BulkField
                  label={t("Status")}
                  checked={bulkFields.has("status")}
                  onChecked={() => toggleBulkField("status")}
                >
                  <Select
                    value={bulkForm.status}
                    onChange={(value) =>
                      setBulkForm((prev) => ({ ...prev, status: value }))
                    }
                  >
                    <option value="">{t("Keep current status")}</option>
                    {(
                      [
                        "online",
                        "offline",
                        "warning",
                        "maintenance",
                        "unknown",
                      ] as const
                    ).map((status) => (
                      <option key={status} value={status}>
                        {statusLabel[status]}
                      </option>
                    ))}
                  </Select>
                </BulkField>
                <BulkField
                  label={t("CPU cores")}
                  checked={bulkFields.has("cpuCores")}
                  onChecked={() => toggleBulkField("cpuCores")}
                >
                  <Input
                    type="number"
                    min="1"
                    value={bulkForm.cpuCores}
                    onChange={(event) =>
                      setBulkForm((prev) => ({
                        ...prev,
                        cpuCores: event.target.value,
                      }))
                    }
                  />
                </BulkField>
                <BulkField
                  label={t("Memory GB")}
                  checked={bulkFields.has("memoryGb")}
                  onChecked={() => toggleBulkField("memoryGb")}
                >
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={bulkForm.memoryGb}
                    onChange={(event) =>
                      setBulkForm((prev) => ({
                        ...prev,
                        memoryGb: event.target.value,
                      }))
                    }
                  />
                </BulkField>
                <BulkField
                  label={t("Storage GB")}
                  checked={bulkFields.has("storageGb")}
                  onChecked={() => toggleBulkField("storageGb")}
                >
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={bulkForm.storageGb}
                    onChange={(event) =>
                      setBulkForm((prev) => ({
                        ...prev,
                        storageGb: event.target.value,
                      }))
                    }
                  />
                </BulkField>
              </div>

              <BulkField
                label={t("Capacity & specs")}
                checked={bulkFields.has("specs")}
                onChecked={() => toggleBulkField("specs")}
              >
                <textarea
                  value={bulkForm.specs}
                  onChange={(event) =>
                    setBulkForm((prev) => ({
                      ...prev,
                      specs: event.target.value,
                    }))
                  }
                  rows={3}
                  className="rk-control rk-textarea w-full text-sm"
                />
              </BulkField>

              {bulkError && (
                <div className="text-xs text-[var(--color-err)]">
                  {bulkError}
                </div>
              )}

              {bulkFields.has("status") && monitoredStatusCount > 0 && (
                <div className="rounded-[var(--radius-sm)] border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/8 px-3 py-2 text-xs text-[var(--color-fg-subtle)]">
                  {monitoredStatusCount} {t("selected monitored device")}
                  {monitoredStatusCount === 1 ? "" : t("s")}{" "}
                  {t(
                    "may have this status overwritten by the next monitor result.",
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  disabled={
                    bulkSaving || bulkFields.size === 0 || bulkPlacementInvalid
                  }
                  onClick={() => void handleBulkSave()}
                >
                  <Save className="size-3.5" />
                  {bulkSaving ? t("Saving...") : t("Apply changes")}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody className="p-0">
            <table className="rk-table">
              <thead>
                <tr>
                  <Th>
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={() => toggleAllFiltered()}
                        aria-label={t("Select all filtered devices")}
                      />
                    )}
                  </Th>
                  <Th />
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
                    sortKey="model"
                    sort={sort}
                    onSort={handleSort}
                  >
                    {t("Model")}
                  </SortableHeader>
                  <SortableHeader
                    sortKey="managementIp"
                    sort={sort}
                    onSort={handleSort}
                  >
                    {t("Mgmt IP")}
                  </SortableHeader>
                  <SortableHeader
                    sortKey="macAddress"
                    sort={sort}
                    onSort={handleSort}
                  >
                    {t("MAC")}
                  </SortableHeader>
                  <SortableHeader
                    sortKey="placement"
                    sort={sort}
                    onSort={handleSort}
                  >
                    {t("Placement")}
                  </SortableHeader>
                  <SortableHeader
                    sortKey="ports"
                    sort={sort}
                    onSort={handleSort}
                  >
                    {t("Ports")}
                  </SortableHeader>
                  <SortableHeader
                    sortKey="status"
                    sort={sort}
                    onSort={handleSort}
                  >
                    {t("Status")}
                  </SortableHeader>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((device) => {
                  const hasDuplicateMac = duplicateMacDeviceIds.has(device.id);
                  const devicePorts = portsByDeviceId[device.id] ?? [];
                  const linked = devicePorts.filter(
                    (port) => port.linkState === "up",
                  ).length;
                  const rack = device.rackId
                    ? rackById[device.rackId]
                    : undefined;
                  const parentDevice = device.parentDeviceId
                    ? deviceById[device.parentDeviceId]
                    : undefined;
                  const room = device.roomId
                    ? roomById[device.roomId]
                    : undefined;
                  return (
                    <tr
                      key={device.id}
                      data-selected={selectedDeviceIds.has(device.id)}
                      data-duplicate-mac={hasDuplicateMac || undefined}
                      className={[
                        "group",
                        hasDuplicateMac ? "bg-[var(--color-warn)]/5" : "",
                      ].join(" ")}
                    >
                      <Td className="w-px">
                        {canEdit && (
                          <input
                            type="checkbox"
                            checked={selectedDeviceIds.has(device.id)}
                            onChange={() => toggleDeviceSelection(device.id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={t("Select {hostname}", {
                              hostname: device.hostname,
                            })}
                          />
                        )}
                      </Td>
                      <Td className="w-px">
                        <DeviceTypeIcon
                          type={device.deviceType}
                          className="size-4 text-[var(--color-fg-muted)] transition-colors group-hover:text-[var(--color-accent)]"
                        />
                      </Td>
                      <Td>
                        <Link
                          to={`/devices/${device.id}`}
                          className="font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                        >
                          {device.hostname}
                        </Link>
                      </Td>
                      <Td>
                        <span className="text-xs capitalize text-[var(--color-fg-muted)]">
                          {deviceTypeLabel(device.deviceType, deviceTypes)}
                        </span>
                      </Td>
                      <Td>
                        <Mono className="text-[11px] text-[var(--color-fg-subtle)]">
                          {device.manufacturer
                            ? t("{manufacturer} {model}", {
                                manufacturer: device.manufacturer,
                                model: device.model,
                              })
                            : (device.model ?? "-")}
                        </Mono>
                      </Td>
                      <Td>
                        <Mono className="text-[var(--color-fg)]">
                          {device.managementIp ?? "-"}
                        </Mono>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Mono className="text-[var(--color-fg)]">
                            {device.macAddress ?? "-"}
                          </Mono>
                          {hasDuplicateMac && (
                            <Badge tone="warn">{t("Duplicate")}</Badge>
                          )}
                        </div>
                      </Td>
                      <Td>
                        {device.placement === "virtual" ? (
                          <span className="text-xs">
                            <span className="text-[var(--color-fg-muted)]">
                              {t("Virtual")}
                            </span>
                            {parentDevice && (
                              <>
                                <span className="mx-1 text-[var(--color-fg-faint)]">
                                  |
                                </span>
                                <span className="text-[var(--color-fg-subtle)]">
                                  {parentDevice.hostname}
                                </span>
                              </>
                            )}
                          </span>
                        ) : device.placement === "wireless" ? (
                          <span className="text-xs">
                            <span className="text-[var(--color-fg-muted)]">
                              {t("WiFi")}
                            </span>
                            {parentDevice && (
                              <>
                                <span className="mx-1 text-[var(--color-fg-faint)]">
                                  |
                                </span>
                                <span className="text-[var(--color-fg-subtle)]">
                                  {parentDevice.hostname}
                                </span>
                              </>
                            )}
                          </span>
                        ) : device.placement === "shelf" ? (
                          <span className="text-xs">
                            <span className="text-[var(--color-fg-muted)]">
                              {t("Shelf")}
                            </span>
                            {parentDevice && (
                              <>
                                <span className="mx-1 text-[var(--color-fg-faint)]">
                                  |
                                </span>
                                <span className="text-[var(--color-fg-subtle)]">
                                  {parentDevice.hostname}
                                </span>
                              </>
                            )}
                            {rack && (
                              <>
                                <span className="mx-1 text-[var(--color-fg-faint)]">
                                  |
                                </span>
                                <span className="text-[var(--color-fg-subtle)]">
                                  {rack.name}
                                </span>
                              </>
                            )}
                          </span>
                        ) : rack && device.startU ? (
                          <span className="text-xs">
                            <span className="text-[var(--color-fg-muted)]">
                              {rack.name}
                            </span>
                            <span className="mx-1 text-[var(--color-fg-faint)]">
                              |
                            </span>
                            <Mono className="text-[var(--color-fg-muted)]">
                              {formatRackUnit(device)}
                            </Mono>
                          </span>
                        ) : (
                          <span className="text-[var(--color-fg-faint)]">
                            {device.placement === "rack"
                              ? t("Pending placement")
                              : room
                                ? t("Room | {name}", { name: room.name })
                                : t("Loose / room")}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {devicePorts.length > 0 ? (
                          <Mono className="text-[var(--color-fg-muted)]">
                            {linked}/{devicePorts.length}
                          </Mono>
                        ) : (
                          <span className="text-[var(--color-fg-faint)]">
                            -
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <StatusDot status={device.status} />
                          <span className="text-[11px] text-[var(--color-fg-muted)]">
                            {statusLabel[device.status]}
                          </span>
                        </span>
                      </Td>
                      <Td className="w-px">
                        <ChevronRight className="size-3.5 text-[var(--color-fg-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-[var(--color-fg-subtle)]">
                {t("No devices match your filter.")}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {canEdit && (
        <DeviceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      )}
    </>
  );
}

function Th({ children }: { children?: ReactNode }) {
  return (
    <th className="text-left font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-[var(--color-fg-subtle)]">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 align-middle ${className ?? ""}`}>{children}</td>
  );
}

function BulkField({
  label,
  checked,
  onChecked,
  children,
}: {
  label: string;
  checked: boolean;
  onChecked: () => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2">
        <input type="checkbox" checked={checked} onChange={() => onChecked()} />
        <span className="rk-field-label mb-0">{label}</span>
      </span>
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

function compareDevices(
  a: Device,
  b: Device,
  sort: SortState<SortKey>,
  rackById: Record<string, Rack>,
  roomById: Record<string, Room>,
  deviceById: Record<string, Device>,
  portsByDeviceId: Record<string, Port[]>,
) {
  let result = 0;

  if (sort.key === "hostname") {
    result = compareText(a.hostname, b.hostname);
  } else if (sort.key === "type") {
    result = compareText(a.deviceType, b.deviceType);
  } else if (sort.key === "model") {
    result = compareText(deviceModelSortValue(a), deviceModelSortValue(b));
  } else if (sort.key === "managementIp") {
    result = compareIp(a.managementIp, b.managementIp);
  } else if (sort.key === "macAddress") {
    result = compareText(a.macAddress, b.macAddress);
  } else if (sort.key === "placement") {
    result = compareText(
      devicePlacementSortValue(a, rackById, roomById, deviceById),
      devicePlacementSortValue(b, rackById, roomById, deviceById),
    );
  } else if (sort.key === "ports") {
    const aPorts = portsByDeviceId[a.id] ?? [];
    const bPorts = portsByDeviceId[b.id] ?? [];
    result =
      compareNumber(aPorts.length, bPorts.length) ||
      compareNumber(
        aPorts.filter((port) => port.linkState === "up").length,
        bPorts.filter((port) => port.linkState === "up").length,
      );
  } else {
    result = compareText(statusLabel[a.status], statusLabel[b.status]);
  }

  if (result === 0) {
    result = compareText(a.hostname, b.hostname);
  }

  return applySortDirection(result, sort.direction);
}

function deviceModelSortValue(device: Device) {
  return [device.manufacturer, device.model].filter(Boolean).join(" ");
}

function canonicalMacAddress(value?: string | null) {
  if (!value) return null;
  const compact = value.trim().replace(/[:.\-\s]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(compact)) return null;
  return compact.match(/.{2}/g)?.join(":") ?? null;
}

function devicePlacementSortValue(
  device: Device,
  rackById: Record<string, Rack>,
  roomById: Record<string, Room>,
  deviceById: Record<string, Device>,
) {
  const rack = device.rackId ? rackById[device.rackId] : undefined;
  const room = device.roomId ? roomById[device.roomId] : undefined;
  const parentDevice = device.parentDeviceId
    ? deviceById[device.parentDeviceId]
    : undefined;

  if (device.placement === "virtual") {
    return parentDevice ? `Virtual | ${parentDevice.hostname}` : "Virtual";
  }

  if (device.placement === "wireless") {
    return parentDevice ? `WiFi | ${parentDevice.hostname}` : "WiFi";
  }

  if (device.placement === "shelf") {
    return [
      "Shelf",
      parentDevice?.hostname,
      rack?.name,
      device.startU ? `U${device.startU}` : undefined,
    ]
      .filter(Boolean)
      .join(" | ");
  }

  if (rack && device.startU) {
    return `${rack.name} | ${formatRackUnit(device)}`;
  }

  if (device.placement === "rack") return "Pending placement";
  return room ? `Room | ${room.name}` : "Loose / room";
}

function formatRackUnit(device: Device) {
  if (!device.startU) return "";
  const heightU = device.heightU ?? 1;
  const range =
    heightU > 1
      ? `U${device.startU}-${device.startU + heightU - 1}`
      : `U${device.startU}`;
  if (device.rackSlot === "left") return `${range} | left half`;
  if (device.rackSlot === "right") return `${range} | right half`;
  return range;
}

function isUnplacedDevice(device: Device) {
  return (
    device.placement !== "virtual" &&
    !device.rackId &&
    !device.roomId &&
    !device.parentDeviceId
  );
}
