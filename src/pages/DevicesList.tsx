import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Mono } from "@/components/shared/Mono";
import { SortableHeader } from "@/components/shared/SortableHeader";
import { StatusDot } from "@/components/shared/StatusDot";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { canEditInventory, updateDevice, useStore } from "@/lib/store";
import type { Device, DeviceType, Port, Rack, Room } from "@/lib/types";
import { ChevronRight, Filter, Plus, Save, X } from "lucide-react";
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
  roomId: string;
  deviceType: string;
  manufacturer: string;
  model: string;
  cpuCores: string;
  memoryGb: string;
  storageGb: string;
  specs: string;
}

const EMPTY_BULK_DEVICE_FORM: BulkDeviceForm = {
  tags: "",
  roomId: "",
  deviceType: "",
  manufacturer: "",
  model: "",
  cpuCores: "",
  memoryGb: "",
  storageGb: "",
  specs: "",
};

export default function DevicesList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentUser = useStore((s) => s.currentUser);
  const devices = useStore((s) => s.devices);
  const deviceTypes = useStore((s) => s.deviceTypes);
  const rooms = useStore((s) => s.rooms);
  const racks = useStore((s) => s.racks);
  const ports = useStore((s) => s.ports);
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
  const showUnplacedOnly = placementParam === "unplaced";

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

  const filtered = useMemo(() => {
    return devices
      .filter((device) => {
        if (type && device.deviceType !== type) return false;
        if (showUnplacedOnly && !isUnplacedDevice(device)) return false;
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
    portsByDeviceId,
    query,
    rackById,
    roomById,
    sort,
    showUnplacedOnly,
    type,
  ]);
  const selectedDeviceCount = selectedDeviceIds.size;
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

  async function handleBulkSave() {
    if (selectedDeviceIds.size === 0 || bulkFields.size === 0) return;
    const changes: Partial<Omit<Device, "id" | "labId">> = {};
    if (bulkFields.has("tags")) {
      changes.tags = bulkForm.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    if (bulkFields.has("roomId")) {
      changes.placement = "room";
      changes.roomId = bulkForm.roomId || undefined;
      changes.parentDeviceId = undefined;
    }
    if (bulkFields.has("deviceType") && bulkForm.deviceType) {
      changes.deviceType = bulkForm.deviceType;
    }
    if (bulkFields.has("manufacturer")) {
      changes.manufacturer = bulkForm.manufacturer.trim() || undefined;
    }
    if (bulkFields.has("model")) {
      changes.model = bulkForm.model.trim() || undefined;
    }
    if (bulkFields.has("cpuCores")) {
      changes.cpuCores = bulkForm.cpuCores
        ? Number.parseInt(bulkForm.cpuCores, 10)
        : undefined;
    }
    if (bulkFields.has("memoryGb")) {
      changes.memoryGb = bulkForm.memoryGb
        ? Number.parseFloat(bulkForm.memoryGb)
        : undefined;
    }
    if (bulkFields.has("storageGb")) {
      changes.storageGb = bulkForm.storageGb
        ? Number.parseFloat(bulkForm.storageGb)
        : undefined;
    }
    if (bulkFields.has("specs")) {
      changes.specs = bulkForm.specs.trim() || undefined;
    }

    setBulkSaving(true);
    setBulkError("");
    try {
      for (const deviceId of selectedDeviceIds) {
        await updateDevice(deviceId, changes);
      }
      setSelectedDeviceIds(new Set());
      setBulkFields(new Set());
      setBulkForm(EMPTY_BULK_DEVICE_FORM);
    } catch (err) {
      setBulkError(
        err instanceof Error ? err.message : "Failed to update devices.",
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

  const typeCounts = useMemo(() => {
    return devices.reduce<Record<string, number>>((acc, device) => {
      acc[device.deviceType] = (acc[device.deviceType] ?? 0) + 1;
      return acc;
    }, {});
  }, [devices]);

  return (
    <>
      <TopBar
        subtitle="Inventory"
        title="Devices"
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {devices.length} total
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
              Add device
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setTypeFilter(null)}
            className={`rounded-[var(--radius-xs)] border px-2.5 py-1 transition-colors ${
              type === null
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
            }`}
          >
            <span className="font-mono text-[10px] uppercase tracking-wider">
              All
            </span>
            <Mono className="ml-2 text-[10px]">{devices.length}</Mono>
          </button>
          <button
            onClick={() => setPlacementFilter(!showUnplacedOnly)}
            className={`rounded-[var(--radius-xs)] border px-2.5 py-1 transition-colors ${
              showUnplacedOnly
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
            }`}
          >
            <span className="font-mono text-[10px] uppercase tracking-wider">
              Unplaced
            </span>
            <Mono className="ml-2 text-[10px]">
              {devices.filter(isUnplacedDevice).length}
            </Mono>
          </button>
          {deviceTypes.map((entry) => {
            const count = typeCounts[entry.id] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={entry.id}
                onClick={() => setTypeFilter(entry.id)}
                className={`inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] border px-2.5 py-1 transition-colors ${
                  type === entry.id
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                    : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
                }`}
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
            placeholder="Search hostname, model, IP, MAC, tag..."
            className="pl-7"
          />
        </div>

        {canEdit && selectedDeviceCount > 0 && (
          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge tone="cyan">{selectedDeviceCount} selected</Badge>
                  <span className="text-sm text-[var(--color-fg-subtle)]">
                    Apply only checked fields to all selected devices.
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDeviceIds(new Set())}
                >
                  <X className="size-3.5" />
                  Clear
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <BulkField
                  label="Tags"
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
                    placeholder="prod, lab, core"
                  />
                </BulkField>
                <BulkField
                  label="Room"
                  checked={bulkFields.has("roomId")}
                  onChecked={() => toggleBulkField("roomId")}
                >
                  <Select
                    value={bulkForm.roomId}
                    onChange={(value) =>
                      setBulkForm((prev) => ({ ...prev, roomId: value }))
                    }
                  >
                    <option value="">Loose / no room</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                      </option>
                    ))}
                  </Select>
                </BulkField>
                <BulkField
                  label="Device type"
                  checked={bulkFields.has("deviceType")}
                  onChecked={() => toggleBulkField("deviceType")}
                >
                  <Select
                    value={bulkForm.deviceType}
                    onChange={(value) =>
                      setBulkForm((prev) => ({ ...prev, deviceType: value }))
                    }
                  >
                    <option value="">Keep current type</option>
                    {deviceTypes.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </Select>
                </BulkField>
                <BulkField
                  label="Manufacturer"
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
                  label="Model"
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
                  label="CPU cores"
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
                  label="Memory GB"
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
                  label="Storage GB"
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
                label="Capacity & specs"
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

              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={bulkSaving || bulkFields.size === 0}
                  onClick={() => void handleBulkSave()}
                >
                  <Save className="size-3.5" />
                  {bulkSaving ? "Saving..." : "Apply changes"}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
                  <Th>
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={() => toggleAllFiltered()}
                        aria-label="Select all filtered devices"
                      />
                    )}
                  </Th>
                  <Th />
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
                    sortKey="model"
                    sort={sort}
                    onSort={handleSort}
                  >
                    Model
                  </SortableHeader>
                  <SortableHeader
                    sortKey="managementIp"
                    sort={sort}
                    onSort={handleSort}
                  >
                    Mgmt IP
                  </SortableHeader>
                  <SortableHeader
                    sortKey="macAddress"
                    sort={sort}
                    onSort={handleSort}
                  >
                    MAC
                  </SortableHeader>
                  <SortableHeader
                    sortKey="placement"
                    sort={sort}
                    onSort={handleSort}
                  >
                    Placement
                  </SortableHeader>
                  <SortableHeader
                    sortKey="ports"
                    sort={sort}
                    onSort={handleSort}
                  >
                    Ports
                  </SortableHeader>
                  <SortableHeader
                    sortKey="status"
                    sort={sort}
                    onSort={handleSort}
                  >
                    Status
                  </SortableHeader>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((device) => {
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
                      className="group border-b border-[var(--color-line)] transition-colors last:border-b-0 hover:bg-[var(--color-surface)]"
                    >
                      <Td className="w-px">
                        {canEdit && (
                          <input
                            type="checkbox"
                            checked={selectedDeviceIds.has(device.id)}
                            onChange={() => toggleDeviceSelection(device.id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Select ${device.hostname}`}
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
                            ? `${device.manufacturer} ${device.model}`
                            : (device.model ?? "-")}
                        </Mono>
                      </Td>
                      <Td>
                        <Mono className="text-[var(--color-fg)]">
                          {device.managementIp ?? "-"}
                        </Mono>
                      </Td>
                      <Td>
                        <Mono className="text-[var(--color-fg)]">
                          {device.macAddress ?? "-"}
                        </Mono>
                      </Td>
                      <Td>
                        {device.placement === "virtual" ? (
                          <span className="text-xs">
                            <span className="text-[var(--color-fg-muted)]">
                              Virtual
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
                              WiFi
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
                              Shelf
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
                              U{device.startU}
                              {(device.heightU ?? 1) > 1
                                ? `-${device.startU + (device.heightU ?? 1) - 1}`
                                : ""}
                            </Mono>
                          </span>
                        ) : (
                          <span className="text-[var(--color-fg-faint)]">
                            {device.placement === "rack"
                              ? "Pending placement"
                              : room
                                ? `Room | ${room.name}`
                                : "Loose / room"}
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
                No devices match your filter.
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
    <th className="px-3 py-1.5 text-left font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
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
    return `${rack.name} | U${device.startU}`;
  }

  if (device.placement === "rack") return "Pending placement";
  return room ? `Room | ${room.name}` : "Loose / room";
}

function isUnplacedDevice(device: Device) {
  return (
    device.placement !== "virtual" &&
    !device.rackId &&
    !device.roomId &&
    !device.parentDeviceId
  );
}
