import { useMemo, useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { useStore } from "@/lib/store";
import { buildVisualizerModel } from "./visualizer/model";
import { VisualizerCanvas } from "./visualizer/VisualizerCanvas";
import type { TraceModeState } from "./visualizer/types";

const HEALTH_STORAGE_KEY = "rackpad.visualizer.health";
const NO_CABLE_BANNER_KEY = "rackpad.visualizer.no-cable-banner.dismissed";

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
  const [cableType, setCableType] = useState("all");
  const [expandedRackRuns, setExpandedRackRuns] = useState<Set<string>>(
    () => readSessionSet("rackpad.visualizer.expanded-rack-runs"),
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => readSessionSet("rackpad.visualizer.collapsed-groups"),
  );
  const [healthOverlay, setHealthOverlay] = useState(
    () => readBoolean(HEALTH_STORAGE_KEY, false),
  );
  const [noCableBannerDismissed, setNoCableBannerDismissed] = useState(
    () => readBoolean(NO_CABLE_BANNER_KEY, false),
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

  return (
    <>
      <TopBar
        subtitle="Topology"
        title="Visualizer"
        meta={
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            {lab.name} | {model.counts.cables} cables | {model.counts.devices} devices
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
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
          </div>
        }
      />
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
      />
    </>
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
