import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/Button";
import { useStore } from "@/lib/store";
import { buildVisualizerModel } from "./visualizer/model";
import { DiagramCanvas } from "./visualizer/DiagramCanvas";
import { VisualizerCanvas } from "./visualizer/VisualizerCanvas";
import type {
  TraceModeState,
  VisualizerCableLayout,
  VisualizerLayoutMode,
  VisualizerLooseDevicePlacement,
  VisualizerNode,
  VisualizerOrderSettings,
  VisualizerPoint,
  VisualizerRackFaceMode,
  VisualizerRackScale,
  VisualizerShelfLayout,
} from "./visualizer/types";

const HEALTH_STORAGE_KEY = "rackpad.visualizer.health";
const NO_CABLE_BANNER_KEY = "rackpad.visualizer.no-cable-banner.dismissed";
const LOOSE_PLACEMENT_STORAGE_KEY = "rackpad.visualizer.loose-placement";
const ROOM_ONLY_SECTIONS_STORAGE_KEY = "rackpad.visualizer.room-only-sections";
const LAYOUT_MODE_STORAGE_KEY = "rackpad.visualizer.layout-mode";
const RACK_FACE_MODE_STORAGE_KEY = "rackpad.visualizer.rack-face-mode";
const RACK_SCALE_STORAGE_KEY = "rackpad.visualizer.rack-scale";
const SHELF_LAYOUT_STORAGE_KEY = "rackpad.visualizer.shelf-layout";
const READABLE_LABELS_STORAGE_KEY = "rackpad.visualizer.readable-labels";
const CABLE_LAYOUT_STORAGE_KEY = "rackpad.visualizer.cable-layout";
const CUSTOM_NODE_POSITIONS_STORAGE_KEY =
  "rackpad.visualizer.custom-node-positions";
const ORDER_STORAGE_KEY = "rackpad.visualizer.order";

type MoveDirection = "up" | "down";

interface VisualizerOrderListItem {
  id: string;
  label: string;
  detail?: string;
}

interface VisualizerOrderGroupItem extends VisualizerOrderListItem {
  nodes: VisualizerNode[];
  total: number;
}

const EMPTY_ORDER_SETTINGS: VisualizerOrderSettings = {
  sections: [],
  racks: [],
  groups: [],
  devicesByGroup: {},
};

export default function VisualizerView() {
  const { t } = useI18n();
  const lab = useStore((s) => s.lab);
  const loading = useStore((s) => s.loading);
  const loaded = useStore((s) => s.loaded);
  const rooms = useStore((s) => s.rooms);
  const racks = useStore((s) => s.racks);
  const devices = useStore((s) => s.devices);
  const deviceTypes = useStore((s) => s.deviceTypes);
  const ports = useStore((s) => s.ports);
  const portLinks = useStore((s) => s.portLinks);
  const deviceMonitors = useStore((s) => s.deviceMonitors);
  const subnets = useStore((s) => s.subnets);
  const vlans = useStore((s) => s.vlans);
  const discoveredDevices = useStore((s) => s.discoveredDevices);
  const virtualSwitches = useStore((s) => s.virtualSwitches);
  const wifiSsids = useStore((s) => s.wifiSsids);
  const wifiAccessPoints = useStore((s) => s.wifiAccessPoints);
  const wifiClientAssociations = useStore((s) => s.wifiClientAssociations);
  const [cableType, setCableType] = useState("all");
  const [expandedRackRuns, setExpandedRackRuns] = useState<Set<string>>(() =>
    readSessionSet("rackpad.visualizer.expanded-rack-runs"),
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() =>
    readSessionSet("rackpad.visualizer.collapsed-groups"),
  );
  const [healthOverlay, setHealthOverlay] = useState(() =>
    readBoolean(HEALTH_STORAGE_KEY, false),
  );
  const [layoutMode, setLayoutMode] = useState<VisualizerLayoutMode>(() =>
    readLayoutMode(LAYOUT_MODE_STORAGE_KEY),
  );
  const [rackFaceMode, setRackFaceMode] = useState<VisualizerRackFaceMode>(() =>
    readRackFaceMode(RACK_FACE_MODE_STORAGE_KEY),
  );
  const [rackScale, setRackScale] = useState<VisualizerRackScale>(() =>
    readRackScale(RACK_SCALE_STORAGE_KEY),
  );
  const [shelfLayout, setShelfLayout] = useState<VisualizerShelfLayout>(() =>
    readShelfLayout(SHELF_LAYOUT_STORAGE_KEY),
  );
  const [readableLabels, setReadableLabels] = useState(() =>
    readBoolean(READABLE_LABELS_STORAGE_KEY, false),
  );
  const [cableLayout, setCableLayout] = useState<VisualizerCableLayout>(() =>
    readCableLayout(CABLE_LAYOUT_STORAGE_KEY),
  );
  const [customNodePositions, setCustomNodePositions] = useState<
    Record<string, VisualizerPoint>
  >(() => readPointMap(CUSTOM_NODE_POSITIONS_STORAGE_KEY));
  const [orderSettings, setOrderSettings] =
    useState<VisualizerOrderSettings>(() => readOrderSettings(ORDER_STORAGE_KEY));
  const [orderPanelOpen, setOrderPanelOpen] = useState(false);
  const [selectedOrderGroupId, setSelectedOrderGroupId] = useState("");
  const [looseDevicePlacement, setLooseDevicePlacement] =
    useState<VisualizerLooseDevicePlacement>(() =>
      readLooseDevicePlacement(LOOSE_PLACEMENT_STORAGE_KEY),
    );
  const [includeRoomOnlySections, setIncludeRoomOnlySections] = useState(() =>
    readBoolean(ROOM_ONLY_SECTIONS_STORAGE_KEY, false),
  );
  const [noCableBannerDismissed, setNoCableBannerDismissed] = useState(() =>
    readBoolean(NO_CABLE_BANNER_KEY, false),
  );
  const [traceMode, setTraceMode] = useState<TraceModeState>({
    enabled: false,
    firstPortId: null,
    result: null,
    message: null,
  });

  const model = useMemo(
    () =>
      buildVisualizerModel({
        racks,
        rooms,
        devices,
        deviceTypes,
        ports,
        portLinks,
        deviceMonitors,
        subnets,
        vlans,
        discoveredDevices,
        virtualSwitches,
        expandedRackRuns,
        collapsedGroups,
        layout: {
          topologyLayout: layoutMode,
          looseDevicePlacement,
          includeRoomOnlySections,
          rackFaceMode,
          rackScale,
          shelfLayout,
          readableLabels,
          customNodePositions,
          order: orderSettings,
        },
      }),
    [
      racks,
      rooms,
      devices,
      deviceTypes,
      ports,
      portLinks,
      deviceMonitors,
      subnets,
      vlans,
      discoveredDevices,
      virtualSwitches,
      expandedRackRuns,
      collapsedGroups,
      layoutMode,
      rackFaceMode,
      rackScale,
      shelfLayout,
      readableLabels,
      customNodePositions,
      orderSettings,
      looseDevicePlacement,
      includeRoomOnlySections,
    ],
  );

  const orderSections = useMemo<VisualizerOrderListItem[]>(
    () =>
      model.rackZone.sections.map((section) => ({
        id: section.id,
        label: section.name,
        detail: section.subtitle,
      })),
    [model],
  );
  const orderRacks = useMemo<VisualizerOrderListItem[]>(
    () =>
      model.rackZone.sections.flatMap((section) =>
        section.racks.map((panel) => ({
          id: panel.rack.id,
          label: panel.rack.name,
          detail: section.name,
        })),
      ),
    [model],
  );
  const orderGroups = useMemo<VisualizerOrderGroupItem[]>(
    () => [
      ...model.rackZone.sections.flatMap((section) =>
        section.looseGroups.map((group) => ({
          id: group.id,
          label: group.name,
          detail: `${section.name} loose devices`,
          nodes: group.nodes,
          total: group.total,
        })),
      ),
      ...model.roomZone.groups.map((group) => ({
        id: group.id,
        label: group.name,
        detail: group.subtitle,
        nodes: group.nodes,
        total: group.total,
      })),
    ],
    [model],
  );
  const selectedOrderGroup =
    orderGroups.find((group) => group.id === selectedOrderGroupId) ??
    orderGroups[0] ??
    null;

  function toggleRackRun(key: string) {
    setExpandedRackRuns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeSessionSet("rackpad.visualizer.expanded-rack-runs", next);
      return next;
    });
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeSessionSet("rackpad.visualizer.collapsed-groups", next);
      return next;
    });
  }

  function toggleHealthOverlay() {
    setHealthOverlay((current) => {
      const next = !current;
      writeBoolean(HEALTH_STORAGE_KEY, next);
      return next;
    });
  }

  function toggleLooseDevicePlacement() {
    setLooseDevicePlacement((current) => {
      const next = current === "below-racks" ? "beside-racks" : "below-racks";
      writeString(LOOSE_PLACEMENT_STORAGE_KEY, next);
      return next;
    });
  }

  function toggleRoomOnlySections() {
    setIncludeRoomOnlySections((current) => {
      const next = !current;
      writeBoolean(ROOM_ONLY_SECTIONS_STORAGE_KEY, next);
      return next;
    });
  }

  function toggleReadableLabels() {
    setReadableLabels((current) => {
      const next = !current;
      writeBoolean(READABLE_LABELS_STORAGE_KEY, next);
      return next;
    });
  }

  function updateCustomNodePosition(
    deviceId: string,
    position: VisualizerPoint,
  ) {
    setCustomNodePositions((current) => {
      const next = {
        ...current,
        [deviceId]: {
          x: Math.round(position.x),
          y: Math.round(position.y),
        },
      };
      writePointMap(CUSTOM_NODE_POSITIONS_STORAGE_KEY, next);
      return next;
    });
  }

  function resetCustomNodePositions() {
    setCustomNodePositions({});
    writePointMap(CUSTOM_NODE_POSITIONS_STORAGE_KEY, {});
  }

  function updateOrderSettings(
    updater: (current: VisualizerOrderSettings) => VisualizerOrderSettings,
  ) {
    setOrderSettings((current) => {
      const next = sanitizeOrderSettings(updater(current));
      writeOrderSettings(ORDER_STORAGE_KEY, next);
      return next;
    });
  }

  function moveSection(id: string, direction: MoveDirection) {
    updateOrderSettings((current) => ({
      ...current,
      sections: moveOrderedId(
        current.sections,
        orderSections.map((section) => section.id),
        id,
        direction,
      ),
    }));
  }

  function moveRack(id: string, direction: MoveDirection) {
    updateOrderSettings((current) => ({
      ...current,
      racks: moveOrderedId(
        current.racks,
        orderRacks.map((rack) => rack.id),
        id,
        direction,
      ),
    }));
  }

  function moveGroup(id: string, direction: MoveDirection) {
    updateOrderSettings((current) => ({
      ...current,
      groups: moveOrderedId(
        current.groups,
        orderGroups.map((group) => group.id),
        id,
        direction,
      ),
    }));
  }

  function moveDeviceInGroup(
    groupId: string,
    deviceId: string,
    direction: MoveDirection,
  ) {
    const group = orderGroups.find((entry) => entry.id === groupId);
    if (!group) return;
    updateOrderSettings((current) => ({
      ...current,
      devicesByGroup: {
        ...current.devicesByGroup,
        [groupId]: moveOrderedId(
          current.devicesByGroup[groupId] ?? [],
          group.nodes.map((node) => node.device.id),
          deviceId,
          direction,
        ),
      },
    }));
  }

  function resetVisualizerOrder() {
    setOrderSettings(EMPTY_ORDER_SETTINGS);
    writeOrderSettings(ORDER_STORAGE_KEY, EMPTY_ORDER_SETTINGS);
  }

  return (
    <>
      <TopBar
        subtitle="Topology"
        title={t("Visualizer")}
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {lab.name} | {model.counts.cables} cables | {model.counts.devices}{" "}
            devices
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <select
              value={layoutMode}
              onChange={(event) => {
                const next = event.target.value as VisualizerLayoutMode;
                setLayoutMode(next);
                writeString(LAYOUT_MODE_STORAGE_KEY, next);
              }}
              className="rk-control h-8 w-36 px-2 text-xs text-[var(--text-primary)]"
              aria-label="Visualizer layout"
            >
              <option value="grouped">Grouped</option>
              <option value="pyramid">Pyramid</option>
              <option value="diagram">Diagram</option>
            </select>
            <select
              value={cableType}
              onChange={(event) => setCableType(event.target.value)}
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
            <Button
              variant={healthOverlay ? "secondary" : "outline"}
              size="sm"
              onClick={toggleHealthOverlay}
            >
              Health
            </Button>
            {layoutMode !== "diagram" && (
              <Button
                variant={traceMode.enabled ? "secondary" : "outline"}
                size="sm"
                onClick={() =>
                  setTraceMode((current) =>
                    current.enabled
                      ? {
                          enabled: false,
                          firstPortId: null,
                          result: null,
                          message: null,
                        }
                      : {
                          enabled: true,
                          firstPortId: null,
                          result: null,
                          message: "Click first port...",
                        },
                  )
                }
              >
                Trace mode
              </Button>
            )}
            {layoutMode === "grouped" && (
              <Button
                variant={orderPanelOpen ? "secondary" : "outline"}
                size="sm"
                onClick={() => setOrderPanelOpen((current) => !current)}
              >
                <SlidersHorizontal />
                Order
              </Button>
            )}
          </div>
        }
      />
      {orderPanelOpen && layoutMode === "grouped" && (
        <VisualizerOrderPanel
          sections={orderSections}
          racks={orderRacks}
          groups={orderGroups}
          selectedGroup={selectedOrderGroup}
          selectedGroupId={selectedOrderGroup?.id ?? ""}
          onSelectedGroupChange={setSelectedOrderGroupId}
          onMoveSection={moveSection}
          onMoveRack={moveRack}
          onMoveGroup={moveGroup}
          onMoveDevice={moveDeviceInGroup}
          onReset={resetVisualizerOrder}
          onClose={() => setOrderPanelOpen(false)}
        />
      )}
      {layoutMode === "diagram" ? (
        <DiagramCanvas
          model={model}
          loading={loading && !loaded}
          healthOverlay={healthOverlay}
          cableType={cableType}
          wifiSsids={wifiSsids}
          wifiAccessPoints={wifiAccessPoints}
          wifiClientAssociations={wifiClientAssociations}
          virtualSwitches={virtualSwitches}
        />
      ) : (
        <VisualizerCanvas
          model={model}
          loading={loading && !loaded}
          healthOverlay={healthOverlay}
          onToggleHealth={toggleHealthOverlay}
          traceMode={traceMode}
          setTraceMode={setTraceMode}
          cableType={cableType}
          cableLayout={cableLayout}
          onCableLayoutChange={(next) => {
            setCableLayout(next);
            writeString(CABLE_LAYOUT_STORAGE_KEY, next);
          }}
          rackFaceMode={rackFaceMode}
          onRackFaceModeChange={(next) => {
            setRackFaceMode(next);
            writeString(RACK_FACE_MODE_STORAGE_KEY, next);
          }}
          rackScale={rackScale}
          onRackScaleChange={(next) => {
            setRackScale(next);
            writeString(RACK_SCALE_STORAGE_KEY, next);
          }}
          shelfLayout={shelfLayout}
          onShelfLayoutChange={(next) => {
            setShelfLayout(next);
            writeString(SHELF_LAYOUT_STORAGE_KEY, next);
          }}
          looseDevicePlacement={looseDevicePlacement}
          onToggleLooseDevicePlacement={toggleLooseDevicePlacement}
          includeRoomOnlySections={includeRoomOnlySections}
          onToggleRoomOnlySections={toggleRoomOnlySections}
          readableLabels={readableLabels}
          onToggleReadableLabels={toggleReadableLabels}
          onResetCustomNodePositions={resetCustomNodePositions}
          hasCustomNodePositions={Object.keys(customNodePositions).length > 0}
          noCableBannerDismissed={noCableBannerDismissed}
          onDismissNoCableBanner={() => {
            setNoCableBannerDismissed(true);
            writeBoolean(NO_CABLE_BANNER_KEY, true);
          }}
          onToggleRackRun={toggleRackRun}
          onToggleGroup={toggleGroup}
          onNodePositionChange={updateCustomNodePosition}
        />
      )}
    </>
  );
}

function VisualizerOrderPanel({
  sections,
  racks,
  groups,
  selectedGroup,
  selectedGroupId,
  onSelectedGroupChange,
  onMoveSection,
  onMoveRack,
  onMoveGroup,
  onMoveDevice,
  onReset,
  onClose,
}: {
  sections: VisualizerOrderListItem[];
  racks: VisualizerOrderListItem[];
  groups: VisualizerOrderGroupItem[];
  selectedGroup: VisualizerOrderGroupItem | null;
  selectedGroupId: string;
  onSelectedGroupChange: (id: string) => void;
  onMoveSection: (id: string, direction: MoveDirection) => void;
  onMoveRack: (id: string, direction: MoveDirection) => void;
  onMoveGroup: (id: string, direction: MoveDirection) => void;
  onMoveDevice: (
    groupId: string,
    deviceId: string,
    direction: MoveDirection,
  ) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const selectedDevices =
    selectedGroup?.nodes.map((node) => ({
      id: node.device.id,
      label: node.device.displayName || node.device.hostname,
      detail:
        node.device.managementIp ??
        node.device.hostname ??
        node.effectiveDeviceType,
    })) ?? [];

  return (
    <aside className="fixed right-5 top-[88px] z-40 flex max-h-[calc(100vh-112px)] w-[min(440px,calc(100vw-32px))] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-1)] shadow-2xl">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-muted)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            Visualizer order
          </h2>
          <p className="text-xs text-[var(--text-tertiary)]">
            Stored on this browser
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Reset order"
            aria-label="Reset visualizer order"
            onClick={onReset}
          >
            <RotateCcw />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Close"
            aria-label="Close visualizer order panel"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </div>
      <div className="space-y-5 overflow-y-auto px-4 py-4">
        <OrderList
          title="Rooms and rack sections"
          emptyLabel="No rack sections to order."
          items={sections}
          onMove={onMoveSection}
        />
        <OrderList
          title="Racks"
          emptyLabel="No racks to order."
          items={racks}
          onMove={onMoveRack}
        />
        <OrderList
          title="Loose groups"
          emptyLabel="No loose device groups to order."
          items={groups}
          onMove={onMoveGroup}
        />
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Devices in group
            </h3>
            <select
              value={selectedGroupId}
              onChange={(event) => onSelectedGroupChange(event.target.value)}
              className="rk-control h-8 max-w-[240px] px-2 text-xs text-[var(--text-primary)]"
              aria-label="Choose visualizer group to order devices"
            >
              {groups.length === 0 ? (
                <option value="">No groups</option>
              ) : (
                groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.label}
                  </option>
                ))
              )}
            </select>
          </div>
          {selectedGroup && selectedGroup.total > 0 && selectedDevices.length === 0 ? (
            <p className="rounded-[var(--radius-sm)] border border-[var(--border-muted)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
              Expand this group in the visualizer to order its devices.
            </p>
          ) : (
            <OrderList
              title=""
              emptyLabel="No devices in this group."
              items={selectedDevices}
              onMove={(id, direction) => {
                if (!selectedGroup) return;
                onMoveDevice(selectedGroup.id, id, direction);
              }}
              showTitle={false}
            />
          )}
        </section>
      </div>
    </aside>
  );
}

function OrderList({
  title,
  emptyLabel,
  items,
  showTitle = true,
  onMove,
}: {
  title: string;
  emptyLabel: string;
  items: VisualizerOrderListItem[];
  showTitle?: boolean;
  onMove: (id: string, direction: MoveDirection) => void;
}) {
  return (
    <section className="space-y-2">
      {showTitle && (
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          {title}
        </h3>
      )}
      {items.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] border border-[var(--border-muted)] bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--text-tertiary)]">
          {emptyLabel}
        </p>
      ) : (
        <div className="space-y-1">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-muted)] bg-[var(--surface-2)] px-2 py-2"
            >
              <div className="min-w-0 flex-1 text-left">
                <div className="break-words text-xs font-medium text-[var(--text-primary)]">
                  {item.label}
                </div>
                {item.detail && (
                  <div className="mt-0.5 break-words text-[11px] text-[var(--text-tertiary)]">
                    {item.detail}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Move up"
                  aria-label={`Move ${item.label} up`}
                  disabled={index === 0}
                  onClick={() => onMove(item.id, "up")}
                  className="h-7 w-7"
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Move down"
                  aria-label={`Move ${item.label} down`}
                  disabled={index === items.length - 1}
                  onClick={() => onMove(item.id, "down")}
                  className="h-7 w-7"
                >
                  <ArrowDown />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function readBoolean(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key);
    if (value == null) return fallback;
    return value === "true";
  } catch {
    return fallback;
  }
}

function writeBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures; the in-memory state still works.
  }
}

function readLooseDevicePlacement(key: string): VisualizerLooseDevicePlacement {
  try {
    const value = window.localStorage.getItem(key);
    return value === "below-racks" ? "below-racks" : "beside-racks";
  } catch {
    return "beside-racks";
  }
}

function readLayoutMode(key: string): VisualizerLayoutMode {
  try {
    const value = window.localStorage.getItem(key);
    return value === "pyramid" || value === "diagram" ? value : "grouped";
  } catch {
    return "grouped";
  }
}

function readRackFaceMode(key: string): VisualizerRackFaceMode {
  try {
    const value = window.localStorage.getItem(key);
    return value === "rear" || value === "both" ? value : "front";
  } catch {
    return "front";
  }
}

function readRackScale(key: string): VisualizerRackScale {
  try {
    const value = window.localStorage.getItem(key);
    return value === "compact" || value === "wide" || value === "xwide"
      ? value
      : "normal";
  } catch {
    return "normal";
  }
}

function readShelfLayout(key: string): VisualizerShelfLayout {
  try {
    const value = window.localStorage.getItem(key);
    return value === "stacked" || value === "expanded" ? value : "auto";
  } catch {
    return "auto";
  }
}

function readCableLayout(key: string): VisualizerCableLayout {
  try {
    const value = window.localStorage.getItem(key);
    return value === "bundled" ||
      value === "concave" ||
      value === "convex" ||
      value === "straight"
      ? value
      : "auto";
  } catch {
    return "auto";
  }
}

function readPointMap(key: string): Record<string, VisualizerPoint> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        if (!value || typeof value !== "object") return false;
        const point = value as Partial<VisualizerPoint>;
        return Number.isFinite(point.x) && Number.isFinite(point.y);
      }),
    ) as Record<string, VisualizerPoint>;
  } catch {
    return {};
  }
}

function writePointMap(key: string, value: Record<string, VisualizerPoint>) {
  try {
    if (Object.keys(value).length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage issues in locked-down browsers.
  }
}

function readOrderSettings(key: string): VisualizerOrderSettings {
  try {
    return sanitizeOrderSettings(
      JSON.parse(window.localStorage.getItem(key) ?? "{}"),
    );
  } catch {
    return EMPTY_ORDER_SETTINGS;
  }
}

function writeOrderSettings(key: string, value: VisualizerOrderSettings) {
  try {
    const sanitized = sanitizeOrderSettings(value);
    const empty =
      sanitized.sections.length === 0 &&
      sanitized.racks.length === 0 &&
      sanitized.groups.length === 0 &&
      Object.keys(sanitized.devicesByGroup).length === 0;
    if (empty) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(sanitized));
  } catch {
    // Ignore storage issues in locked-down browsers.
  }
}

function sanitizeOrderSettings(value: unknown): VisualizerOrderSettings {
  if (!value || typeof value !== "object") return EMPTY_ORDER_SETTINGS;
  const candidate = value as Partial<VisualizerOrderSettings>;
  const devicesByGroup =
    candidate.devicesByGroup && typeof candidate.devicesByGroup === "object"
      ? Object.fromEntries(
          Object.entries(candidate.devicesByGroup)
            .filter(
              ([key, devices]) =>
                typeof key === "string" && isStringArray(devices),
            )
            .map(([key, devices]) => [key, uniqueStrings(devices)]),
        )
      : {};

  return {
    sections: uniqueStrings(
      isStringArray(candidate.sections) ? candidate.sections : [],
    ),
    racks: uniqueStrings(isStringArray(candidate.racks) ? candidate.racks : []),
    groups: uniqueStrings(
      isStringArray(candidate.groups) ? candidate.groups : [],
    ),
    devicesByGroup,
  };
}

function moveOrderedId(
  currentOrder: string[],
  visibleIds: string[],
  id: string,
  direction: MoveDirection,
) {
  const normalized = normalizeVisibleOrder(currentOrder, visibleIds);
  const index = normalized.indexOf(id);
  if (index === -1) return normalized;
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= normalized.length) return normalized;
  const next = [...normalized];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

function normalizeVisibleOrder(currentOrder: string[], visibleIds: string[]) {
  const visible = new Set(visibleIds);
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of currentOrder) {
    if (!visible.has(id) || seen.has(id)) continue;
    next.push(id);
    seen.add(id);
  }
  for (const id of visibleIds) {
    if (seen.has(id)) continue;
    next.push(id);
    seen.add(id);
  }
  return next;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function writeString(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures; the in-memory state still works.
  }
}

function readSessionSet(key: string) {
  try {
    const value = window.sessionStorage.getItem(key);
    if (!value) return new Set<string>();
    return new Set(JSON.parse(value) as string[]);
  } catch {
    return new Set<string>();
  }
}

function writeSessionSet(key: string, value: Set<string>) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(Array.from(value)));
  } catch {
    // Ignore storage failures; the in-memory state still works.
  }
}
