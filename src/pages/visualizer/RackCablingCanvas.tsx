import { rackFaceForPhysicalFace } from "@/lib/rack-studio-scene";
import { CableContinuationMarkers } from "@/components/rack/CableContinuationMarkers";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
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
  layoutRackCablingAnnotations,
  layoutRackCablingHandoffLabels,
  rackCablingSelectionIsInScope,
  RACK_CABLING_UNIT_HEIGHT,
  type RackCablingEquipment,
  type RackCablingAnnotationGeometry,
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
  roomIds: string[];
  onRoomIdsChange: (roomIds: string[]) => void;
  racks: Rack[];
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  portLinks: PortLink[];
  model: VisualizerModel;
  rackOrder: string[];
  faceMode: VisualizerRackFaceMode;
  onFaceModeChange: (face: VisualizerRackFaceMode) => void;
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
  roomIds,
  onRoomIdsChange,
  racks,
  devices,
  layouts,
  ports,
  portLinks,
  model,
  rackOrder,
  faceMode,
  onFaceModeChange,
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
  const [pendingReveal, setPendingReveal] = useState<{
    portId: string;
    cableId: string;
  }>();
  const viewportRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const allRoomsCheckboxRef = useRef<HTMLInputElement>(null);
  const panRef = useRef<PanState | null>(null);
  const autoFitRef = useRef(true);
  const previousRoomIdsRef = useRef(roomIds.join("\u0000"));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<RackCablingSelection>(null);
  const [hoveredLooseDeviceId, setHoveredLooseDeviceId] = useState<
    string | null
  >(null);
  const [hoveredCableId, setHoveredCableId] = useState<string | null>(null);
  const [searchIndex, setSearchIndex] = useState(0);
  const selectedRooms = useMemo(() => {
    const selected = new Set(roomIds);
    return rooms.filter((room) => selected.has(room.id));
  }, [roomIds, rooms]);
  const roomSelectionKey = roomIds.join("\u0000");
  const allRoomsSelected =
    rooms.length > 0 && selectedRooms.length === rooms.length;
  const roomPickerLabel =
    selectedRooms.length === 0
      ? `${t("Select")} ${t("Rooms")}`
      : allRoomsSelected
        ? `${t("All")} ${t("Rooms")}`
        : selectedRooms.length === 1
          ? selectedRooms[0]!.name
          : `${selectedRooms.length} ${t("Rooms")}`;

  useEffect(() => {
    if (!allRoomsCheckboxRef.current) return;
    allRoomsCheckboxRef.current.indeterminate =
      selectedRooms.length > 0 && !allRoomsSelected;
  }, [allRoomsSelected, selectedRooms.length]);
  const scene = useMemo(
    () =>
      buildRackCablingScene({
        rooms: selectedRooms,
        racks,
        devices,
        layouts,
        ports,
        faceMode,
        rackOrder,
        looseExpanded,
      }),
    [
      selectedRooms,
      racks,
      devices,
      layouts,
      ports,
      faceMode,
      rackOrder,
      looseExpanded,
    ],
  );
  const routes = useMemo(
    () =>
      buildRackCablingRoutes({
        scene,
        rooms,
        racks,
        devices,
        ports,
        links: portLinks,
        cableType,
        style: routeStyle,
      }),
    [scene, rooms, racks, devices, ports, portLinks, cableType, routeStyle],
  );
  const handoffLabel = useCallback(
    (handoff: RackCablingHandoff) => {
      const endpoint = `${handoff.deviceLabel} · ${handoff.portLabel}`;
      if (handoff.reason === "cross-room") {
        return t("{value1}: {name}", {
          value1: t("Room"),
          name: `${handoff.roomLabel ?? t("Unknown")} · ${endpoint}`,
        });
      }
      if (handoff.reason === "hidden-face") {
        return t("{value1}: {name}", {
          value1: handoff.rackFace === "rear" ? t("Rear") : t("Front"),
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
    },
    [t],
  );
  const handoffLabels = useMemo(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (context)
      context.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";
    const maxWidth = Math.max(40, (scene?.width ?? 600) / 3 - 24);
    const measure = (value: string) =>
      context?.measureText(value).width ?? value.length * 6;
    return new Map<string, { full: string; text: string; width: number }>(
      routes.flatMap((route) =>
        route.handoffs.map((handoff) => {
          const full = handoffLabel(handoff);
          let text = full;
          while (text.length > 1 && measure(text) > maxWidth)
            text = text.slice(0, -2) + "…";
          return [
            `${route.link.id}:${handoff.endpoint}`,
            { full, text, width: measure(text) },
          ] as const;
        }),
      ),
    );
  }, [routes, scene, handoffLabel]);
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
        meta: rooms.find((room) => room.id === entry.rack.roomId)?.name ?? "",
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
    rooms,
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

  const emphasizedRouteIds = useMemo(() => {
    const ids = new Set<string>();
    for (const route of routes) {
      const selected =
        selection?.kind === "cable" && selection.id === route.link.id;
      const hovered = hoveredCableId === route.link.id;
      const traced = Boolean(
        traceMode.enabled && traceMode.result?.cableIds.has(route.link.id),
      );
      const focusedDeviceId =
        hoveredLooseDeviceId ??
        (selection?.kind === "device" ? selection.id : null);
      const deviceSelected =
        focusedDeviceId != null &&
        [route.link.fromPortId, route.link.toPortId].some(
          (portId) => model.portById[portId]?.deviceId === focusedDeviceId,
        );
      const portSelected =
        selectedPortId === route.link.fromPortId ||
        selectedPortId === route.link.toPortId;
      const rackSelected =
        selectedRackId != null &&
        [route.from.rackId, route.to.rackId].includes(selectedRackId);
      if (
        selected ||
        hovered ||
        traced ||
        deviceSelected ||
        portSelected ||
        rackSelected
      ) {
        ids.add(route.link.id);
      }
    }
    return ids;
  }, [
    hoveredCableId,
    hoveredLooseDeviceId,
    model.portById,
    routes,
    selectedPortId,
    selectedRackId,
    selection,
    traceMode.enabled,
    traceMode.result,
  ]);

  const annotationLayout = useMemo(() => {
    const handoffGeometry = new Map(
      layoutRackCablingHandoffLabels(
        scene,
        routes,
        new Map([...handoffLabels].map(([id, label]) => [id, label.width])),
      ).map((entry) => [entry.id, entry]),
    );
    const inputs = routes.flatMap((route) => {
      const emphasized = emphasizedRouteIds.has(route.link.id);
      const selectedOrHovered =
        (selection?.kind === "cable" && selection.id === route.link.id) ||
        hoveredCableId === route.link.id;
      const traced = Boolean(
        traceMode.enabled && traceMode.result?.cableIds.has(route.link.id),
      );
      const priority = selectedOrHovered ? 0 : traced ? 1 : 2;
      const result = [];
      if (!route.continuations.length && (showLabels || emphasized)) {
        result.push({
          id: `cable:${route.link.id}`,
          linkId: route.link.id,
          kind: "cable" as const,
          text: route.label,
          priority,
          anchor: route.labelPoint,
          geometry: route.geometry,
        });
      }
      for (const handoff of route.handoffs) {
        if (
          !(showLabels || emphasized) ||
          (handoff.reason === "loose-tray" && !emphasized) ||
          (route.continuations.length > 0 && handoff.reason === "hidden-face")
        ) {
          continue;
        }
        const key = `${route.link.id}:${handoff.endpoint}`;
        const anchor = handoff.endpoint === "from" ? route.from : route.to;
        const preferred = handoffGeometry.get(key);
        result.push({
          id: `handoff:${key}`,
          linkId: route.link.id,
          kind: "handoff" as const,
          text: handoffLabels.get(key)?.text ?? handoffLabel(handoff),
          priority,
          anchor,
          preferredPoint: preferred
            ? { x: preferred.x, y: preferred.y }
            : anchor,
        });
      }
      return result;
    });
    return layoutRackCablingAnnotations(scene, inputs);
  }, [
    emphasizedRouteIds,
    handoffLabel,
    handoffLabels,
    hoveredCableId,
    routes,
    scene,
    selection,
    showLabels,
    traceMode.enabled,
    traceMode.result,
  ]);
  const annotationById = useMemo(
    () =>
      new Map(annotationLayout.annotations.map((entry) => [entry.id, entry])),
    [annotationLayout.annotations],
  );

  const applyFit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !scene) return;
    const bounds = viewport.getBoundingClientRect();
    const nextZoom = Math.max(
      0.28,
      Math.min(
        1.35,
        (bounds.width - 56) / Math.max(1, annotationLayout.width),
        (bounds.height - 56) / Math.max(1, annotationLayout.height),
      ),
    );
    setZoom(nextZoom);
    setPan({
      x: (bounds.width - annotationLayout.width * nextZoom) / 2,
      y: (bounds.height - annotationLayout.height * nextZoom) / 2,
    });
  }, [annotationLayout.height, annotationLayout.width, scene]);

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
  }, [applyFit, roomSelectionKey, faceMode, looseExpanded]);

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
    if (previousRoomIdsRef.current === roomSelectionKey) return;
    previousRoomIdsRef.current = roomSelectionKey;
    setSelection(null);
    setHoveredCableId(null);
    setHoveredLooseDeviceId(null);
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
  }, [roomSelectionKey, setTraceMode, t]);

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
        setHoveredLooseDeviceId(null);
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

  useEffect(() => {
    if (!pendingReveal) return;
    const anchor = scene?.anchors.find(
      (anchor) => anchor.portId === pendingReveal.portId,
    );
    const viewport = viewportRef.current;
    if (!anchor || !viewport) return;
    const bounds = viewport.getBoundingClientRect();
    autoFitRef.current = false;
    setZoom(1);
    setPan({ x: bounds.width / 2 - anchor.x, y: bounds.height / 2 - anchor.y });
    setSelection({ kind: "cable", id: pendingReveal.cableId });
    setPendingReveal(undefined);
  }, [scene, pendingReveal]);

  function revealEndpoint(portId: string, cableId: string) {
    const port = ports.find((port) => port.id === portId);
    const device = devices.find((device) => device.id === port?.deviceId);
    if (!port || !device) return;
    const roomId =
      racks.find((rack) => rack.id === device.rackId)?.roomId ?? device.roomId;
    if (roomId && !roomIds.includes(roomId)) {
      onRoomIdsChange([...roomIds, roomId]);
    }
    onFaceModeChange(
      rackFaceForPhysicalFace(device, port.face === "rear" ? "rear" : "front"),
    );
    setPendingReveal({ portId, cableId });
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

  if (rooms.length === 0) {
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
          {selectedRooms.length === 0 && (
            <div className="rk-panel absolute left-1/2 top-1/2 z-[60] w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-md)] p-6 text-center">
              <Cable className="mx-auto size-8 text-[var(--accent-primary)]" />
              <h2 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                {t("No room selected")}
              </h2>
              <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
                {t("Select all")} · {t("Rooms")}
              </p>
            </div>
          )}
          {selectedRooms.length > 0 &&
            scene.racks.length === 0 &&
            scene.looseTrays.length === 0 && (
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
              width: annotationLayout.width,
              height: annotationLayout.height,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
            {scene.rooms.map((roomFrame) => (
              <section
                key={roomFrame.room.id}
                data-testid="rack-cabling-room-section"
                data-room-id={roomFrame.room.id}
                className="pointer-events-none absolute rounded-[var(--radius-md)] border border-[var(--border-muted)] bg-[color-mix(in_srgb,var(--surface-2)_35%,transparent)]"
                style={{
                  left: roomFrame.x,
                  top: roomFrame.y,
                  width: roomFrame.width,
                  height: roomFrame.height,
                }}
              >
                <h2 className="flex h-[38px] items-center border-b border-[var(--border-muted)] px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                  {t("Room")} · {roomFrame.room.name}
                </h2>
              </section>
            ))}
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
                        {rooms.find((room) => room.id === rackFrame.rack.roomId)
                          ?.name ?? t("Unknown")}
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

            {scene.rooms.map((roomFrame) => {
              const tray = roomFrame.looseTray;
              if (!tray) return null;
              return (
                <section
                  key={`loose:${roomFrame.room.id}`}
                  data-testid="rack-cabling-loose-tray"
                  data-room-id={roomFrame.room.id}
                  className="absolute rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-2)_90%,transparent)] shadow-[var(--shadow-card)]"
                  style={{
                    left: tray.x,
                    top: tray.y,
                    width: tray.width,
                    height: tray.height,
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
                      {tray.deviceCount} {t("devices")} · {roomFrame.room.name}
                    </span>
                    {looseExpanded ? (
                      <ChevronUp className="ml-auto size-4" />
                    ) : (
                      <ChevronDown className="ml-auto size-4" />
                    )}
                  </button>
                  {roomFrame.looseSummaries.map((summary) => {
                    const connected = routes.filter((route) =>
                      [
                        model.portById[route.link.fromPortId]?.deviceId,
                        model.portById[route.link.toPortId]?.deviceId,
                      ].includes(summary.device.id),
                    );
                    const details = connected
                      .map((route) =>
                        [route.link.fromPortId, route.link.toPortId]
                          .map((id) => {
                            const port = model.portById[id];
                            return `${model.deviceById[port?.deviceId]?.hostname ?? t("Unknown")} · ${port?.name ?? "?"} · ${t(port?.face === "rear" ? "Rear" : "Front")}`;
                          })
                          .join(" → "),
                      )
                      .join("\n");
                    const detailsVisible =
                      hoveredLooseDeviceId === summary.device.id ||
                      (selection?.kind === "device" &&
                        selection.id === summary.device.id);
                    const detailsId = `loose-details-${summary.device.id}`;
                    return (
                      <div
                        key={summary.device.id}
                        className="absolute z-50 min-w-0 focus-within:z-[60] hover:z-[60]"
                        data-rack-cabling-interactive="true"
                        style={{
                          left: summary.x - tray.x + 4,
                          top: summary.y - tray.y + 3,
                          width: summary.width - 8,
                          height: summary.height - 8,
                        }}
                        onMouseEnter={() =>
                          setHoveredLooseDeviceId(summary.device.id)
                        }
                        onMouseLeave={() => setHoveredLooseDeviceId(null)}
                        onFocus={() =>
                          setHoveredLooseDeviceId(summary.device.id)
                        }
                        onBlur={(event) => {
                          if (
                            !event.currentTarget.contains(event.relatedTarget)
                          )
                            setHoveredLooseDeviceId(null);
                        }}
                      >
                        <button
                          type="button"
                          data-testid="loose-device-summary"
                          data-cabling-selection-id={`device:${summary.device.id}`}
                          className="h-full w-full min-w-0 overflow-hidden rounded border border-[var(--border-default)] bg-[var(--surface-1)] px-2 text-left text-[11px] focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)]"
                          aria-describedby={
                            detailsVisible ? detailsId : undefined
                          }
                          aria-label={t("{value1}: {name}", {
                            value1: summary.device.hostname,
                            name: `${connected.length} ${t("Cables")}`,
                          })}
                          onClick={(event) => {
                            event.stopPropagation();
                            selectDevice(summary.device.id);
                          }}
                        >
                          <span className="block truncate font-mono">
                            {summary.device.hostname}
                          </span>
                          <span className="block text-[var(--text-secondary)]">
                            {t("Cables")}: {connected.length}
                          </span>
                        </button>
                        {detailsVisible && (
                          <div
                            id={detailsId}
                            role="tooltip"
                            tabIndex={0}
                            data-testid="loose-device-details"
                            className="absolute bottom-full mb-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border-default)] bg-[var(--surface-1)] p-3 text-xs shadow-lg"
                            style={{
                              width: Math.min(400, scene.width - 32),
                              left: Math.min(0, scene.width - summary.x - 416),
                            }}
                          >
                            {details || summary.device.hostname}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {roomFrame.looseCards.map((card) => {
                    const matches =
                      !matchingDeviceIds ||
                      matchingDeviceIds.has(card.device.id);
                    const health =
                      model.nodesByDeviceId[card.device.id]?.health;
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
                          left: card.x - tray.x,
                          top: card.y - tray.y,
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
              );
            })}

            <svg
              className="pointer-events-none absolute inset-0 z-40 overflow-visible"
              width={annotationLayout.width}
              height={annotationLayout.height}
              viewBox={`0 0 ${annotationLayout.width} ${annotationLayout.height}`}
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
                  (selection?.kind === "device" ||
                    hoveredLooseDeviceId !== null) &&
                  [route.link.fromPortId, route.link.toPortId].some(
                    (portId) =>
                      model.portById[portId]?.deviceId ===
                      (hoveredLooseDeviceId ?? selection?.id),
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
                const cableAnnotation = annotationById.get(
                  `cable:${route.link.id}`,
                );
                return (
                  <g key={route.link.id}>
                    <path
                      d={route.path}
                      data-testid="rack-cabling-cable"
                      data-cable-id={route.link.id}
                      data-from-room={route.from.roomId}
                      data-to-room={route.to.roomId}
                      data-handoff-count={route.handoffs.length}
                      data-handoff-reasons={route.handoffs
                        .map((handoff) => handoff.reason)
                        .join(",")}
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
                        selected || traced ? 2.6 : emphasized ? 2 : 1.35
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
                            : 0.9
                      }
                    />
                    <CableContinuationMarkers
                      onRevealEndpoint={revealEndpoint}
                      markers={route.continuations}
                      linkId={route.link.id}
                      cableLabel={route.label}
                      color={route.color}
                      ports={ports}
                      devices={devices}
                      showLabels={showLabels || selected || hovered}
                      opacity={
                        !searchMatches
                          ? 0.08
                          : anyFocus && !emphasized
                            ? 0.14
                            : 0.9
                      }
                    />
                    {cableAnnotation ? (
                      <RackCablingAnnotation
                        geometry={cableAnnotation}
                        text={route.label}
                        testId="rack-cabling-cable-label"
                      />
                    ) : null}
                    {route.handoffs
                      .filter(
                        (handoff) =>
                          (showLabels || emphasized) &&
                          (handoff.reason !== "loose-tray" || emphasized) &&
                          (!route.continuations.length ||
                            handoff.reason !== "hidden-face"),
                      )
                      .map((handoff) => {
                        const key = `${route.link.id}:${handoff.endpoint}`;
                        const geometry = annotationById.get(`handoff:${key}`);
                        if (!geometry) return null;
                        return (
                          <RackCablingAnnotation
                            key={handoff.anchorPortId}
                            geometry={geometry}
                            text={
                              handoffLabels.get(key)?.text ??
                              handoffLabel(handoff)
                            }
                            title={handoffLabels.get(key)?.full}
                            testId="rack-cabling-handoff-label"
                          />
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
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t("{value1}: {name}", {
                  value1: t("Rooms"),
                  name: roomPickerLabel,
                })}
                data-testid="rack-cabling-room-picker"
                className="w-44 shrink-0 justify-between"
              >
                <span className="truncate">{roomPickerLabel}</span>
                <ChevronDown className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-64 space-y-1 p-2"
              data-rack-cabling-interactive="true"
            >
              <div className="flex items-center justify-between gap-2 border-b border-[var(--border-default)] pb-2">
                <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
                  <input
                    ref={allRoomsCheckboxRef}
                    type="checkbox"
                    checked={allRoomsSelected}
                    aria-label={t("Select all")}
                    onChange={(event) =>
                      onRoomIdsChange(
                        event.target.checked
                          ? rooms.map((room) => room.id)
                          : [],
                      )
                    }
                  />
                  <span className="truncate">
                    {t("Select all")} · {t("Rooms")}
                  </span>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={selectedRooms.length === 0}
                  onClick={() => onRoomIdsChange([])}
                >
                  {t("Clear")}
                </Button>
              </div>
              <div className="max-h-64 space-y-0.5 overflow-y-auto">
                {rooms.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                  >
                    <input
                      type="checkbox"
                      data-room-id={entry.id}
                      checked={roomIds.includes(entry.id)}
                      onChange={(event) =>
                        onRoomIdsChange(
                          event.target.checked
                            ? [...roomIds, entry.id]
                            : roomIds.filter((id) => id !== entry.id),
                        )
                      }
                    />
                    <span className="truncate">{entry.name}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
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

function RackCablingAnnotation({
  geometry,
  text,
  title,
  testId,
}: {
  geometry: RackCablingAnnotationGeometry;
  text: string;
  title?: string;
  testId: string;
}) {
  return (
    <g
      data-testid={testId}
      data-annotation-id={geometry.id}
      data-label-rail={geometry.inRail ? "true" : "false"}
      className="pointer-events-none"
    >
      {geometry.leaderPath ? (
        <path
          d={geometry.leaderPath}
          fill="none"
          stroke="var(--text-tertiary)"
          strokeWidth={0.75}
          strokeDasharray="2 2"
        />
      ) : null}
      <rect
        x={geometry.x}
        y={geometry.y}
        width={geometry.width}
        height={geometry.height}
        rx={3}
        fill="var(--surface-1)"
        stroke="var(--border-default)"
        strokeWidth={0.75}
      />
      <text
        x={geometry.textX}
        y={geometry.textY}
        textAnchor="middle"
        fill="var(--text-primary)"
        fontSize={9}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {title ? <title>{title}</title> : null}
        {text}
      </text>
    </g>
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
    <div className="absolute inset-0" data-testid="rack-cabling-face" data-rack-face={frame.face}>
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
          top: frame.y + frame.rackOffsetY - originY - 8,
        }}
      >
        {frame.equipment.map((item) => (
          <RackEquipment
            key={item.id}
            item={item}
            originX={frame.x}
            originY={frame.y + frame.rackOffsetY}
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
