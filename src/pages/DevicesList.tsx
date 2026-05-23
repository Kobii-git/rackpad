import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/shared/Mono";
import { SortableHeader } from "@/components/shared/SortableHeader";
import { StatusDot } from "@/components/shared/StatusDot";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { canEditInventory, useStore } from "@/lib/store";
import type { Device, DeviceType, Port, Rack, Room } from "@/lib/types";
import { ChevronRight, Filter, Plus } from "lucide-react";
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

export default function DevicesList() {
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
    type,
  ]);

  function handleSort(key: SortKey) {
    setSort((current) => toggleSort(current, key));
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
            onClick={() => setType(null)}
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
          {deviceTypes.map((entry) => {
            const count = typeCounts[entry.id] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={entry.id}
                onClick={() => setType(entry.id)}
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

        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
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
