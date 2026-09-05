import {
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  Box,
  Cable,
  ChevronDown,
  ChevronUp,
  Focus,
  Minus,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import {
  RackElevationEquipmentFrame,
  RackElevationShell,
} from "@/components/rack/RackElevationPresentation";
import { PhysicalFaceplate } from "@/components/rack/PhysicalFaceplate";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useI18n } from "@/i18n";
import { portSupportsPhysicalPatching } from "@/lib/rack-studio-cables";
import type {
  Device,
  DevicePhysicalLayout,
  Port,
  PortLink,
  Rack,
  Room,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  buildSearchResults,
  traceFromPort,
  tracePorts,
  visualizerSearchResultMeta,
} from "./model";
import {
  buildRackCablingRoutes,
  buildRackCablingScene,
  buildRackCablingScope,
  layoutRackCablingHandoffLabels,
  rackCablingSelectionIsInScope,
  RACK_CABLING_UNIT_HEIGHT,
  type RackCablingEquipment,
  type RackCablingHandoff,
  type RackCablingRouteStyle,
} from "./rack-cabling";
import type {
  TraceModeState,
  SearchResult,
  VisualizerCable,
  VisualizerModel,
  VisualizerRackFaceMode,
} from "./types";
import {
  VisualizerInspector,
  type VisualizerInspectionSelection,
} from "./VisualizerCanvas";

interface RackCablingCanvasProps {
  rooms: Room[];
  roomId: string;
  onRoomIdChange: (roomId: string) => void;
  racks: Rack[];
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  portLinks: PortLink[];
  model: VisualizerModel;
  rackOrder: string[];
  faceMode: VisualizerRackFaceMode;
  cableType: string;
  healthOverlay: boolean;
  onToggleHealth: () => void;
  routeStyle: RackCablingRouteStyle;
  onRouteStyleChange: (style: RackCablingRouteStyle) => void;
  showLabels: boolean;
  onShowLabelsChange: (show: boolean) => void;
  looseExpanded: boolean;
  onLooseExpandedChange: (expanded: boolean) => void;
  traceMode: TraceModeState;
  setTraceMode: Dispatch<SetStateAction<TraceModeState>>;
}

interface PanState {
  pointerId: number;
  clientX: number;
  clientY: number;
  panX: number;
  panY: number;
}

type RackCablingSelection = VisualizerInspectionSelection;

type RackCablingSearchResult =
  | SearchResult
  | {
      kind: "rack" | "port";
      id: string;
      label: string;
      meta: string;
      score: number;
    };

export function RackCablingCanvas({
  rooms,
  roomId,
  onRoomIdChange,
  racks,
  devices,
  layouts,
  ports,
  portLinks,
  model,
  rackOrder,
  faceMode,
  cableType,
  healthOverlay,
  onToggleHealth,
  routeStyle,
  onRouteStyleChange,
  showLabels,
  onShowLabelsChange,
  looseExpanded,
  onLooseExpandedChange,
  traceMode,
  setTraceMode,
}: RackCablingCanvasProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const panRef = useRef<PanState | null>(null);
  const autoFitRef = useRef(true);
  const previousRoomIdRef = useRef(roomId);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<RackCablingSelection>(null);
  const [hoveredCableId, setHoveredCableId] = useState<string | null>(null);
  const [searchIndex, setSearchIndex] = useState(0);
  const room = rooms.find((candidate) => candidate.id === roomId);
  const scene = useMemo(
    () =>
      room
        ? buildRackCablingScene({
            room,
            racks,
            devices,
            layouts,
            ports,
            faceMode,
            rackOrder,
            looseExpanded,
          })
        : null,
    [room, racks, devices, layouts, ports, faceMode, rackOrder, looseExpanded],
  );
  const routes = useMemo(
    () =>
      scene
        ? buildRackCablingRoutes({
            scene,
            rooms,
            racks,
            devices,
            ports,
            links: portLinks,
            cableType,
            style: routeStyle,
          })
        : [],
    [scene, rooms, racks, devices, ports, portLinks, cableType, routeStyle],
  );
  const handoffLabelGeometry = useMemo(
    () => (scene ? layoutRackCablingHandoffLabels(scene, routes) : []),
    [routes, scene],
  );
  const handoffLabelGeometryById = useMemo(
    () => new Map(handoffLabelGeometry.map((entry) => [entry.id, entry])),
    [handoffLabelGeometry],
  );
  const scope = useMemo(
    () =>
      scene
        ? buildRackCablingScope(scene, routes)
        : {
            rackIds: new Set<string>(),
            deviceIds: new Set<string>(),
            portIds: new Set<string>(),
            cableIds: new Set<string>(),
          },
    [routes, scene],
  );
  const primaryEquipmentItemByDeviceId = useMemo(() => {
    const result = new Map<string, string>();
    for (const item of scene?.equipment ?? []) {
      if (!result.has(item.device.id)) result.set(item.device.id, item.id);
    }
    return result;
  }, [scene]);
  const routeIds = scope.cableIds;
  const sceneDeviceIds = scope.deviceIds;
  const scenePortIds = scope.portIds;
  const visibleCables = useMemo(
    () =>
      routes.map((route): VisualizerCable => {
        const existing = model.cableById[route.link.id];
        if (existing) return existing;
        const fromPort = model.portById[route.link.fromPortId];
        const toPort = model.portById[route.link.toPortId];
        const fromDevice = fromPort
          ? model.deviceById[fromPort.deviceId]
          : undefined;
        const toDevice = toPort ? model.deviceById[toPort.deviceId] : undefined;
        const fromNode = fromDevice
          ? model.nodesByDeviceId[fromDevice.id]
          : undefined;
        const toNode = toDevice
          ? model.nodesByDeviceId[toDevice.id]
          : undefined;
        const up = fromPort?.linkState === "up" && toPort?.linkState === "up";
        return {
          link: route.link,
          fromPort,
          toPort,
          fromDevice,
          toDevice,
          fromNode,
          toNode,
          fromPoint: route.from,
          toPoint: route.to,
          path: route.path,
          color: route.color,
          up,
          bothOnline:
            fromNode?.health === "online" && toNode?.health === "online",
          unknown:
            !up ||
            fromPort?.linkState === "unknown" ||
            toPort?.linkState === "unknown",
          crossZone:
            Boolean(fromDevice?.roomId && toDevice?.roomId) &&
            fromDevice?.roomId !== toDevice?.roomId,
          snmpVerified: false,
          logicalAggregate:
            fromPort?.portRole === "aggregate" ||
            toPort?.portRole === "aggregate",
        };
      }),
    [model, routes],
  );
  const racksById = useMemo(
    () => Object.fromEntries(racks.map((rack) => [rack.id, rack])),
    [racks],
  );
  const roomsById = useMemo(
    () => Object.fromEntries(rooms.map((entry) => [entry.id, entry])),
    [rooms],
  );
  const linkedPortIds = useMemo(
    () =>
      new Set(
        routes.flatMap((route) => [route.link.fromPortId, route.link.toPortId]),
      ),
    [routes],
  );
  const selectedCable =
    selection?.kind === "cable"
      ? (visibleCables.find((cable) => cable.link.id === selection.id) ?? null)
      : null;
  const selectedNode =
    selection?.kind === "device"
      ? (model.nodesByDeviceId[selection.id] ?? null)
      : null;
  const selectedRackId = selection?.kind === "rack" ? selection.id : null;
  const selectedPortId = selection?.kind === "port" ? selection.id : null;
  const highlightedDeviceIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedNode) ids.add(selectedNode.device.id);
    if (selectedPortId) {
      const deviceId = model.portById[selectedPortId]?.deviceId;
      if (deviceId) ids.add(deviceId);
    }
    if (selectedCable?.fromDevice) ids.add(selectedCable.fromDevice.id);
    if (selectedCable?.toDevice) ids.add(selectedCable.toDevice.id);
    for (const portId of traceMode.result?.portIds ?? []) {
      const deviceId = model.portById[portId]?.deviceId;
      if (deviceId) ids.add(deviceId);
    }
    for (const route of routes) {
      const touchesSelectedPort =
        selectedPortId === route.link.fromPortId ||
        selectedPortId === route.link.toPortId;
      const touchesSelectedRack =
        selectedRackId != null &&
        [route.from.rackId, route.to.rackId].includes(selectedRackId);
      if (!touchesSelectedPort && !touchesSelectedRack) continue;
      for (const portId of [route.link.fromPortId, route.link.toPortId]) {
        const deviceId = model.portById[portId]?.deviceId;
        if (deviceId) ids.add(deviceId);
      }
    }
    return ids;
  }, [
    model.portById,
    routes,
    selectedCable,
    selectedNode,
    selectedPortId,
    selectedRackId,
    traceMode.result,
  ]);
  const normalizedSearch = search.trim().toLowerCase();
  const searchResults = useMemo<RackCablingSearchResult[]>(() => {
    if (!normalizedSearch || !scene) return [];
    const base = buildSearchResults(
      {
        ...model,
        nodes: model.nodes.filter((node) => sceneDeviceIds.has(node.device.id)),
        cables: visibleCables,
      },
      search,
    );
    const rackResults: RackCablingSearchResult[] = scene.racks
      .filter((entry) =>
        entry.rack.name.toLowerCase().includes(normalizedSearch),
      )
      .map((entry) => ({
        kind: "rack",
        id: entry.rack.id,
        label: entry.rack.name,
        meta: room?.name ?? "",
        score: 120,
      }));
    const portResults: RackCablingSearchResult[] = ports
      .filter((port) => {
        if (!scenePortIds.has(port.id)) return false;
        const device = model.deviceById[port.deviceId];
        return `${port.name} ${port.kind} ${device?.hostname ?? ""}`
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .map((port) => ({
        kind: "port",
        id: port.id,
        label: `${model.deviceById[port.deviceId]?.hostname ?? port.deviceId} · ${port.name}`,
        meta: port.kind,
        score: 110,
      }));
    return [...rackResults, ...portResults, ...base]
      .sort(
        (left, right) =>
          right.score - left.score || left.label.localeCompare(right.label),
      )
      .slice(0, 24);
  }, [
    model,
    normalizedSearch,
    ports,
    room?.name,
    scene,
    sceneDeviceIds,
    scenePortIds,
    search,
    visibleCables,
  ]);
  const matchingDeviceIds = useMemo(() => {
    if (!normalizedSearch) return null;
    const ids = new Set<string>();
    for (const result of searchResults) {
      if (result.kind === "device") ids.add(result.id);
      if (result.kind === "port") {
        const deviceId = model.portById[result.id]?.deviceId;
        if (deviceId) ids.add(deviceId);
      }
    }
    return ids;
  }, [model.portById, normalizedSearch, searchResults]);
  const matchingCableIds = useMemo(() => {
    if (!normalizedSearch) return null;
    return new Set(
      searchResults
        .filter((result) => result.kind === "cable")
        .map((result) => result.id),
    );
  }, [normalizedSearch, searchResults]);

  const applyFit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !scene) return;
    const bounds = viewport.getBoundingClientRect();
    const nextZoom = Math.max(
      0.28,
      Math.min(
        1.35,
        (bounds.width - 56) / Math.max(1, scene.width),
        (bounds.height - 56) / Math.max(1, scene.height),
      ),
    );
    setZoom(nextZoom);
    setPan({
      x: (bounds.width - scene.width * nextZoom) / 2,
      y: (bounds.height - scene.height * nextZoom) / 2,
    });
  }, [scene]);

  const fitCanvas = useCallback(() => {
    autoFitRef.current = true;
    applyFit();
  }, [applyFit]);

  const resetView = useCallback(() => {
    autoFitRef.current = false;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const toggleTraceMode = useCallback(() => {
    setTraceMode((current) =>
      current.enabled
        ? { enabled: false, firstPortId: null, result: null, message: null }
        : {
            enabled: true,
            firstPortId: null,
            result: null,
            message: t("Click first port..."),
          },
    );
  }, [setTraceMode, t]);

  useEffect(() => {
    autoFitRef.current = true;
    const frame = window.requestAnimationFrame(applyFit);
    return () => window.cancelAnimationFrame(frame);
  }, [applyFit, roomId, faceMode, looseExpanded]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (autoFitRef.current) applyFit();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [applyFit]);

  useEffect(() => {
    setSearchIndex(0);
  }, [search]);

  useEffect(() => {
    if (previousRoomIdRef.current === roomId) return;
    previousRoomIdRef.current = roomId;
    setSelection(null);
    setHoveredCableId(null);
    setTraceMode((current) =>
      current.enabled
        ? {
            enabled: true,
            firstPortId: null,
            result: null,
            message: t("Click first port..."),
          }
        : current,
    );
  }, [roomId, setTraceMode, t]);

  useEffect(() => {
    if (!rackCablingSelectionIsInScope(selection, scope)) setSelection(null);
  }, [scope, selection]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (event.key === "Escape") {
        event.preventDefault();
        setSelection(null);
        setHoveredCableId(null);
        setSearch("");
        setTraceMode({
          enabled: false,
          firstPortId: null,
          result: null,
          message: null,
        });
        return;
      }
      if (editing) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        fitCanvas();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetView();
      } else if (event.key === "1") {
        event.preventDefault();
        onToggleHealth();
      } else if (event.key === "2") {
        event.preventDefault();
        toggleTraceMode();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fitCanvas, onToggleHealth, resetView, setTraceMode, toggleTraceMode]);

  function beginPan(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-rack-cabling-interactive='true']")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    autoFitRef.current = false;
    setSelection(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const active = panRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    setPan({
      x: active.panX + event.clientX - active.clientX,
      y: active.panY + event.clientY - active.clientY,
    });
  }

  function endPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-rack-cabling-interactive='true']")) return;
    event.preventDefault();
    autoFitRef.current = false;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const nextZoom = Math.max(
      0.22,
      Math.min(1.8, zoom * (event.deltaY > 0 ? 0.9 : 1.1)),
    );
    const worldX = (pointerX - pan.x) / zoom;
    const worldY = (pointerY - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({
      x: pointerX - worldX * nextZoom,
      y: pointerY - worldY * nextZoom,
    });
  }

  function selectDevice(deviceId: string) {
    setSelection({ kind: "device", id: deviceId });
  }

  function selectCable(cableId: string) {
    if (!routeIds.has(cableId)) return;
    setSelection({ kind: "cable", id: cableId });
  }

  function selectRack(rackId: string) {
    setSelection({ kind: "rack", id: rackId });
  }

  function closeInspector() {
    const previous = selection;
    setSelection(null);
    window.requestAnimationFrame(() => {
      if (previous) {
        const selector = `[data-cabling-selection-id="${CSS.escape(`${previous.kind}:${previous.id}`)}"]`;
        const target = document.querySelector<HTMLElement>(
          `${selector}:is(button,[role="button"],[tabindex])`,
        );
        if (target) {
          target.focus();
          return;
        }
      }
      viewportRef.current?.focus();
    });
  }

  function focusPoint(x: number, y: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const nextZoom = Math.max(0.7, zoom);
    autoFitRef.current = false;
    setZoom(nextZoom);
    setPan({
      x: bounds.width / 2 - x * nextZoom,
      y: bounds.height / 2 - y * nextZoom,
    });
  }

  function focusSelection(result: RackCablingSearchResult) {
    if (!scene) return;
    if (result.kind === "rack") {
      const rack = scene.racks.find((entry) => entry.rack.id === result.id);
      if (rack) focusPoint(rack.x + rack.width / 2, rack.y + rack.height / 2);
      return;
    }
    if (result.kind === "device") {
      const equipment = scene.equipment.find(
        (entry) => entry.device.id === result.id,
      );
      const looseCard = scene.looseCards.find(
        (entry) => entry.device.id === result.id,
      );
      if (equipment) {
        focusPoint(
          equipment.rect.x + equipment.rect.width / 2,
          equipment.rect.y + equipment.rect.height / 2,
        );
      } else if (looseCard) {
        focusPoint(
          looseCard.x + looseCard.width / 2,
          looseCard.y + looseCard.height / 2,
        );
      }
      return;
    }
    if (result.kind === "port") {
      const anchor = scene.anchors.find((entry) => entry.portId === result.id);
      if (anchor) {
        focusPoint(anchor.x, anchor.y);
        return;
      }
      const fallback = scene.equipment.find(
        (entry) =>
          entry.fallbackReason &&
          entry.layout?.bindings.some(
            (binding) => binding.portId === result.id,
          ),
      );
      if (fallback) {
        focusPoint(
          fallback.rect.x + fallback.rect.width / 2,
          fallback.rect.y + fallback.rect.height / 2,
        );
      }
      return;
    }
    const route = routes.find((entry) => entry.link.id === result.id);
    if (route) {
      focusPoint(route.labelPoint.x, route.labelPoint.y);
    }
  }

  function activateSearchResult(result: RackCablingSearchResult) {
    setSelection({ kind: result.kind, id: result.id });
    focusSelection(result);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchIndex((current) =>
        searchResults.length === 0 ? 0 : (current + 1) % searchResults.length,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchIndex((current) =>
        searchResults.length === 0
          ? 0
          : (current - 1 + searchResults.length) % searchResults.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = searchResults[searchIndex] ?? searchResults[0];
      if (result) activateSearchResult(result);
    }
  }

  function handoffLabel(handoff: RackCablingHandoff) {
    const endpoint = `${handoff.deviceLabel} · ${handoff.portLabel}`;
    if (handoff.reason === "cross-room") {
      return t("{value1}: {name}", {
        value1: t("Room"),
        name: `${handoff.roomLabel ?? t("Unknown")} · ${endpoint}`,
      });
    }
    if (handoff.reason === "hidden-face") {
      return t("{value1}: {name}", {
        value1: handoff.physicalFace === "rear" ? t("Rear") : t("Front"),
        name: endpoint,
      });
    }
    if (handoff.reason === "loose-tray") {
      return t("{value1}: {name}", {
        value1: t("Loose gear"),
        name: endpoint,
      });
    }
    return t("{value1}: {name}", {
      value1:
        handoff.fallbackReason === "missing-layout"
          ? `${t("Physical layout")} · ${t("Needs attention")}`
          : t("Physical position unavailable"),
      name: endpoint,
    });
  }

  function selectTracePort(deviceId: string, portId: string) {
    if (!traceMode.enabled) return;
    if (!traceMode.firstPortId) {
      const result = traceFromPort(model, portId);
      setTraceMode({
        enabled: true,
        firstPortId: portId,
        result,
        message: result
          ? t("{count} hop path traced from selected port.", {
              count: result.segments.length,
            })
          : t("No onward path found. Select a second port to trace manually."),
      });
    } else {
      const result = tracePorts(model, traceMode.firstPortId, portId);
      setTraceMode({
        enabled: true,
        firstPortId: traceMode.firstPortId,
        result,
        message: result
          ? t("{count} hop path highlighted.", {
              count: result.segments.length,
            })
          : t("No documented path between these ports."),
      });
    }
    selectDevice(deviceId);
  }

  function selectPort(deviceId: string, portId: string) {
    if (traceMode.enabled) {
      selectTracePort(deviceId, portId);
      return;
    }
    setSelection({ kind: "port", id: portId });
  }

  if (!room || !scene) {
    return (
      <div className="grid h-[calc(100vh-8.5rem)] min-h-[620px] place-items-center border-t border-[var(--border-subtle)] bg-grid">
        <div className="rk-panel max-w-sm rounded-[var(--radius-md)] p-6 text-center">
          <Cable className="mx-auto size-8 text-[var(--accent-primary)]" />
          <h2 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
            {t("No racks assigned")}
          </h2>
          <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
            {t("Assign a rack to this room from the rack editor.")}
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/racks">{t("Go to Racks")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative grid h-[calc(100vh-8.5rem)] min-h-[620px] border-t border-[var(--border-subtle)] bg-[var(--surface-1)] xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="relative min-h-0 min-w-0 overflow-hidden border-r border-[var(--border-default)]">
        <div
          ref={viewportRef}
          tabIndex={-1}
          data-testid="rack-cabling-canvas"
          className="absolute inset-0 touch-none cursor-grab overflow-hidden bg-[radial-gradient(circle_at_1px_1px,var(--border-muted)_1px,transparent_0)] [background-size:22px_22px] active:cursor-grabbing"
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onWheel={handleWheel}
        >
          {scene.racks.length === 0 && !scene.looseTray && (
            <div className="rk-panel absolute left-1/2 top-1/2 z-[60] w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-md)] p-6 text-center">
              <Cable className="mx-auto size-8 text-[var(--accent-primary)]" />
              <h2 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                {t("No racks assigned")}
              </h2>
              <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                {t("Assign a rack to this room from the rack editor.")}
              </p>
              <Button asChild size="sm" className="mt-4">
                <Link to="/racks">{t("Go to Racks")}</Link>
              </Button>
            </div>
          )}
          <div
            data-testid="rack-cabling-scene"
            className="absolute left-0 top-0"
            style={{
              width: scene.width,
              height: scene.height,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
            {scene.racks.map((rackFrame) => {
              const rackDevices = devices.filter(
                (device) => device.rackId === rackFrame.rack.id,
              );
              const rackMatches =
                !normalizedSearch ||
                searchResults.some(
                  (result) =>
                    (result.kind === "rack" &&
                      result.id === rackFrame.rack.id) ||
                    (result.kind === "device" &&
                      rackDevices.some((device) => device.id === result.id)) ||
                    (result.kind === "port" &&
                      rackDevices.some(
                        (device) =>
                          device.id === model.portById[result.id]?.deviceId,
                      )),
                );
              return (
                <section
                  key={rackFrame.rack.id}
                  data-rack-cabling-interactive="true"
                  data-testid="rack-cabling-rack"
                  data-selected={
                    selectedRackId === rackFrame.rack.id ? "true" : "false"
                  }
                  data-search-match={rackMatches ? "true" : "false"}
                  className={cn(
                    "absolute rounded-[5px] border-2 bg-[color-mix(in_srgb,var(--surface-2)_92%,transparent)] shadow-[0_18px_42px_rgb(0_0_0_/_0.24)] transition-[border-color,opacity,box-shadow]",
                    selectedRackId === rackFrame.rack.id
                      ? "border-[var(--accent-primary)] shadow-[0_0_0_3px_var(--accent-primary-border),0_18px_42px_rgb(0_0_0_/_0.26)]"
                      : "border-[var(--border-strong)]",
                    !rackMatches && "opacity-25",
                  )}
                  style={{
                    left: rackFrame.x,
                    top: rackFrame.y,
                    width: rackFrame.width,
                    height: rackFrame.height,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectRack(rackFrame.rack.id);
                  }}
                >
                  <button
                    type="button"
                    data-cabling-selection-id={`rack:${rackFrame.rack.id}`}
                    aria-label={t("{value1}: {name}", {
                      value1: t("Rack"),
                      name: rackFrame.rack.name,
                    })}
                    className="absolute inset-x-0 top-0 flex h-[38px] items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-1)] px-3 text-left"
                    onClick={(event) => {
                      event.stopPropagation();
                      selectRack(rackFrame.rack.id);
                    }}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] font-semibold text-[var(--text-primary)]">
                        {rackFrame.rack.name}
                      </div>
                      <div className="truncate font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        {room.name}
                      </div>
                    </div>
                    <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                      {rackFrame.rack.totalU}
                      {t("U")}
                    </span>
                  </button>
                  {rackFrame.faces.map((faceFrame) => (
                    <RackFaceFrame
                      key={faceFrame.face}
                      rackTotalU={rackFrame.rack.totalU}
                      frame={faceFrame}
                      originX={rackFrame.x}
                      originY={rackFrame.y}
                      ports={ports}
                      linkedPortIds={linkedPortIds}
                      selectedPortId={
                        traceMode.enabled
                          ? (traceMode.firstPortId ?? undefined)
                          : (selectedPortId ?? undefined)
                      }
                      highlightedDeviceIds={highlightedDeviceIds}
                      healthOverlay={healthOverlay}
                      model={model}
                      matchingDeviceIds={matchingDeviceIds}
                      primaryEquipmentItemByDeviceId={
                        primaryEquipmentItemByDeviceId
                      }
                      onSelectDevice={selectDevice}
                      onSelectPort={selectPort}
                    />
                  ))}
                </section>
              );
            })}

            {scene.looseTray && (
              <section
                className="absolute rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-2)_90%,transparent)] shadow-[var(--shadow-card)]"
                style={{
                  left: scene.looseTray.x,
                  top: scene.looseTray.y,
                  width: scene.looseTray.width,
                  height: scene.looseTray.height,
                }}
              >
                <button
                  type="button"
                  data-rack-cabling-interactive="true"
                  className="flex h-[42px] w-full items-center gap-2 border-b border-[var(--border-default)] px-3 text-left"
                  onClick={() => onLooseExpandedChange(!looseExpanded)}
                >
                  <Box className="size-4 text-[var(--accent-primary)]" />
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-primary)]">
                    {t("Loose gear")}
                  </span>
                  <span className="text-[10px] text-[var(--text-tertiary)]">
                    {scene.looseTray.deviceCount} {t("devices")}
                  </span>
                  {looseExpanded ? (
                    <ChevronUp className="ml-auto size-4" />
                  ) : (
                    <ChevronDown className="ml-auto size-4" />
                  )}
                </button>
                {!looseExpanded &&
                  Array.from(
                    new Map(
                      scene.anchors
                        .filter(
                          (anchor) =>
                            anchor.kind === "loose-handoff" && !anchor.rackId,
                        )
                        .map((anchor) => [anchor.deviceId, anchor]),
                    ).values(),
                  ).map((anchor) => {
                    const device = devices.find(
                      (candidate) => candidate.id === anchor.deviceId,
                    );
                    return (
                      <span
                        key={anchor.deviceId}
                        className="absolute top-[45px] flex max-w-28 -translate-x-1/2 items-center gap-1 truncate font-mono text-[8px] text-[var(--text-secondary)]"
                        style={{ left: anchor.x - scene.looseTray!.x }}
                      >
                        <span className="size-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]" />
                        {device?.hostname ?? anchor.deviceId}
                      </span>
                    );
                  })}
                {scene.looseCards.map((card) => {
                  const matches =
                    !matchingDeviceIds || matchingDeviceIds.has(card.device.id);
                  const health = model.nodesByDeviceId[card.device.id]?.health;
                  return (
                    <div
                      key={card.device.id}
                      role="group"
                      aria-label={card.device.hostname}
                      data-rack-cabling-interactive="true"
                      className={cn(
                        "absolute overflow-hidden rounded-[var(--radius-sm)] border bg-[var(--surface-1)] text-left",
                        highlightedDeviceIds.has(card.device.id)
                          ? "border-[var(--accent-primary)]"
                          : "border-[var(--border-strong)]",
                        !matches && "opacity-20",
                        healthOverlay &&
                          health === "online" &&
                          "border-emerald-400",
                        healthOverlay &&
                          health === "warning" &&
                          "border-amber-400",
                        healthOverlay &&
                          health === "offline" &&
                          "border-red-400",
                      )}
                      style={{
                        left: card.x - scene.looseTray!.x,
                        top: card.y - scene.looseTray!.y,
                        width: card.width,
                        height: card.height,
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectDevice(card.device.id);
                      }}
                    >
                      <button
                        type="button"
                        data-cabling-selection-id={`device:${card.device.id}`}
                        className="absolute left-2 top-1.5 z-10 font-mono text-[9px] font-semibold text-[var(--text-primary)]"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectDevice(card.device.id);
                        }}
                      >
                        {card.device.hostname}
                      </button>
                      {card.layout ? (
                        card.faces.map((face) => (
                          <PhysicalFaceplate
                            key={face.face}
                            layout={card.layout!}
                            face={face.face}
                            ports={ports.filter(
                              (port) => port.deviceId === card.device.id,
                            )}
                            linkedPortIds={linkedPortIds}
                            selectedPortId={selectedPortId ?? undefined}
                            compact
                            detail="simplified"
                            fit="stretch"
                            onSelectPort={(portId) =>
                              selectPort(card.device.id, portId)
                            }
                            className="absolute rounded-[2px] shadow-none"
                            style={{
                              left: face.x - card.x,
                              top: face.y - card.y,
                              width: face.width,
                              height: face.height,
                            }}
                          />
                        ))
                      ) : (
                        <span className="absolute inset-x-2 bottom-2 rounded border border-dashed border-[var(--color-warning)]/50 px-2 py-2 text-[9px] text-[var(--color-warning)]">
                          {t("Physical layout")} · {t("Needs attention")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            <svg
              className="pointer-events-none absolute inset-0 z-40 overflow-visible"
              width={scene.width}
              height={scene.height}
              viewBox={`0 0 ${scene.width} ${scene.height}`}
              aria-label={t("Cables")}
            >
              {routes.map((route) => {
                const selected =
                  selection?.kind === "cable" && selection.id === route.link.id;
                const hovered = hoveredCableId === route.link.id;
                const traced = Boolean(
                  traceMode.enabled &&
                  traceMode.result?.cableIds.has(route.link.id),
                );
                const deviceSelected =
                  selection?.kind === "device" &&
                  [route.link.fromPortId, route.link.toPortId].some(
                    (portId) =>
                      model.portById[portId]?.deviceId === selection.id,
                  );
                const portSelected =
                  selectedPortId === route.link.fromPortId ||
                  selectedPortId === route.link.toPortId;
                const rackSelected =
                  selectedRackId &&
                  [route.from.rackId, route.to.rackId].includes(selectedRackId);
                const anyFocus = Boolean(
                  selection || selectedRackId || traceMode.result,
                );
                const emphasized =
                  selected ||
                  hovered ||
                  traced ||
                  deviceSelected ||
                  portSelected ||
                  rackSelected;
                const searchMatches =
                  !matchingCableIds ||
                  matchingCableIds.has(route.link.id) ||
                  [route.link.fromPortId, route.link.toPortId].some(
                    (portId) => {
                      const deviceId = model.portById[portId]?.deviceId;
                      return Boolean(
                        deviceId && matchingDeviceIds?.has(deviceId),
                      );
                    },
                  );
                const fromPort = model.portById[route.link.fromPortId];
                const toPort = model.portById[route.link.toPortId];
                const fromDevice = fromPort
                  ? model.deviceById[fromPort.deviceId]
                  : undefined;
                const toDevice = toPort
                  ? model.deviceById[toPort.deviceId]
                  : undefined;
                const cableAriaLabel = `${fromDevice?.hostname ?? t("Unknown")} ${fromPort?.name ?? "?"} ${t("to")} ${toDevice?.hostname ?? t("Unknown")} ${toPort?.name ?? "?"}`;
                return (
                  <g key={route.link.id}>
                    <path
                      d={route.path}
                      data-testid="rack-cabling-cable"
                      data-cable-id={route.link.id}
                      data-cabling-selection-id={`cable:${route.link.id}`}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      className="pointer-events-stroke cursor-pointer"
                      data-rack-cabling-interactive="true"
                      role="button"
                      tabIndex={0}
                      focusable="true"
                      aria-label={cableAriaLabel}
                      onMouseEnter={() => setHoveredCableId(route.link.id)}
                      onMouseLeave={() => setHoveredCableId(null)}
                      onFocus={() => setHoveredCableId(route.link.id)}
                      onBlur={() => setHoveredCableId(null)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        selectCable(route.link.id);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        selectCable(route.link.id);
                      }}
                    />
                    <path
                      d={route.path}
                      fill="none"
                      stroke={route.color}
                      strokeWidth={
                        selected || traced ? 4.5 : emphasized ? 3.5 : 2.5
                      }
                      strokeDasharray={
                        route.handoffs.length > 0 ? "8 5" : undefined
                      }
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={
                        !searchMatches
                          ? 0.08
                          : anyFocus && !emphasized
                            ? 0.14
                            : route.handoffs.length > 0 && !emphasized
                              ? 0.34
                              : 0.9
                      }
                    />
                    {(showLabels || selected || hovered) && (
                      <text
                        data-testid="rack-cabling-cable-label"
                        x={route.labelPoint.x}
                        y={route.labelPoint.y - 7}
                        textAnchor="middle"
                        fill="var(--text-primary)"
                        stroke="var(--surface-1)"
                        strokeWidth={4}
                        paintOrder="stroke"
                        fontSize={9}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        className="pointer-events-none"
                      >
                        {route.label}
                      </text>
                    )}
                    {route.handoffs.map((handoff) => {
                      const geometry = handoffLabelGeometryById.get(
                        `${route.link.id}:${handoff.endpoint}`,
                      );
                      if (!geometry) return null;
                      return (
                        <g key={handoff.anchorPortId}>
                          {geometry.leaderPath ? (
                            <path
                              d={geometry.leaderPath}
                              fill="none"
                              stroke="var(--text-tertiary)"
                              strokeWidth={0.75}
                              strokeDasharray="2 2"
                              className="pointer-events-none"
                            />
                          ) : null}
                          <text
                            data-testid="rack-cabling-handoff-label"
                            data-handoff-lane={geometry.lane}
                            data-handoff-packing-column={geometry.packingColumn}
                            x={geometry.x}
                            y={geometry.y}
                            textAnchor={geometry.textAnchor}
                            fill="var(--text-primary)"
                            stroke="var(--surface-1)"
                            strokeWidth={4}
                            paintOrder="stroke"
                            fontSize={9}
                            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                            className="pointer-events-none"
                          >
                            {handoffLabel(handoff)}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <div
          data-rack-cabling-interactive="true"
          className="rk-panel absolute left-3 top-3 z-50 flex max-w-[calc(100%-1.5rem)] items-center gap-2 overflow-x-auto rounded-[var(--radius-md)] p-2 shadow-[var(--shadow-card)]"
        >
          <select
            aria-label={t("Room")}
            value={roomId}
            onChange={(event) => onRoomIdChange(event.target.value)}
            className="rk-control h-8 w-44 shrink-0 px-2 text-xs text-[var(--text-primary)]"
          >
            {rooms.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <div className="relative w-44 shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <Input
              ref={searchRef}
              aria-label={t("Search")}
              aria-controls="rack-cabling-search-results"
              aria-expanded={normalizedSearch ? true : undefined}
              aria-activedescendant={
                normalizedSearch && searchResults[searchIndex]
                  ? `rack-cabling-search-${searchIndex}`
                  : undefined
              }
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("Search")}
              className="h-8 pl-8 text-xs"
            />
          </div>
          <select
            aria-label={t("Cable routing")}
            value={routeStyle}
            onChange={(event) =>
              onRouteStyleChange(event.target.value as RackCablingRouteStyle)
            }
            className="rk-control h-8 w-32 shrink-0 px-2 text-xs text-[var(--text-primary)]"
          >
            <option value="smooth">{t("Smooth")}</option>
            <option value="orthogonal">{t("Orthogonal")}</option>
          </select>
          <label className="flex h-8 shrink-0 items-center gap-1.5 px-1 text-[11px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(event) => onShowLabelsChange(event.target.checked)}
            />
            {t("Labels")}
          </label>
        </div>

        {normalizedSearch && (
          <div
            id="rack-cabling-search-results"
            role="listbox"
            aria-label={t("Search")}
            data-rack-cabling-interactive="true"
            className="rk-panel absolute left-[12.5rem] top-[4.25rem] z-[65] max-h-72 w-[min(22rem,calc(100%-13.25rem))] overflow-y-auto rounded-[var(--radius-md)] p-1.5 shadow-[var(--shadow-elev)]"
          >
            {searchResults.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">
                {t("No results")}
              </div>
            ) : (
              searchResults.map((result, index) => (
                <button
                  id={`rack-cabling-search-${index}`}
                  key={`${result.kind}:${result.id}`}
                  type="button"
                  role="option"
                  aria-selected={searchIndex === index}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left text-xs",
                    searchIndex === index
                      ? "bg-[var(--accent-primary-soft)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                  )}
                  onMouseEnter={() => setSearchIndex(index)}
                  onClick={() => activateSearchResult(result)}
                >
                  <span className="min-w-0 truncate">{result.label}</span>
                  <span className="shrink-0 font-mono text-[9px] text-[var(--text-tertiary)]">
                    {result.kind === "device" || result.kind === "cable"
                      ? visualizerSearchResultMeta(model, result, t)
                      : result.meta}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {traceMode.enabled && traceMode.message && (
          <div className="absolute bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--accent-primary-border)] bg-[var(--surface-1)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-[var(--shadow-card)]">
            {traceMode.message}
          </div>
        )}

        <div
          data-rack-cabling-interactive="true"
          className="absolute bottom-3 left-3 z-50 flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] shadow-[var(--shadow-card)]"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Zoom in")}
            onClick={() => {
              autoFitRef.current = false;
              setZoom((current) => Math.min(1.8, current + 0.1));
            }}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Zoom out")}
            onClick={() => {
              autoFitRef.current = false;
              setZoom((current) => Math.max(0.22, current - 0.1));
            }}
          >
            <Minus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Fit")}
            onClick={fitCanvas}
          >
            <Focus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Reset")}
            onClick={resetView}
          >
            <RotateCcw />
          </Button>
        </div>
      </div>

      <aside className="hidden min-h-0 overflow-y-auto bg-[var(--surface-1)] p-3 xl:block">
        <VisualizerInspector
          model={model}
          selection={selection}
          selectedCable={selectedCable}
          selectedNode={selectedNode}
          onSelectDevice={selectDevice}
          onSelectCable={selectCable}
          visibleCables={visibleCables}
          visibleDeviceIds={sceneDeviceIds}
          racksById={racksById}
          roomsById={roomsById}
        />
      </aside>
      {selection && (
        <aside className="absolute bottom-16 right-3 z-[70] max-h-[45%] w-[min(22rem,calc(100%-1.5rem))] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-1)] p-3 pt-12 shadow-[var(--shadow-card)] xl:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Close")}
            className="absolute right-4 top-4"
            onClick={closeInspector}
          >
            <X />
          </Button>
          <VisualizerInspector
            model={model}
            selection={selection}
            selectedCable={selectedCable}
            selectedNode={selectedNode}
            onSelectDevice={selectDevice}
            onSelectCable={selectCable}
            visibleCables={visibleCables}
            visibleDeviceIds={sceneDeviceIds}
            racksById={racksById}
            roomsById={roomsById}
          />
        </aside>
      )}
    </div>
  );
}

function RackFaceFrame({
  rackTotalU,
  frame,
  originX,
  originY,
  ports,
  linkedPortIds,
  selectedPortId,
  highlightedDeviceIds,
  healthOverlay,
  model,
  matchingDeviceIds,
  primaryEquipmentItemByDeviceId,
  onSelectDevice,
  onSelectPort,
}: {
  rackTotalU: number;
  frame: ReturnType<
    typeof buildRackCablingScene
  >["racks"][number]["faces"][number];
  originX: number;
  originY: number;
  ports: Port[];
  linkedPortIds: Set<string>;
  selectedPortId?: string;
  highlightedDeviceIds: Set<string>;
  healthOverlay: boolean;
  model: VisualizerModel;
  matchingDeviceIds: Set<string> | null;
  primaryEquipmentItemByDeviceId: Map<string, string>;
  onSelectDevice: (deviceId: string) => void;
  onSelectPort: (deviceId: string, portId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0">
      <span
        className="absolute -top-5 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-muted)]"
        style={{ left: frame.x - originX }}
      >
        {frame.face === "front" ? t("Front") : t("Rear")}
      </span>
      <RackElevationShell
        totalU={rackTotalU}
        unitHeight={RACK_CABLING_UNIT_HEIGHT}
        width={frame.width + 24}
        railX={12}
        railY={8}
        rowOffset={0}
        showColumns={false}
        className="absolute bg-[var(--bg-shell)] shadow-[inset_0_0_30px_rgb(0_0_0_/_0.34)]"
        style={{
          left: frame.x - originX - 12,
          top: frame.y - originY - 8,
        }}
      >
        {frame.equipment.map((item) => (
          <RackEquipment
            key={item.id}
            item={item}
            originX={frame.x}
            originY={frame.y}
            ports={ports}
            linkedPortIds={linkedPortIds}
            selectedPortId={selectedPortId}
            selected={highlightedDeviceIds.has(item.device.id)}
            healthOverlay={healthOverlay}
            health={model.nodesByDeviceId[item.device.id]?.health}
            matches={
              !matchingDeviceIds || matchingDeviceIds.has(item.device.id)
            }
            selectionId={
              primaryEquipmentItemByDeviceId.get(item.device.id) === item.id
                ? `device:${item.device.id}`
                : undefined
            }
            onSelectDevice={onSelectDevice}
            onSelectPort={onSelectPort}
          />
        ))}
      </RackElevationShell>
    </div>
  );
}

function RackEquipment({
  item,
  originX,
  originY,
  ports,
  linkedPortIds,
  selectedPortId,
  selected,
  healthOverlay,
  health,
  matches,
  selectionId,
  onSelectDevice,
  onSelectPort,
}: {
  item: RackCablingEquipment;
  originX: number;
  originY: number;
  ports: Port[];
  linkedPortIds: Set<string>;
  selectedPortId?: string;
  selected: boolean;
  healthOverlay: boolean;
  health?: string;
  matches: boolean;
  selectionId?: string;
  onSelectDevice: (deviceId: string) => void;
  onSelectPort: (deviceId: string, portId: string) => void;
}) {
  const { t } = useI18n();
  const devicePorts = ports.filter(
    (port) =>
      port.deviceId === item.device.id && portSupportsPhysicalPatching(port),
  );
  return (
    <RackElevationEquipmentFrame
      device={item.device}
      layout={item.layout}
      physicalFace={item.physicalFace}
      ports={devicePorts}
      linkedPortIds={linkedPortIds}
      selectedPortId={selectedPortId}
      rotation={item.rotation}
      rectWidth={item.rect.width}
      rectHeight={item.rect.height}
      selected={selected}
      matches={matches}
      healthClassName={cn(
        healthOverlay && health === "online" && "border-emerald-400",
        healthOverlay && health === "warning" && "border-amber-400",
        healthOverlay && health === "offline" && "border-red-400",
      )}
      configurationWarning={
        item.fallbackReason === "unavailable-position"
          ? t("Physical position unavailable")
          : undefined
      }
      detail="simplified"
      testId="rack-cabling-equipment"
      selectionId={selectionId}
      style={{
        left: item.rect.x - originX,
        top: item.rect.y - originY,
        width: item.rect.width,
        height: item.rect.height,
      }}
      onSelectDevice={onSelectDevice}
      onSelectPort={onSelectPort}
    />
  );
}
