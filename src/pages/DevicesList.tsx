import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { DeviceDrawer } from "@/components/shared/DeviceDrawer";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Mono } from "@/components/shared/Mono";
import { StatusDot } from "@/components/shared/StatusDot";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { canEditInventory, useStore } from "@/lib/store";
import type { Device, DeviceType, Port, Rack, Room } from "@/lib/types";
import { ChevronRight, Filter, Plus } from "lucide-react";
import { statusLabel } from "@/lib/utils";

const TYPES: DeviceType[] = [
  "switch",
  "router",
  "firewall",
  "server",
  "rack_shelf",
  "ap",
  "endpoint",
  "vm",
  "storage",
  "patch_panel",
  "brush_panel",
  "blanking_panel",
  "pdu",
  "ups",
];

type SortKey = "hostname" | "managementIp" | "placement" | "status";
type SortDirection = "asc" | "desc";

interface DeviceSort {
  key: SortKey;
  direction: SortDirection;
}

export default function DevicesList() {
  const currentUser = useStore((s) => s.currentUser);
  const devices = useStore((s) => s.devices);
  const rooms = useStore((s) => s.rooms);
  const racks = useStore((s) => s.racks);
  const ports = useStore((s) => s.ports);
  const canEdit = canEditInventory(currentUser);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<DeviceType | null>(null);
  const [sort, setSort] = useState<DeviceSort>({
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
          device.deviceType,
          ...(device.tags ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
      .sort((a, b) =>
        compareDevices(a, b, sort, rackById, roomById, deviceById),
      );
  }, [deviceById, devices, query, rackById, roomById, sort, type]);

  function handleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { key, direction: "asc" },
    );
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
          {TYPES.map((entry) => {
            const count = typeCounts[entry] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={entry}
                onClick={() => setType(entry)}
                className={`inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] border px-2.5 py-1 transition-colors ${
                  type === entry
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent-strong)]"
                    : "border-[var(--color-line)] text-[var(--color-fg-muted)] hover:border-[var(--color-line-strong)]"
                }`}
              >
                <DeviceTypeIcon type={entry} className="size-3" />
                <span className="font-mono text-[10px] uppercase tracking-wider capitalize">
                  {entry.replace("_", " ")}
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
            placeholder="Search hostname, model, IP, tag..."
            className="pl-7"
          />
        </div>

        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-line)] bg-[var(--color-bg-2)]">
                  <Th />
                  <SortableTh
                    sortKey="hostname"
                    sort={sort}
                    onSort={handleSort}
                  >
                    Hostname
                  </SortableTh>
                  <Th>Type</Th>
                  <Th>Model</Th>
                  <SortableTh
                    sortKey="managementIp"
                    sort={sort}
                    onSort={handleSort}
                  >
                    Mgmt IP
                  </SortableTh>
                  <SortableTh
                    sortKey="placement"
                    sort={sort}
                    onSort={handleSort}
                  >
                    Placement
                  </SortableTh>
                  <Th>Ports</Th>
                  <SortableTh
                    sortKey="status"
                    sort={sort}
                    onSort={handleSort}
                  >
                    Status
                  </SortableTh>
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
                  const room = device.roomId ? roomById[device.roomId] : undefined;
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
                          {device.deviceType.replace("_", " ")}
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

function SortableTh({
  children,
  sortKey,
  sort,
  onSort,
}: {
  children: ReactNode;
  sortKey: SortKey;
  sort: DeviceSort;
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      aria-sort={
        active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"
      }
      className="px-3 py-1.5 text-left font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1.5 transition-colors hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/50 ${
          active ? "text-[var(--color-accent)]" : ""
        }`}
      >
        <span>{children}</span>
        <span className="text-[9px]" aria-hidden>
          {active ? (sort.direction === "asc" ? "^" : "v") : ""}
        </span>
      </button>
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
  sort: DeviceSort,
  rackById: Record<string, Rack>,
  roomById: Record<string, Room>,
  deviceById: Record<string, Device>,
) {
  let result = 0;

  if (sort.key === "hostname") {
    result = compareText(a.hostname, b.hostname);
  } else if (sort.key === "managementIp") {
    result = compareIp(a.managementIp, b.managementIp);
  } else if (sort.key === "placement") {
    result = compareText(
      devicePlacementSortValue(a, rackById, roomById, deviceById),
      devicePlacementSortValue(b, rackById, roomById, deviceById),
    );
  } else {
    result = compareText(statusLabel[a.status], statusLabel[b.status]);
  }

  if (result === 0) {
    result = compareText(a.hostname, b.hostname);
  }

  return sort.direction === "asc" ? result : -result;
}

function compareText(a?: string | null, b?: string | null) {
  const left = a?.trim();
  const right = b?.trim();
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareIp(a?: string | null, b?: string | null) {
  const left = parseIpv4(a);
  const right = parseIpv4(b);
  if (!left && !right) return compareText(a, b);
  if (!left) return 1;
  if (!right) return -1;

  for (let index = 0; index < left.length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function parseIpv4(value?: string | null) {
  const parts = value?.trim().split(".").map(Number);
  if (
    !parts ||
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts;
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
