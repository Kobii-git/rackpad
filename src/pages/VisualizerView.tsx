import { useMemo, useState } from "react";
import {
  Cable,
  CircuitBoard,
  Filter,
  Network,
  Route,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
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
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { Mono } from "@/components/shared/Mono";
import { StatusDot } from "@/components/shared/StatusDot";
import { useStore } from "@/lib/store";
import type { Device, Port, PortLink, Rack, Room } from "@/lib/types";
import {
  formatPortEndpointLabel,
  normalizeColorToCss,
  statusLabel,
} from "@/lib/utils";

type ColumnKind = "rack" | "room" | "loose";

interface VisualColumn {
  id: string;
  kind: ColumnKind;
  name: string;
  subtitle: string;
  rack?: Rack;
  room?: Room;
  devices: Device[];
  x: number;
  y: number;
  height: number;
}

interface VisualNode {
  device: Device;
  columnId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualLink {
  link: PortLink;
  fromPort?: Port;
  toPort?: Port;
  fromDevice?: Device;
  toDevice?: Device;
  fromNode?: VisualNode;
  toNode?: VisualNode;
}

const COLUMN_WIDTH = 300;
const COLUMN_GAP = 72;
const COLUMN_TOP = 28;
const COLUMN_LEFT = 28;
const RACK_UNIT_HEIGHT = 16;
const NODE_HEIGHT = 42;
const NODE_WIDTH = 248;
const RACK_NODE_WIDTH = 220;
const LOOSE_ROW_HEIGHT = 58;
const ROOM_COLUMN_PREFIX = "room:";

export default function VisualizerView() {
  const lab = useStore((s) => s.lab);
  const rooms = useStore((s) => s.rooms);
  const racks = useStore((s) => s.racks);
  const devices = useStore((s) => s.devices);
  const ports = useStore((s) => s.ports);
  const portLinks = useStore((s) => s.portLinks);
  const [cableType, setCableType] = useState<string>("all");
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const model = useMemo(() => {
    const deviceById = indexById(devices);
    const portById = indexById(ports);
    const portsByDeviceId = groupBy(ports, (port) => port.deviceId);
    const roomById = indexById(rooms);
    const rackColumns = racks.map((rack, index) => {
      const rackDevices = devices
        .filter((device) => device.rackId === rack.id)
        .sort(compareRackDevices);
      const rackHeight = Math.max(
        rack.totalU * RACK_UNIT_HEIGHT + 96,
        rackDevices.length * (NODE_HEIGHT + 8) + 112,
        320,
      );
      return {
        id: rack.id,
        kind: "rack" as const,
        name: rack.name,
        subtitle:
          (rack.roomId ? roomById[rack.roomId]?.name : undefined) ??
          rack.location ??
          `${rack.totalU}U rack`,
        rack,
        devices: rackDevices,
        x: COLUMN_LEFT + index * (COLUMN_WIDTH + COLUMN_GAP),
        y: COLUMN_TOP,
        height: rackHeight,
      };
    });

    const rackIds = new Set(racks.map((rack) => rack.id));
    const looseDevices = devices
      .filter((device) => !device.rackId || !rackIds.has(device.rackId))
      .sort((a, b) => a.hostname.localeCompare(b.hostname));
    const looseDevicesByRoom = groupBy(
      looseDevices.filter((device) => device.roomId && roomById[device.roomId]),
      (device) => device.roomId!,
    );
    const roomColumns = rooms.map((room, index) => {
      const roomDevices = (looseDevicesByRoom[room.id] ?? []).sort((a, b) =>
        a.hostname.localeCompare(b.hostname),
      );
      return {
        id: `${ROOM_COLUMN_PREFIX}${room.id}`,
        kind: "room" as const,
        name: room.name,
        subtitle: room.location ?? room.description ?? "Room context",
        room,
        devices: roomDevices,
        x:
          COLUMN_LEFT +
          (rackColumns.length + index) * (COLUMN_WIDTH + COLUMN_GAP),
        y: COLUMN_TOP,
        height: Math.max(360, roomDevices.length * LOOSE_ROW_HEIGHT + 112),
      };
    });
    const unassignedLooseDevices = looseDevices.filter(
      (device) => !device.roomId || !roomById[device.roomId],
    );
    const looseColumn: VisualColumn | null =
      unassignedLooseDevices.length > 0
        ? {
            id: "__loose__",
            kind: "loose",
            name: "Loose / unassigned",
            subtitle: "Unracked gear without a room",
            devices: unassignedLooseDevices,
            x:
              COLUMN_LEFT +
              (rackColumns.length + roomColumns.length) *
                (COLUMN_WIDTH + COLUMN_GAP),
            y: COLUMN_TOP,
            height: Math.max(
              360,
              unassignedLooseDevices.length * LOOSE_ROW_HEIGHT + 112,
            ),
          }
        : null;

    const columns = looseColumn
      ? [...rackColumns, ...roomColumns, looseColumn]
      : [...rackColumns, ...roomColumns];
    const nodes = buildNodes(columns);
    const nodeByDeviceId = nodes.reduce<Record<string, VisualNode>>(
      (acc, node) => {
        acc[node.device.id] = node;
        return acc;
      },
      {},
    );

    const links = portLinks.map((link) => {
      const fromPort = portById[link.fromPortId];
      const toPort = portById[link.toPortId];
      const fromDevice = fromPort ? deviceById[fromPort.deviceId] : undefined;
      const toDevice = toPort ? deviceById[toPort.deviceId] : undefined;
      return {
        link,
        fromPort,
        toPort,
        fromDevice,
        toDevice,
        fromNode: fromDevice ? nodeByDeviceId[fromDevice.id] : undefined,
        toNode: toDevice ? nodeByDeviceId[toDevice.id] : undefined,
      };
    });

    const width = Math.max(
      760,
      columns.length * COLUMN_WIDTH +
        Math.max(0, columns.length - 1) * COLUMN_GAP +
        56,
    );
    const height = Math.max(
      560,
      ...columns.map((column) => column.height + 56),
    );
    const crossRackLinks = links.filter(
      (link) =>
        link.fromNode &&
        link.toNode &&
        link.fromNode.columnId !== link.toNode.columnId,
    ).length;
    const patchPanelLinks = links.filter(
      (link) =>
        link.fromDevice?.deviceType === "patch_panel" ||
        link.toDevice?.deviceType === "patch_panel",
    ).length;

    return {
      columns,
      nodes,
      links,
      deviceById,
      portsByDeviceId,
      width,
      height,
      crossRackLinks,
      patchPanelLinks,
      cableTypes: Array.from(
        new Set(portLinks.map((link) => link.cableType ?? "Unknown")),
      ).sort((a, b) => a.localeCompare(b)),
    };
  }, [devices, portLinks, ports, racks, rooms]);

  const visibleLinks = useMemo(() => {
    return model.links.filter((entry) => {
      if (
        cableType !== "all" &&
        (entry.link.cableType ?? "Unknown") !== cableType
      ) {
        return false;
      }
      if (selectedDeviceId) {
        return (
          entry.fromDevice?.id === selectedDeviceId ||
          entry.toDevice?.id === selectedDeviceId
        );
      }
      return true;
    });
  }, [cableType, model.links, selectedDeviceId]);

  const selectedLink =
    (selectedLinkId
      ? model.links.find((entry) => entry.link.id === selectedLinkId)
      : undefined) ?? visibleLinks[0];
  const selectedDevice = selectedDeviceId
    ? model.deviceById[selectedDeviceId]
    : selectedLink?.fromDevice;

  return (
    <>
      <TopBar
        subtitle="Topology"
        title="Visualizer"
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {lab.name} | {portLinks.length} cables | {devices.length} devices
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <select
              value={cableType}
              onChange={(event) => {
                setCableType(event.target.value);
                setSelectedLinkId(null);
              }}
              className="rk-control h-8 w-40 px-2 text-xs text-[var(--text-primary)]"
              aria-label="Filter visualized cables by type"
            >
              <option value="all">All cable types</option>
              {model.cableTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            {selectedDeviceId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedDeviceId(null)}
              >
                <Filter className="size-3.5" />
                Clear device
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-1 gap-4 overflow-hidden px-6 py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            <VisualizerStat
              icon={Server}
              label="Devices"
              value={devices.length}
              hint={`${racks.length} racks mapped`}
            />
            <VisualizerStat
              icon={Cable}
              label="Cables"
              value={visibleLinks.length}
              hint={
                cableType === "all" ? "shown on canvas" : `${cableType} filter`
              }
            />
            <VisualizerStat
              icon={Route}
              label="Cross-rack"
              value={model.crossRackLinks}
              hint="links crossing columns"
            />
            <VisualizerStat
              icon={CircuitBoard}
              label="Patch panel"
              value={model.patchPanelLinks}
              hint="front/rear handoffs"
            />
          </div>

          <Card className="min-h-0 flex flex-1 flex-col">
            <CardHeader>
              <CardTitle>
                <CardLabel>Rack cable map</CardLabel>
                <CardHeading>Physical and logical cable paths</CardHeading>
              </CardTitle>
              <Badge tone="cyan">
                <Network className="size-3" />
                Existing inventory data
              </Badge>
            </CardHeader>
            <CardBody className="min-h-0 flex-1 p-0">
              <div className="h-full overflow-auto">
                <div
                  className="relative mx-auto"
                  style={{ width: model.width, height: model.height }}
                >
                  <svg
                    className="pointer-events-none absolute inset-0 z-[35]"
                    width={model.width}
                    height={model.height}
                    role="img"
                    aria-label="Cable links between rack devices"
                  >
                    <defs>
                      <filter
                        id="rackpad-cable-glow"
                        x="-20%"
                        y="-20%"
                        width="140%"
                        height="140%"
                      >
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    {visibleLinks.map((entry, index) => (
                      <CablePath
                        key={entry.link.id}
                        entry={entry}
                        index={index}
                        selected={entry.link.id === selectedLink?.link.id}
                      />
                    ))}
                  </svg>

                  <svg
                    className="absolute inset-0 z-[38]"
                    width={model.width}
                    height={model.height}
                    aria-hidden
                  >
                    {visibleLinks.map((entry, index) => {
                      const hitPath = cablePath(entry, index);
                      if (!hitPath) return null;
                      return (
                        <path
                          key={`${entry.link.id}-hit`}
                          d={hitPath}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={18}
                          className="cursor-pointer"
                          onClick={() => setSelectedLinkId(entry.link.id)}
                        />
                      );
                    })}
                  </svg>

                  <div className="absolute inset-0 z-30">
                    {visibleLinks.length === 0 && (
                      <CanvasEmptyState
                        cableType={cableType}
                        hasAnyCables={portLinks.length > 0}
                      />
                    )}
                    {model.columns.map((column) => (
                      <RackColumn
                        key={column.id}
                        column={column}
                        nodes={model.nodes.filter(
                          (node) => node.columnId === column.id,
                        )}
                      />
                    ))}
                  </div>
                  <div className="absolute inset-0 z-40">
                    {model.nodes.map((node) => (
                      <DeviceNode
                        key={node.device.id}
                        node={node}
                        selected={selectedDeviceId === node.device.id}
                        onClick={() => {
                          setSelectedDeviceId((current) =>
                            current === node.device.id ? null : node.device.id,
                          );
                          setSelectedLinkId(null);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        <aside className="hidden h-full min-h-0 w-96 shrink-0 flex-col gap-4 overflow-hidden xl:flex">
          <Inspector
            selectedLink={selectedLink}
            selectedDevice={selectedDevice}
            portsByDeviceId={model.portsByDeviceId}
            visibleLinks={visibleLinks}
            onSelectLink={(id) => setSelectedLinkId(id)}
            onSelectDevice={(id) => {
              setSelectedDeviceId(id);
              setSelectedLinkId(null);
            }}
          />
        </aside>
      </div>
    </>
  );
}

function buildNodes(columns: VisualColumn[]) {
  const nodes: VisualNode[] = [];
  for (const column of columns) {
    const planned = column.devices
      .map((device, index) => ({
        device,
        index,
        y:
          column.kind === "rack" && column.rack && device.startU
            ? rackDeviceY(column, device)
            : column.y + 78 + index * LOOSE_ROW_HEIGHT,
      }))
      .sort((a, b) => a.y - b.y || a.index - b.index);

    let lastBottom = column.y + 76;
    for (const entry of planned) {
      const nodeWidth = column.kind === "rack" ? RACK_NODE_WIDTH : NODE_WIDTH;
      const nodeX = column.x + (COLUMN_WIDTH - nodeWidth) / 2;
      const minY = column.y + 78;
      const maxY = column.y + column.height - NODE_HEIGHT - 14;
      const nodeY = clamp(Math.max(entry.y, lastBottom + 6), minY, maxY);
      lastBottom = nodeY + NODE_HEIGHT;
      nodes.push({
        device: entry.device,
        columnId: column.id,
        x: nodeX,
        y: nodeY,
        width: nodeWidth,
        height: NODE_HEIGHT,
      });
    }
  }
  return nodes;
}

function rackDeviceY(column: VisualColumn, device: Device) {
  const rack = column.rack;
  if (!rack || !device.startU) return column.y + 68;
  const heightU = device.heightU ?? 1;
  const centerUFromTop = rack.totalU - device.startU - heightU / 2 + 1;
  return column.y + 58 + centerUFromTop * RACK_UNIT_HEIGHT - NODE_HEIGHT / 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function RackColumn({
  column,
  nodes,
}: {
  column: VisualColumn;
  nodes: VisualNode[];
}) {
  return (
    <div
      className="absolute rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[linear-gradient(180deg,rgb(255_255_255_/_0.025),transparent_18%),var(--surface-1)] shadow-[var(--shadow-card)]"
      style={{
        left: column.x,
        top: column.y,
        width: COLUMN_WIDTH,
        height: column.height,
      }}
    >
      <div className="border-b border-[var(--border-subtle)] px-3 py-3">
        <div className="rk-kicker">
          {column.kind === "rack"
            ? "Rack"
            : column.kind === "room"
              ? "Room"
              : "Zone"}
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">
          {column.name}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]">
          {column.subtitle}
        </div>
      </div>

      {column.kind === "rack" && column.rack && (
        <>
          <div className="absolute bottom-3 left-12 right-3 top-20 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[rgb(0_0_0_/_0.10)]">
            {Array.from({ length: column.rack.totalU }, (_, index) => (
              <div
                key={index}
                className="border-b border-[rgb(255_255_255_/_0.028)] last:border-b-0"
                style={{
                  height: RACK_UNIT_HEIGHT,
                  background:
                    index % 2 === 0
                      ? "rgb(255 255 255 / 0.012)"
                      : "transparent",
                }}
              />
            ))}
          </div>
          <div className="absolute bottom-3 left-3 top-20 w-8 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(0_0_0_/_0.16)]">
            {Array.from({ length: column.rack.totalU }, (_, index) => {
              const u = column.rack!.totalU - index;
              return (
                <div
                  key={u}
                  className="flex items-center justify-center border-b border-[rgb(255_255_255_/_0.025)] font-mono text-[8px] text-[var(--text-muted)] last:border-b-0"
                  style={{ height: RACK_UNIT_HEIGHT }}
                >
                  {u % 2 === 0 ? u : ""}
                </div>
              );
            })}
          </div>
        </>
      )}

      {nodes.length === 0 && (
        <div className="absolute inset-x-4 top-24 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] bg-[rgb(255_255_255_/_0.014)] p-4 text-xs text-[var(--text-tertiary)]">
          No devices in this column yet.
        </div>
      )}
    </div>
  );
}

function DeviceNode({
  node,
  selected,
  onClick,
}: {
  node: VisualNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute z-40 flex items-center gap-2 overflow-hidden rounded-[var(--radius-md)] border px-2.5 py-2 pl-3.5 text-left transition-[background-color,border-color,box-shadow,transform] ${
        selected
          ? "border-[var(--accent-primary-border)] bg-[var(--surface-selected)] shadow-[var(--shadow-selected)]"
          : "border-[var(--border-default)] bg-[var(--surface-2)] hover:-translate-y-px hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
      }`}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
      }}
    >
      <span className="pointer-events-none absolute inset-y-1 left-1 w-0.5 rounded-full bg-[var(--accent-primary)] opacity-75" />
      <DeviceTypeIcon
        type={node.device.deviceType}
        className="size-4 shrink-0 text-[var(--accent-primary)]"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
          {node.device.hostname}
        </div>
        <div className="truncate font-mono text-[9px] text-[var(--text-tertiary)]">
          {node.device.managementIp ?? node.device.deviceType.replace("_", " ")}
        </div>
      </div>
      <StatusDot status={node.device.status} />
    </button>
  );
}

function CanvasEmptyState({
  hasAnyCables,
  cableType,
}: {
  hasAnyCables: boolean;
  cableType: string;
}) {
  return (
    <div className="absolute bottom-5 right-5 z-50 w-80 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_88%,transparent)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] border border-[var(--accent-secondary-border)] bg-[var(--accent-secondary-soft)] text-[var(--accent-secondary)]">
          <Cable className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {hasAnyCables ? "No cables match this view" : "No cable paths yet"}
          </div>
          <div className="mt-1 text-xs leading-5 text-[var(--text-tertiary)]">
            {hasAnyCables
              ? `The ${cableType} filter is hiding every documented cable. Switch back to all cable types or pick another filter.`
              : "Add cable links in the Cables workspace and Rackpad will draw the physical paths here."}
          </div>
        </div>
      </div>
    </div>
  );
}

function CablePath({
  entry,
  index,
  selected,
}: {
  entry: VisualLink;
  index: number;
  selected: boolean;
}) {
  const path = cablePath(entry, index);
  if (!path) return null;
  const color = normalizeColorToCss(entry.link.color) ?? cableTypeColor(entry);
  return (
    <path
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={selected ? 3 : 1.6}
      strokeOpacity={selected ? 0.96 : 0.42}
      strokeLinecap="round"
      filter={selected ? "url(#rackpad-cable-glow)" : undefined}
      strokeDasharray={entry.fromNode && entry.toNode ? undefined : "4 6"}
    />
  );
}

function cablePath(entry: VisualLink, index: number) {
  if (!entry.fromNode || !entry.toNode) return null;
  const from = connectorPoint(entry.fromNode, entry.toNode);
  const to = connectorPoint(entry.toNode, entry.fromNode);
  const dx = Math.abs(to.x - from.x);
  const curve = Math.max(60, dx * 0.42);
  const offset = ((index % 7) - 3) * 6;
  return `M ${from.x} ${from.y + offset} C ${from.x + curve} ${from.y + offset}, ${to.x - curve} ${to.y - offset}, ${to.x} ${to.y - offset}`;
}

function connectorPoint(node: VisualNode, peer: VisualNode) {
  const towardRight = peer.x >= node.x;
  return {
    x: towardRight ? node.x + node.width : node.x,
    y: node.y + node.height / 2,
  };
}

function Inspector({
  selectedLink,
  selectedDevice,
  portsByDeviceId,
  visibleLinks,
  onSelectLink,
  onSelectDevice,
}: {
  selectedLink?: VisualLink;
  selectedDevice?: Device;
  portsByDeviceId: Record<string, Port[]>;
  visibleLinks: VisualLink[];
  onSelectLink: (id: string) => void;
  onSelectDevice: (id: string) => void;
}) {
  return (
    <>
      <Card className="shrink-0">
        <CardHeader>
          <CardTitle>
            <CardLabel>Inspector</CardLabel>
            <CardHeading>
              {selectedLink ? "Selected cable" : "Select a link"}
            </CardHeading>
          </CardTitle>
          {selectedLink && (
            <Badge>{selectedLink.link.cableType ?? "Cable"}</Badge>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          {!selectedLink ? (
            <div className="rk-empty">
              <div className="rk-empty-title">No cable selected</div>
              <div className="rk-empty-copy">
                Click any cable line to inspect its endpoints and metadata.
              </div>
            </div>
          ) : (
            <>
              <EndpointButton
                label="From"
                device={selectedLink.fromDevice}
                port={selectedLink.fromPort}
                onClick={() =>
                  selectedLink.fromDevice &&
                  onSelectDevice(selectedLink.fromDevice.id)
                }
              />
              <EndpointButton
                label="To"
                device={selectedLink.toDevice}
                port={selectedLink.toPort}
                onClick={() =>
                  selectedLink.toDevice &&
                  onSelectDevice(selectedLink.toDevice.id)
                }
              />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <InfoBox label="Type" value={selectedLink.link.cableType} />
                <InfoBox label="Length" value={selectedLink.link.cableLength} />
                <InfoBox label="Color" value={selectedLink.link.color} />
                <InfoBox label="Notes" value={selectedLink.link.notes} />
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle>
            <CardLabel>Device context</CardLabel>
            <CardHeading>
              {selectedDevice?.hostname ?? "No device selected"}
            </CardHeading>
          </CardTitle>
          {selectedDevice && (
            <Badge tone={statusBadgeTone(selectedDevice.status)}>
              <StatusDot status={selectedDevice.status} />
              {statusLabel[selectedDevice.status]}
            </Badge>
          )}
        </CardHeader>
        <CardBody>
          {!selectedDevice ? (
            <div className="text-sm text-[var(--text-tertiary)]">
              Select a cable or device to see its local port context.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <DeviceTypeIcon
                  type={selectedDevice.deviceType}
                  className="size-4 text-[var(--accent-primary)]"
                />
                <span className="text-sm capitalize text-[var(--text-primary)]">
                  {selectedDevice.deviceType.replace("_", " ")}
                </span>
                {selectedDevice.managementIp && (
                  <Mono className="ml-auto text-[var(--text-secondary)]">
                    {selectedDevice.managementIp}
                  </Mono>
                )}
              </div>
              <div className="space-y-2">
                {(portsByDeviceId[selectedDevice.id] ?? [])
                  .slice(0, 10)
                  .map((port) => (
                    <div
                      key={port.id}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-[var(--text-primary)]">
                          {port.name}
                        </div>
                        <Mono className="text-[10px] text-[var(--text-tertiary)]">
                          {port.kind} | {port.speed ?? "speed n/a"} |{" "}
                          {port.mode}
                        </Mono>
                      </div>
                      <span
                        className={`size-2 rounded-full ${
                          port.linkState === "up"
                            ? "bg-[var(--accent-secondary)]"
                            : "bg-[var(--text-muted)]"
                        }`}
                      />
                    </div>
                  ))}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader>
          <CardTitle>
            <CardLabel>Visible links</CardLabel>
            <CardHeading>{visibleLinks.length} cables</CardHeading>
          </CardTitle>
        </CardHeader>
        <CardBody className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {visibleLinks.map((entry) => (
            <button
              key={entry.link.id}
              type="button"
              onClick={() => onSelectLink(entry.link.id)}
              className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-2.5 py-2 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
            >
              <div className="min-w-0">
                <div className="truncate text-xs text-[var(--text-primary)]">
                  {entry.fromDevice?.hostname ?? "Unknown"} to{" "}
                  {entry.toDevice?.hostname ?? "Unknown"}
                </div>
                <Mono className="text-[10px] text-[var(--text-tertiary)]">
                  {entry.fromPort?.name ?? "?"} to {entry.toPort?.name ?? "?"}
                </Mono>
              </div>
              <CableSwatch link={entry.link} />
            </button>
          ))}
        </CardBody>
      </Card>
    </>
  );
}

function EndpointButton({
  label,
  device,
  port,
  onClick,
}: {
  label: string;
  device?: Device;
  port?: Port;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!device}
      className="rk-panel-inset flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] p-3 text-left transition-colors hover:border-[var(--border-strong)] disabled:pointer-events-none disabled:opacity-60"
    >
      <div className="min-w-0">
        <div className="rk-kicker">{label}</div>
        <div className="mt-1 truncate text-sm font-medium text-[var(--text-primary)]">
          {device?.hostname ?? "Unknown device"}
        </div>
        <Mono className="text-[10px] text-[var(--text-tertiary)]">
          {port
            ? formatPortEndpointLabel(port, device, { includeFace: true })
            : "Unknown port"}
        </Mono>
      </div>
      {device && (
        <DeviceTypeIcon
          type={device.deviceType}
          className="size-5 shrink-0 text-[var(--accent-primary)]"
        />
      )}
    </button>
  );
}

function InfoBox({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] p-2">
      <div className="rk-kicker">{label}</div>
      <div className="mt-1 break-words text-xs text-[var(--text-primary)]">
        {value || "-"}
      </div>
    </div>
  );
}

function VisualizerStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <Card>
      <CardBody className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="rk-kicker">{label}</div>
            <div className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
              {value}
            </div>
            <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
              {hint}
            </div>
          </div>
          <div className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--accent-secondary-border)] bg-[var(--accent-secondary-soft)] text-[var(--accent-secondary)]">
            <Icon className="size-4" />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function CableSwatch({ link }: { link: PortLink }) {
  const color = normalizeColorToCss(link.color) ?? cableTypeColor({ link });
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span
        className="size-2.5 rounded-full border border-[var(--border-strong)]"
        style={{ backgroundColor: color }}
      />
      <span className="font-mono text-[10px] uppercase text-[var(--text-tertiary)]">
        {link.cableType ?? "Cable"}
      </span>
    </span>
  );
}

function cableTypeColor(entry: Pick<VisualLink, "link">) {
  const type = (entry.link.cableType ?? "").toLowerCase();
  if (type.includes("dac")) return "var(--accent-secondary)";
  if (type.includes("fiber") || type.includes("om")) return "var(--info)";
  if (type.includes("cat")) return "var(--accent-primary)";
  return "var(--neutral)";
}

function compareRackDevices(a: Device, b: Device) {
  const byU = (b.startU ?? 0) - (a.startU ?? 0);
  if (byU !== 0) return byU;
  return a.hostname.localeCompare(b.hostname);
}

function indexById<T extends { id: string }>(items: T[]) {
  return items.reduce<Record<string, T>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    (acc[getKey(item)] ??= []).push(item);
    return acc;
  }, {});
}

function statusBadgeTone(
  status: Device["status"],
): "ok" | "warn" | "err" | "info" | "neutral" {
  switch (status) {
    case "online":
      return "ok";
    case "warning":
      return "warn";
    case "offline":
      return "err";
    case "maintenance":
      return "info";
    default:
      return "neutral";
  }
}
