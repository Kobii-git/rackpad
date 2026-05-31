import { useMemo, useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { useStore } from "@/lib/store";
import { buildVisualizerModel } from "./visualizer/model";
import { DiagramCanvas } from "./visualizer/DiagramCanvas";
import { VisualizerCanvas } from "./visualizer/VisualizerCanvas";
import type {
  TraceModeState,
  VisualizerLayoutMode,
  VisualizerLooseDevicePlacement,
  VisualizerPoint,
  VisualizerRackFaceMode,
} from "./visualizer/types";

const HEALTH_STORAGE_KEY = "rackpad.visualizer.health";
const NO_CABLE_BANNER_KEY = "rackpad.visualizer.no-cable-banner.dismissed";
const LOOSE_PLACEMENT_STORAGE_KEY = "rackpad.visualizer.loose-placement";
const ROOM_ONLY_SECTIONS_STORAGE_KEY = "rackpad.visualizer.room-only-sections";
const LAYOUT_MODE_STORAGE_KEY = "rackpad.visualizer.layout-mode";
const RACK_FACE_MODE_STORAGE_KEY = "rackpad.visualizer.rack-face-mode";
const CUSTOM_NODE_POSITIONS_STORAGE_KEY =
  "rackpad.visualizer.custom-node-positions";

export default function VisualizerView() {
  const lab = useStore((s) => s.lab);
  const loading = useStore((s) => s.loading);
  const loaded = useStore((s) => s.loaded);
  const rooms = useStore((s) => s.rooms);
  const racks = useStore((s) => s.racks);
  const devices = useStore((s) => s.devices);
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
  const [customNodePositions, setCustomNodePositions] = useState<
    Record<string, VisualizerPoint>
  >(() => readPointMap(CUSTOM_NODE_POSITIONS_STORAGE_KEY));
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
          customNodePositions,
        },
      }),
    [
      racks,
      rooms,
      devices,
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
      customNodePositions,
      looseDevicePlacement,
      includeRoomOnlySections,
    ],
  );

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

  return (
    <>
      <TopBar
        subtitle="Topology"
        title="Visualizer"
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
            {layoutMode === "grouped" && (
              <>
                <select
                  value={rackFaceMode}
                  onChange={(event) => {
                    const next = event.target.value as VisualizerRackFaceMode;
                    setRackFaceMode(next);
                    writeString(RACK_FACE_MODE_STORAGE_KEY, next);
                  }}
                  className="rk-control h-8 w-28 px-2 text-xs text-[var(--text-primary)]"
                  aria-label="Rack face"
                >
                  <option value="front">Front</option>
                  <option value="rear">Rear</option>
                  <option value="both">Both</option>
                </select>
                <VisualizerToggle
                  checked={looseDevicePlacement === "below-racks"}
                  label="Loose below"
                  ariaLabel="Place loose devices below racks"
                  onChange={toggleLooseDevicePlacement}
                />
                <VisualizerToggle
                  checked={includeRoomOnlySections}
                  label="No rack required"
                  ariaLabel="Place rooms without racks in rack zone"
                  onChange={toggleRoomOnlySections}
                />
              </>
            )}
            {layoutMode === "pyramid" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetCustomNodePositions}
                disabled={Object.keys(customNodePositions).length === 0}
              >
                Reset nodes
              </Button>
            )}
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
          </div>
        }
      />
      {layoutMode === "diagram" ? (
        <DiagramCanvas
          model={model}
          loading={loading && !loaded}
          healthOverlay={healthOverlay}
          cableType={cableType}
          wifiSsids={wifiSsids}
          wifiAccessPoints={wifiAccessPoints}
          wifiClientAssociations={wifiClientAssociations}
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

function VisualizerToggle({
  checked,
  label,
  ariaLabel,
  onChange,
}: {
  checked: boolean;
  label: string;
  ariaLabel: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 text-xs font-medium transition-colors ${
        checked
          ? "border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)]"
          : "border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_32%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onChange()}
        className="size-3 accent-[var(--accent-primary)]"
        aria-label={ariaLabel}
      />
      <span className="whitespace-nowrap">{label}</span>
    </label>
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
