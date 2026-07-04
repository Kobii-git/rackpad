import {
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
  type WheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  Cable,
  ExternalLink,
  LocateFixed,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Route,
  Search,
  Server,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { Mono } from "@/components/shared/Mono";
import type { Port } from "@/lib/types";
import { formatDeviceAddress } from "@/lib/network-labels";
import { formatPortEndpointLabel } from "@/lib/utils";
import { useI18n } from "@/i18n";
import {
  buildSearchResults,
  nodeStripeColor,
  portTooltip,
  traceFromPort,
  tracePorts,
  typeLabel,
  visualizerCablePath,
} from "./model";
import type {
  RackBand,
  RackPanel,
  RackRoomSection,
  RoomGroup,
  SearchResult,
  TraceModeState,
  TraceResult,
  VisualizerCableLayout,
  VisualizerCable,
  VisualizerLooseDevicePlacement,
  VisualizerModel,
  VisualizerNode,
  VisualizerPoint,
  VisualizerPort,
  VisualizerRackFaceMode,
  VisualizerRackScale,
  VisualizerSelection,
  VisualizerShelfLayout,
} from "./types";

interface VisualizerCanvasProps {
  model: VisualizerModel;
  loading: boolean;
  healthOverlay: boolean;
  onToggleHealth: () => void;
  traceMode: TraceModeState;
  setTraceMode: Dispatch<SetStateAction<TraceModeState>>;
  cableType: string;
  cableLayout: VisualizerCableLayout;
  onCableLayoutChange: (layout: VisualizerCableLayout) => void;
  rackFaceMode: VisualizerRackFaceMode;
  onRackFaceModeChange: (mode: VisualizerRackFaceMode) => void;
  rackScale: VisualizerRackScale;
  onRackScaleChange: (scale: VisualizerRackScale) => void;
  shelfLayout: VisualizerShelfLayout;
  onShelfLayoutChange: (layout: VisualizerShelfLayout) => void;
  looseDevicePlacement: VisualizerLooseDevicePlacement;
  onToggleLooseDevicePlacement: () => void;
  includeRoomOnlySections: boolean;
  onToggleRoomOnlySections: () => void;
  onToggleReadableLabels: () => void;
  onResetCustomNodePositions: () => void;
  hasCustomNodePositions: boolean;
  noCableBannerDismissed: boolean;
  onDismissNoCableBanner: () => void;
  onToggleRackRun: (key: string) => void;
  onToggleGroup: (key: string) => void;
  readableLabels: boolean;
  onNodePositionChange?: (deviceId: string, position: VisualizerPoint) => void;
}

interface TransformState {
  x: number;
  y: number;
  scale: number;
}

export function VisualizerCanvas({
  model,
  loading,
  healthOverlay,
  onToggleHealth,
  traceMode,
  setTraceMode,
  cableType,
  cableLayout,
  onCableLayoutChange,
  rackFaceMode,
  onRackFaceModeChange,
  rackScale,
  onRackScaleChange,
  shelfLayout,
  onShelfLayoutChange,
  looseDevicePlacement,
  onToggleLooseDevicePlacement,
  includeRoomOnlySections,
  onToggleRoomOnlySections,
  onToggleReadableLabels,
  onResetCustomNodePositions,
  hasCustomNodePositions,
  noCableBannerDismissed,
  onDismissNoCableBanner,
  onToggleRackRun,
  onToggleGroup,
  readableLabels,
  onNodePositionChange,
}: VisualizerCanvasProps) {
  const { t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [transform, setTransform] = useState<TransformState>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const [dragStart, setDragStart] = useState<{
    pointerId: number;
    x: number;
    y: number;
    transform: TransformState;
  } | null>(null);
  const [selection, setSelection] = useState<VisualizerSelection>(null);
  const [hoveredCableId, setHoveredCableId] = useState<string | null>(null);
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [pulsedDeviceId, setPulsedDeviceId] = useState<string | null>(null);
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const [nodeDrag, setNodeDrag] = useState<{
    deviceId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPosition: VisualizerPoint;
  } | null>(null);

  const searchResults = useMemo(
    () => buildSearchResults(model, query),
    [model, query],
  );
  const selectedDevice =
    selection?.kind === "device" ? model.deviceById[selection.id] : null;
  const selectedCable =
    selection?.kind === "cable" ? model.cableById[selection.id] : null;
  const selectedNode = selectedDevice
    ? model.nodesByDeviceId[selectedDevice.id]
    : null;
  const selectedCableId =
    selection?.kind === "cable" ? selection.id : hoveredCableId;
  const isolatedDeviceId = selection?.kind === "device" ? selection.id : null;

  useEffect(() => {
    setSearchIndex(0);
  }, [query]);

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
        setQuery("");
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
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        fitToViewport();
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setTransform({ x: 0, y: 0, scale: 1 });
        return;
      }
      if (event.key === "1") {
        event.preventDefault();
        onToggleHealth();
        return;
      }
      if (event.key === "2") {
        event.preventDefault();
        toggleTraceMode();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function fitToViewport() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const scale = clamp(
      Math.min(
        (rect.width - 48) / model.width,
        (rect.height - 48) / model.height,
      ),
      0.5,
      2,
    );
    setTransform({
      scale,
      x: Math.max(16, (rect.width - model.width * scale) / 2),
      y: Math.max(16, (rect.height - model.height * scale) / 2),
    });
  }

  function resetView() {
    setTransform({ x: 0, y: 0, scale: 1 });
  }

  function toggleTraceMode() {
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
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).closest(
        "[data-visualizer-scrollable='true']",
      )
    ) {
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      const horizontalDelta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      setTransform((current) => ({
        ...current,
        x: current.x - horizontalDelta,
      }));
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextScale = clamp(
      transform.scale * (event.deltaY > 0 ? 0.9 : 1.1),
      0.5,
      2,
    );
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const worldX = (px - transform.x) / transform.scale;
    const worldY = (py - transform.y) / transform.scale;
    setTransform({
      scale: nextScale,
      x: px - worldX * nextScale,
      y: py - worldY * nextScale,
    });
  }

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-visualizer-interactive='true']")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection(null);
    setDragStart({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      transform,
    });
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    event.preventDefault();
    setTransform({
      ...dragStart.transform,
      x: dragStart.transform.x + event.clientX - dragStart.x,
      y: dragStart.transform.y + event.clientY - dragStart.y,
    });
  }

  function handleCanvasPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(dragStart.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStart.pointerId);
    }
    setDragStart(null);
  }

  function handleNodePointerDown(
    event: PointerEvent<HTMLDivElement>,
    node: VisualizerNode,
  ) {
    if (
      model.layoutMode !== "pyramid" ||
      !onNodePositionChange ||
      event.button !== 0
    ) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button,a,input,textarea,select")) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection({ kind: "device", id: node.device.id });
    setNodeDrag({
      deviceId: node.device.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: { x: node.x, y: node.y },
    });
  }

  function handleNodePointerMove(
    event: PointerEvent<HTMLDivElement>,
    node: VisualizerNode,
  ) {
    if (!nodeDrag || nodeDrag.deviceId !== node.device.id) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = (event.clientX - nodeDrag.startClientX) / transform.scale;
    const dy = (event.clientY - nodeDrag.startClientY) / transform.scale;
    onNodePositionChange?.(node.device.id, {
      x: nodeDrag.startPosition.x + dx,
      y: nodeDrag.startPosition.y + dy,
    });
  }

  function handleNodePointerUp(
    event: PointerEvent<HTMLDivElement>,
    node: VisualizerNode,
  ) {
    if (!nodeDrag || nodeDrag.deviceId !== node.device.id) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(nodeDrag.pointerId)) {
      event.currentTarget.releasePointerCapture(nodeDrag.pointerId);
    }
    setNodeDrag(null);
  }

  function selectDevice(deviceId: string, focus = false) {
    setSelection({ kind: "device", id: deviceId });
    setHoveredCableId(null);
    if (focus) focusDevice(deviceId);
  }

  function selectCable(cableId: string) {
    setSelection({ kind: "cable", id: cableId });
  }

  function focusDevice(deviceId: string) {
    const node = model.nodesByDeviceId[deviceId];
    const viewport = viewportRef.current;
    if (!node || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    const scale = Math.max(0.7, transform.scale);
    setTransform({
      scale,
      x: rect.width / 2 - (node.x + node.width / 2) * scale,
      y: rect.height / 2 - (node.y + node.height / 2) * scale,
    });
    setPulsedDeviceId(deviceId);
    window.setTimeout(() => setPulsedDeviceId(null), 1200);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchIndex((current) =>
        searchResults.length === 0 ? 0 : (current + 1) % searchResults.length,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchIndex((current) =>
        searchResults.length === 0
          ? 0
          : (current - 1 + searchResults.length) % searchResults.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = searchResults[searchIndex] ?? searchResults[0];
      if (result) activateSearchResult(result);
    }
  }

  function activateSearchResult(result: SearchResult) {
    if (result.kind === "device") {
      selectDevice(result.id, true);
    } else {
      selectCable(result.id);
      const cable = model.cableById[result.id];
      const deviceId = cable?.fromDevice?.id ?? cable?.toDevice?.id;
      if (deviceId) focusDevice(deviceId);
    }
  }

  function toggleTypeFilter(type: string) {
    setTypeFilters((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function selectTracePort(deviceId: string, portId: string) {
    const node = model.nodesByDeviceId[deviceId];
    if (!node) return;
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
      setSelection({ kind: "device", id: deviceId });
      focusDevice(deviceId);
      return;
    }
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
    setSelection({ kind: "device", id: deviceId });
    focusDevice(deviceId);
  }

  function handlePortClick(node: VisualizerNode, visualPort: VisualizerPort) {
    if (traceMode.enabled) {
      selectTracePort(node.device.id, visualPort.port.id);
      return;
    }
    if (visualPort.linkId) {
      selectCable(visualPort.linkId);
    } else {
      selectDevice(node.device.id);
    }
  }

  function cableIsVisible(cable: VisualizerCable) {
    if (
      cableType !== "all" &&
      (cable.link.cableType || "Unknown") !== cableType
    ) {
      return false;
    }
    return true;
  }

  function nodeMatchesFilter(node: VisualizerNode) {
    return typeFilters.size === 0 || typeFilters.has(node.effectiveDeviceType);
  }

  function cableMatchesFilter(cable: VisualizerCable) {
    return (
      typeFilters.size === 0 ||
      Boolean(
        cable.fromDevice &&
          typeFilters.has(
            model.effectiveDeviceTypeByDeviceId[cable.fromDevice.id] ??
              cable.fromDevice.deviceType,
          ),
      ) ||
      Boolean(
        cable.toDevice &&
          typeFilters.has(
            model.effectiveDeviceTypeByDeviceId[cable.toDevice.id] ??
              cable.toDevice.deviceType,
          ),
      )
    );
  }

  const visibleCables = model.cables.filter(cableIsVisible);
  const cableRouteGroups = [
    ...model.rackZone.sections.flatMap((section) => section.looseGroups),
    ...model.roomZone.groups,
  ];
  const visibleCableEntries = visibleCables
    .map((cable, index) => ({
      cable,
      path:
        cable.fromPoint && cable.toPoint
          ? visualizerCablePath(
              cable.fromPoint,
              cable.toPoint,
              index,
              cableLayout,
              {
                fromNode: cable.fromNode,
                toNode: cable.toNode,
                rackPanels: model.rackZone.racks,
                roomGroups: cableRouteGroups,
              },
            )
          : cable.path,
    }))
    .filter((entry): entry is { cable: VisualizerCable; path: string } =>
      Boolean(entry.path),
    );
  const activeNeighborIds = new Set(
    isolatedDeviceId
      ? (model.directNeighborsByDeviceId[isolatedDeviceId] ?? []).map(
          (neighbor) => neighbor.device.id,
        )
      : [],
  );

  if (loading) {
    return <VisualizerSkeleton />;
  }

  if (model.counts.devices === 0) {
    return <VisualizerNoDevices />;
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-4 xl:overflow-hidden xl:px-6 xl:py-5">
        <div className="flex min-h-[620px] min-w-0 flex-1 flex-col xl:min-h-0">
          <Card className="min-h-0 flex flex-1 flex-col">
            <CardHeader className="flex-col lg:flex-row">
              <CardTitle>
                <CardLabel>
                  {model.layoutMode === "pyramid"
                    ? "Pyramid view"
                    : "Grouped zones"}
                </CardLabel>
                <CardHeading>Physical and logical cable paths</CardHeading>
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-[var(--text-tertiary)]" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    className="rk-control h-8 w-72 pl-8 text-xs"
                    placeholder="Search host, IP, MAC, cable..."
                    aria-label="Search visualizer"
                  />
                  {query && searchResults.length > 0 && (
                    <div
                      data-visualizer-interactive="true"
                      className="absolute right-0 top-9 z-[80] w-80 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-2)] shadow-[var(--shadow-elev)]"
                    >
                      {searchResults.slice(0, 6).map((result, index) => (
                        <button
                          type="button"
                          key={`${result.kind}:${result.id}`}
                          onClick={() => activateSearchResult(result)}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs ${
                            index === searchIndex
                              ? "bg-[var(--accent-primary-soft)] text-[var(--text-primary)]"
                              : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {result.label}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-[var(--text-tertiary)]">
                              {result.meta}
                            </span>
                          </span>
                          <Badge
                            tone={result.kind === "device" ? "neutral" : "cyan"}
                          >
                            {result.kind}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  variant={healthOverlay ? "secondary" : "outline"}
                  size="sm"
                  onClick={onToggleHealth}
                >
                  1 Health
                </Button>
                <Button
                  variant={traceMode.enabled ? "secondary" : "outline"}
                  size="sm"
                  onClick={toggleTraceMode}
                >
                  2 Trace
                </Button>
              </div>
            </CardHeader>
            <CardBody className="min-h-0 flex-1 p-0">
              <div
                ref={viewportRef}
                className={`relative h-full touch-none select-none overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255_/_0.035)_1px,transparent_0)] [background-size:24px_24px] ${
                  traceMode.enabled
                    ? "cursor-crosshair"
                    : dragStart || nodeDrag
                      ? "cursor-grabbing"
                      : "cursor-grab"
                }`}
                onWheel={handleWheel}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerCancel={handleCanvasPointerUp}
              >
                {model.counts.cables === 0 && !noCableBannerDismissed && (
                  <NoCableBanner onDismiss={onDismissNoCableBanner} />
                )}
                {traceMode.enabled && <TraceBanner traceMode={traceMode} />}
                <div className="absolute left-4 top-4 z-[70] flex gap-2">
                  <Button variant="outline" size="sm" onClick={fitToViewport}>
                    <LocateFixed className="size-3.5" />
                    Fit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={resetView}>
                    Reset
                  </Button>
                </div>
                <div
                  className="absolute left-0 top-0 origin-top-left transition-transform duration-150 ease-out"
                  style={{
                    width: model.width,
                    height: model.height,
                    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  }}
                >
                  <svg
                    className="absolute inset-0 z-30"
                    width={model.width}
                    height={model.height}
                    role="img"
                    aria-label="Cable links between Rackpad devices"
                  >
                    <g pointerEvents="none">
                      {visibleCableEntries.map(({ cable, path }) => (
                        <CableSvg
                          key={cable.link.id}
                          cable={cable}
                          path={path}
                          active={isCableActive(cable)}
                          dimmed={isCableDimmed(cable)}
                          traceActive={Boolean(
                            traceMode.result?.cableIds.has(cable.link.id),
                          )}
                          healthOverlay={healthOverlay}
                        />
                      ))}
                    </g>
                    {visibleCableEntries.map(({ cable, path }) => (
                      <path
                        key={`${cable.link.id}-hit`}
                        data-visualizer-interactive="true"
                        d={path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={20}
                        pointerEvents="stroke"
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredCableId(cable.link.id)}
                        onMouseLeave={() => setHoveredCableId(null)}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectCable(cable.link.id);
                        }}
                      />
                    ))}
                  </svg>
                  <ZonePanels
                    model={model}
                    healthOverlay={healthOverlay}
                    onToggleRackRun={onToggleRackRun}
                    onToggleGroup={onToggleGroup}
                  />
                  <div className="absolute inset-0 z-50">
                    {model.nodes.map((node) => (
                      <DeviceCard
                        key={node.device.id}
                        node={node}
                        model={model}
                        healthOverlay={healthOverlay}
                        dimmed={isNodeDimmed(node)}
                        selected={
                          selection?.kind === "device" &&
                          selection.id === node.device.id
                        }
                        pulsed={pulsedDeviceId === node.device.id}
                        tracePortIds={traceMode.result?.portIds ?? null}
                        traceFirstPortId={
                          traceMode.enabled ? traceMode.firstPortId : null
                        }
                        onSelect={() => selectDevice(node.device.id)}
                        onPortClick={(port) => handlePortClick(node, port)}
                        readableLabels={readableLabels}
                        draggable={Boolean(
                          model.layoutMode === "pyramid" &&
                          onNodePositionChange,
                        )}
                        dragging={nodeDrag?.deviceId === node.device.id}
                        onPointerDown={(event) =>
                          handleNodePointerDown(event, node)
                        }
                        onPointerMove={(event) =>
                          handleNodePointerMove(event, node)
                        }
                        onPointerUp={(event) =>
                          handleNodePointerUp(event, node)
                        }
                      />
                    ))}
                  </div>
                  <Legend />
                </div>
              </div>
            </CardBody>
          </Card>
        </div>

        <aside
          className={`hidden h-full min-h-0 shrink-0 flex-col overflow-hidden xl:flex ${
            sidePanelCollapsed ? "w-12" : "w-[26rem]"
          }`}
        >
          <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-1)] px-2 py-2">
              {!sidePanelCollapsed && (
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                  Context
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidePanelCollapsed((value) => !value)}
                aria-label={
                  sidePanelCollapsed
                    ? "Expand visualizer side panel"
                    : "Collapse visualizer side panel"
                }
                className="ml-auto"
              >
                {sidePanelCollapsed ? (
                  <PanelRightOpen className="size-4" />
                ) : (
                  <PanelRightClose className="size-4" />
                )}
              </Button>
            </div>
            {!sidePanelCollapsed && (
              <VisualizerSidePanel
                model={model}
                visibleCables={visibleCables}
                cableLayout={cableLayout}
                onCableLayoutChange={onCableLayoutChange}
                rackFaceMode={rackFaceMode}
                onRackFaceModeChange={onRackFaceModeChange}
                rackScale={rackScale}
                onRackScaleChange={onRackScaleChange}
                shelfLayout={shelfLayout}
                onShelfLayoutChange={onShelfLayoutChange}
                looseDevicePlacement={looseDevicePlacement}
                onToggleLooseDevicePlacement={onToggleLooseDevicePlacement}
                includeRoomOnlySections={includeRoomOnlySections}
                onToggleRoomOnlySections={onToggleRoomOnlySections}
                readableLabels={readableLabels}
                onToggleReadableLabels={onToggleReadableLabels}
                onResetCustomNodePositions={onResetCustomNodePositions}
                hasCustomNodePositions={hasCustomNodePositions}
                typeFilters={typeFilters}
                setTypeFilters={setTypeFilters}
                toggleTypeFilter={toggleTypeFilter}
                selection={selection}
                selectedCable={selectedCable}
                selectedNode={selectedNode}
                traceMode={traceMode}
                traceResult={traceMode.result}
                onSelectDevice={(id) => selectDevice(id, true)}
                onSelectCable={selectCable}
                onTracePortSelect={selectTracePort}
                onClearTrace={() =>
                  setTraceMode({
                    enabled: true,
                    firstPortId: null,
                    result: null,
                    message: t("Select a device and port..."),
                  })
                }
              />
            )}
          </div>
        </aside>
      </div>
    </TooltipProvider>
  );

  function isCableActive(cable: VisualizerCable) {
    if (traceMode.result) return traceMode.result.cableIds.has(cable.link.id);
    if (selectedCableId) return cable.link.id === selectedCableId;
    if (isolatedDeviceId) {
      return (
        cable.fromDevice?.id === isolatedDeviceId ||
        cable.toDevice?.id === isolatedDeviceId
      );
    }
    return cableMatchesFilter(cable);
  }

  function isCableDimmed(cable: VisualizerCable) {
    if (traceMode.result) return !traceMode.result.cableIds.has(cable.link.id);
    if (selectedCableId) return cable.link.id !== selectedCableId;
    if (isolatedDeviceId) {
      return (
        cable.fromDevice?.id !== isolatedDeviceId &&
        cable.toDevice?.id !== isolatedDeviceId
      );
    }
    return !cableMatchesFilter(cable);
  }

  function isNodeDimmed(node: VisualizerNode) {
    if (traceMode.result) {
      return !node.ports.some((port) =>
        traceMode.result?.portIds.has(port.port.id),
      );
    }
    if (!nodeMatchesFilter(node)) return true;
    if (!isolatedDeviceId) return false;
    return (
      node.device.id !== isolatedDeviceId &&
      !activeNeighborIds.has(node.device.id)
    );
  }
}

function ZonePanels({
  model,
  healthOverlay,
  onToggleRackRun,
  onToggleGroup,
}: {
  model: VisualizerModel;
  healthOverlay: boolean;
  onToggleRackRun: (key: string) => void;
  onToggleGroup: (key: string) => void;
}) {
  if (model.layoutMode === "pyramid") {
    return (
      <div className="absolute inset-0 z-20">
        <div
          className="absolute rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[linear-gradient(180deg,rgb(255_255_255_/_0.028),transparent_20%),var(--surface-1)] shadow-[var(--shadow-card)]"
          style={{
            left: model.rackZone.x,
            top: model.rackZone.y,
            width: model.rackZone.width,
            height: model.rackZone.height - 40,
          }}
        >
          <ZoneHeader
            eyebrow="Pyramid view"
            title="Master and endpoint map"
            stats={`${model.counts.devices} devices | ${model.counts.cables} links`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20">
      <div
        className="absolute rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[linear-gradient(180deg,rgb(255_255_255_/_0.028),transparent_20%),var(--surface-1)] shadow-[var(--shadow-card)]"
        style={{
          left: model.rackZone.x,
          top: model.rackZone.y,
          width: model.rackZone.width,
          height: model.rackZone.height - 40,
        }}
      >
        <ZoneHeader
          eyebrow="Rack zone"
          title="Rack elevations"
          stats={`${model.rackZone.sections.length} rooms | ${model.rackZone.racks.length} racks`}
        />
        {model.rackZone.sections.length === 0 ? (
          <div className="absolute left-6 right-6 top-24 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] p-4 text-sm text-[var(--text-tertiary)]">
            Add racks or enable room-only sections to place room inventory in
            this zone.
          </div>
        ) : (
          <>
            {model.rackZone.sections.map((section) => (
              <RackRoomSectionView
                key={section.id}
                section={section}
                zoneX={model.rackZone.x}
                zoneY={model.rackZone.y}
              />
            ))}
            {model.rackZone.racks.map((rack) => (
              <RackPanelView
                key={rack.id}
                panel={rack}
                zoneX={model.rackZone.x}
                zoneY={model.rackZone.y}
                onToggleRackRun={onToggleRackRun}
              />
            ))}
            {model.rackZone.sections.flatMap((section) =>
              section.looseGroups.map((group) => (
                <RoomGroupView
                  key={group.id}
                  group={group}
                  zoneX={model.rackZone.x}
                  zoneY={model.rackZone.y}
                  onToggleGroup={onToggleGroup}
                />
              )),
            )}
          </>
        )}
      </div>
      <div
        className="absolute rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[linear-gradient(180deg,rgb(255_255_255_/_0.028),transparent_20%),var(--surface-1)] shadow-[var(--shadow-card)]"
        style={{
          left: model.roomZone.x,
          top: model.roomZone.y,
          width: model.roomZone.width,
          height: model.roomZone.height - 40,
        }}
      >
        <ZoneHeader
          eyebrow="Room / loose zone"
          title="Hosted, rooms, and loose inventory"
          stats={`${model.roomZone.stats.total} devices | ${model.roomZone.stats.online} online | ${model.roomZone.stats.down} down`}
        />
        {model.roomZone.groups.map((group) => (
          <RoomGroupView
            key={group.id}
            group={group}
            zoneX={model.roomZone.x}
            zoneY={model.roomZone.y}
            onToggleGroup={onToggleGroup}
          />
        ))}
      </div>
    </div>
  );
}

function ZoneHeader({
  eyebrow,
  title,
  stats,
}: {
  eyebrow: string;
  title: string;
  stats: string;
}) {
  return (
    <div className="absolute left-0 right-0 top-0 border-b border-[var(--border-subtle)] px-5 py-4">
      <div className="rk-kicker">{eyebrow}</div>
      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {title}
        </div>
        <Mono className="text-[10px] text-[var(--text-tertiary)]">{stats}</Mono>
      </div>
    </div>
  );
}

function RackRoomSectionView({
  section,
  zoneX,
  zoneY,
}: {
  section: RackRoomSection;
  zoneX: number;
  zoneY: number;
}) {
  return (
    <div
      className="absolute rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[rgb(0_0_0_/_0.10)]"
      style={{
        left: section.x - zoneX,
        top: section.y - zoneY,
        width: section.width,
        height: section.height,
      }}
    >
      <div className="border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="rk-kicker">Room</div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {section.name}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">
              {section.subtitle}
            </div>
          </div>
          <Mono className="shrink-0 text-[9px] text-[var(--text-tertiary)]">
            {section.stats.racks} racks | {section.stats.devices} devices |{" "}
            {section.stats.cables} links
          </Mono>
        </div>
      </div>
    </div>
  );
}

function RackPanelView({
  panel,
  zoneX,
  zoneY,
  onToggleRackRun,
}: {
  panel: RackPanel;
  zoneX: number;
  zoneY: number;
  onToggleRackRun: (key: string) => void;
}) {
  return (
    <div
      className="absolute rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[rgb(0_0_0_/_0.12)]"
      style={{
        left: panel.x - zoneX,
        top: panel.y - zoneY,
        width: panel.width,
        height: panel.height,
      }}
    >
      <div className="border-b border-[var(--border-subtle)] px-3 py-3">
        <div className="rk-kicker">{panel.rack.location ?? "Rack"}</div>
        <div className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">
          {panel.rack.name}
        </div>
        <Mono className="text-[10px] text-[var(--text-tertiary)]">
          {panel.stats.totalU}U | {panel.stats.mounted} mounted |{" "}
          {panel.stats.freeU}U free | {faceModeLabel(panel.faceMode)}
          {panel.stats.rearMounted > 0 && panel.faceMode === "both"
            ? ` | ${panel.stats.frontMounted}F/${panel.stats.rearMounted}R`
            : ""}
        </Mono>
      </div>
      <div
        className="absolute rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[rgb(0_0_0_/_0.10)]"
        style={{
          left: panel.bodyX - panel.x,
          top: panel.bodyY - panel.y,
          width: panel.bodyWidth,
          height: panel.bodyHeight,
        }}
      >
        {panel.stats.rearMounted > 0 && panel.faceMode === "both" && (
          <>
            <span className="pointer-events-none absolute left-3 top-1 z-10 rounded-[var(--radius-xs)] bg-[rgb(0_0_0_/_0.32)] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Front
            </span>
            <span className="pointer-events-none absolute right-3 top-1 z-10 rounded-[var(--radius-xs)] bg-[rgb(0_0_0_/_0.32)] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Rear
            </span>
          </>
        )}
        {panel.bands.map((band) => (
          <RackBandView
            key={band.id}
            band={band}
            onToggleRackRun={onToggleRackRun}
          />
        ))}
      </div>
      <div
        className="absolute rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(0_0_0_/_0.16)]"
        style={{
          left: 10,
          top: panel.bodyY - panel.y,
          width: 28,
          height: panel.bodyHeight,
        }}
      >
        {panel.bands.map((band) => (
          <div
            key={`${band.id}-rail`}
            className="flex items-center justify-center border-b border-[rgb(255_255_255_/_0.018)] font-mono text-[8px] text-[var(--text-muted)]"
            style={{ height: band.height }}
          >
            {band.collapsed ? "" : band.startU % 2 === 0 ? band.startU : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function RackBandView({
  band,
  onToggleRackRun,
}: {
  band: RackBand;
  onToggleRackRun: (key: string) => void;
}) {
  const label = band.collapsed ? band.label : "";
  return (
    <button
      type="button"
      data-visualizer-interactive="true"
      disabled={!band.expandKey}
      onClick={() => band.expandKey && onToggleRackRun(band.expandKey)}
      className={`absolute left-0 right-0 border-b border-[rgb(255_255_255_/_0.018)] text-center font-mono text-[8px] transition-colors ${
        band.collapsed
          ? "bg-[rgb(255_255_255_/_0.018)] text-[var(--text-tertiary)] hover:bg-[rgb(255_255_255_/_0.035)]"
          : band.occupied
            ? "bg-[rgb(255_255_255_/_0.028)]"
            : "bg-[rgb(255_255_255_/_0.01)]"
      }`}
      style={{ top: band.y, height: band.height }}
    >
      {label}
    </button>
  );
}

function RoomGroupView({
  group,
  zoneX,
  zoneY,
  onToggleGroup,
}: {
  group: RoomGroup;
  zoneX: number;
  zoneY: number;
  onToggleGroup: (key: string) => void;
}) {
  return (
    <button
      type="button"
      data-visualizer-interactive="true"
      onClick={() => onToggleGroup(group.id)}
      className="absolute z-[45] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-2)_82%,black)] px-3 py-2 text-left shadow-[0_8px_18px_rgb(0_0_0_/_0.16)] transition-colors hover:border-[var(--border-strong)]"
      style={{
        left: group.x - zoneX,
        top: group.y - zoneY,
        width: group.width,
        borderLeftColor: group.color,
        borderLeftWidth: 3,
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
            {group.name}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">
            {group.subtitle}
          </div>
        </div>
        <Mono className="text-[9px] text-[var(--text-tertiary)]">
          {group.total} | {group.online} up | {group.down} down
        </Mono>
      </div>
    </button>
  );
}

function DeviceCard({
  node,
  model,
  healthOverlay,
  dimmed,
  selected,
  pulsed,
  tracePortIds,
  traceFirstPortId,
  onSelect,
  onPortClick,
  readableLabels,
  draggable,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  node: VisualizerNode;
  model: VisualizerModel;
  healthOverlay: boolean;
  dimmed: boolean;
  selected: boolean;
  pulsed: boolean;
  tracePortIds: Set<string> | null;
  traceFirstPortId: string | null;
  onSelect: () => void;
  onPortClick: (port: VisualizerPort) => void;
  readableLabels: boolean;
  draggable: boolean;
  dragging: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const stripe = nodeStripeColor(node, healthOverlay);
  const compactRackNode = Boolean(
    node.rackId && node.height < (readableLabels ? 30 : 34),
  );
  const showSecondaryLabel = readableLabels
    ? node.height >= 48
    : !compactRackNode;
  const readableNameStyle = readableLabels
    ? {
        display: "-webkit-box",
        WebkitBoxOrient: "vertical" as const,
        WebkitLineClamp: node.height >= 58 ? 2 : 1,
        overflow: "hidden",
      }
    : undefined;
  return (
    <div
      data-visualizer-interactive="true"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`absolute z-50 overflow-hidden rounded-[var(--radius-md)] border bg-[var(--surface-2)] text-left shadow-[0_10px_24px_rgb(0_0_0_/_0.18)] ${
        dragging
          ? "transition-none"
          : "transition-[opacity,background-color,border-color,box-shadow,transform] duration-150"
      } ${
        readableLabels
          ? "px-3 py-2.5 pr-14"
          : compactRackNode
            ? "px-2 py-1 pr-10"
            : "px-2.5 py-2 pr-12"
      } ${
        selected
          ? "border-[var(--accent-primary-border)] shadow-[var(--shadow-selected)]"
          : "border-[var(--border-default)] hover:-translate-y-px hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
      } ${draggable ? "cursor-move" : ""} ${dragging ? "z-[65] scale-[1.015] border-[var(--accent-primary-border)] shadow-[var(--shadow-selected)]" : ""} ${pulsed ? "visualizer-pulse" : ""}`}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        opacity: dimmed ? 0.4 : 1,
      }}
    >
      <span
        className="pointer-events-none absolute inset-y-1 left-1 w-0.5 rounded-full"
        style={{ background: stripe }}
      />
      <div className="flex min-w-0 items-center gap-2 pl-1.5">
        <span className="shrink-0" style={{ color: node.typeColor }}>
          <DeviceTypeIcon type={node.device.deviceType} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={`font-semibold text-[var(--text-primary)] ${
              readableLabels ? "text-[13px] leading-[1.15]" : "truncate text-xs"
            }`}
            style={readableNameStyle}
            title={node.device.hostname}
          >
            {node.device.hostname}
          </div>
          {showSecondaryLabel && (
            <div className="truncate font-mono text-[9px] text-[var(--text-tertiary)]">
              {formatDeviceAddress(
                {
                  managementIp: node.device.managementIp,
                  macAddress: node.macAddress,
                },
                typeLabel(node.device.deviceType),
              )}
            </div>
          )}
        </div>
        <span
          className={`size-2 rounded-full ${node.health === "offline" ? "animate-pulse-slow" : ""}`}
          style={{
            background: healthDotColor(node.health),
            boxShadow:
              node.health === "online"
                ? "0 0 10px var(--success-soft)"
                : undefined,
          }}
        />
      </div>
      {node.ports.map((visualPort) => (
        <PortSquare
          key={visualPort.port.id}
          visualPort={visualPort}
          model={model}
          node={node}
          active={
            tracePortIds?.has(visualPort.port.id) ||
            traceFirstPortId === visualPort.port.id
          }
          onClick={() => onPortClick(visualPort)}
        />
      ))}
    </div>
  );
}

function PortSquare({
  visualPort,
  model,
  node,
  active,
  onClick,
}: {
  visualPort: VisualizerPort;
  model: VisualizerModel;
  node: VisualizerNode;
  active: boolean | null;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const isSlot =
    visualPort.port.kind === "sfp" ||
    visualPort.port.kind === "sfp_plus" ||
    visualPort.port.kind === "qsfp" ||
    visualPort.port.kind === "fiber";
  const fill = visualPort.linked
    ? (visualPort.color ?? "var(--accent-primary)")
    : "rgb(255 255 255 / 0.05)";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-visualizer-interactive="true"
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className="absolute rounded-[2px] transition-[background-color,border-color,box-shadow,opacity] duration-150"
          style={{
            left: visualPort.x - node.x,
            top: visualPort.y - node.y,
            width: visualPort.width,
            height: visualPort.height,
            background: fill,
            border: `1px solid ${
              active
                ? "var(--accent-primary)"
                : visualPort.linked
                  ? (visualPort.color ?? "var(--accent-primary)")
                  : "rgb(255 255 255 / 0.22)"
            }`,
            boxShadow: active ? "0 0 0 2px rgb(242 157 56 / 0.22)" : undefined,
          }}
          aria-label={portTooltip(visualPort, model, t)}
        >
          {isSlot && (
            <span className="absolute left-0.5 right-0.5 top-1/2 h-px -translate-y-1/2 bg-[rgb(0_0_0_/_0.35)]" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 whitespace-pre-line">
        {portTooltip(visualPort, model, t)}
      </TooltipContent>
    </Tooltip>
  );
}

function CableSvg({
  cable,
  path,
  active,
  dimmed,
  traceActive,
  healthOverlay,
}: {
  cable: VisualizerCable;
  path: string;
  active: boolean;
  dimmed: boolean;
  traceActive: boolean;
  healthOverlay: boolean;
}) {
  if (!path || !cable.fromPoint || !cable.toPoint) return null;
  const downPair =
    healthOverlay &&
    cable.fromNode?.health === "offline" &&
    cable.toNode?.health === "offline";
  const color = downPair
    ? "var(--danger)"
    : traceActive
      ? "var(--accent-primary)"
      : cable.color;
  const needsContrast = cableNeedsContrastOutline(color);
  const opacity = traceActive ? 1 : dimmed ? 0.06 : active ? 1 : 0.5;
  const strokeWidth = traceActive ? 5.5 : active ? 5 : cable.up ? 2.6 : 2;
  // Firefox: round caps on dashed strokes balloon each dash segment; use butt for dashes only.
  const strokeDasharray = cable.unknown
    ? "7 6"
    : cable.bothOnline
      ? "12 10"
      : undefined;
  const strokeLinecap = strokeDasharray ? "butt" : "round";
  return (
    <g>
      {(active || traceActive) && (
        <path
          d={path}
          fill="none"
          stroke="var(--bg-page)"
          strokeWidth={strokeWidth + 6}
          strokeOpacity={0.82}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {needsContrast && (
        <path
          d={path}
          fill="none"
          stroke="var(--text-primary)"
          strokeWidth={strokeWidth + 3}
          strokeOpacity={dimmed ? 0.08 : 0.48}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeOpacity={opacity}
        strokeLinecap={strokeLinecap}
        strokeLinejoin="round"
        strokeDasharray={strokeDasharray}
        className={
          cable.bothOnline && !cable.unknown
            ? "visualizer-cable-online"
            : active || traceActive
              ? "visualizer-cable-active"
              : undefined
        }
        style={{ transition: "opacity 150ms ease, stroke-width 150ms ease" }}
      />
      {[cable.fromPoint, cable.toPoint].map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={active || traceActive ? 6.5 : 5}
          fill={color}
          fillOpacity={opacity}
          stroke={needsContrast ? "var(--text-primary)" : "var(--bg-page)"}
          strokeWidth={needsContrast ? 1.75 : 1}
        />
      ))}
    </g>
  );
}

function cableNeedsContrastOutline(color: string) {
  const value = color.trim().toLowerCase();
  return (
    value === "black" ||
    value === "#000" ||
    value === "#000000" ||
    value === "white" ||
    value === "#fff" ||
    value === "#ffffff"
  );
}

function VisualizerLayoutPanel({
  model,
  cableLayout,
  onCableLayoutChange,
  rackFaceMode,
  onRackFaceModeChange,
  rackScale,
  onRackScaleChange,
  shelfLayout,
  onShelfLayoutChange,
  looseDevicePlacement,
  onToggleLooseDevicePlacement,
  includeRoomOnlySections,
  onToggleRoomOnlySections,
  readableLabels,
  onToggleReadableLabels,
  onResetCustomNodePositions,
  hasCustomNodePositions,
}: {
  model: VisualizerModel;
  cableLayout: VisualizerCableLayout;
  onCableLayoutChange: (layout: VisualizerCableLayout) => void;
  rackFaceMode: VisualizerRackFaceMode;
  onRackFaceModeChange: (mode: VisualizerRackFaceMode) => void;
  rackScale: VisualizerRackScale;
  onRackScaleChange: (scale: VisualizerRackScale) => void;
  shelfLayout: VisualizerShelfLayout;
  onShelfLayoutChange: (layout: VisualizerShelfLayout) => void;
  looseDevicePlacement: VisualizerLooseDevicePlacement;
  onToggleLooseDevicePlacement: () => void;
  includeRoomOnlySections: boolean;
  onToggleRoomOnlySections: () => void;
  readableLabels: boolean;
  onToggleReadableLabels: () => void;
  onResetCustomNodePositions: () => void;
  hasCustomNodePositions: boolean;
}) {
  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle>
          <CardLabel>Layout</CardLabel>
          <CardHeading>View and routing</CardHeading>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <LayoutField label="Cable routing">
            <select
              value={cableLayout}
              onChange={(event) =>
                onCableLayoutChange(event.target.value as VisualizerCableLayout)
              }
              className="rk-control h-8 w-full px-2 text-xs text-[var(--text-primary)]"
              aria-label="Cable route layout"
            >
              <option value="auto">Auto cables</option>
              <option value="bundled">Bundled harness</option>
              <option value="concave">Concave</option>
              <option value="convex">Convex</option>
              <option value="straight">Straight</option>
            </select>
          </LayoutField>
          <LayoutField label="Labels">
            <SidePanelToggle
              checked={readableLabels}
              label="Readable"
              ariaLabel="Use wider visualizer cards with larger labels"
              onChange={onToggleReadableLabels}
            />
          </LayoutField>
        </div>
        {model.layoutMode === "grouped" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <LayoutField label="Rack face">
                <select
                  value={rackFaceMode}
                  onChange={(event) =>
                    onRackFaceModeChange(
                      event.target.value as VisualizerRackFaceMode,
                    )
                  }
                  className="rk-control h-8 w-full px-2 text-xs text-[var(--text-primary)]"
                  aria-label="Rack face"
                >
                  <option value="front">Front</option>
                  <option value="rear">Rear</option>
                  <option value="both">Both</option>
                </select>
              </LayoutField>
              <LayoutField label="Rack width">
                <select
                  value={rackScale}
                  onChange={(event) =>
                    onRackScaleChange(event.target.value as VisualizerRackScale)
                  }
                  className="rk-control h-8 w-full px-2 text-xs text-[var(--text-primary)]"
                  aria-label="Rack visual width"
                >
                  <option value="compact">Compact</option>
                  <option value="normal">Normal</option>
                  <option value="wide">Wide</option>
                  <option value="xwide">Extra wide</option>
                </select>
              </LayoutField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <LayoutField label="Shelf layout">
                <select
                  value={shelfLayout}
                  onChange={(event) =>
                    onShelfLayoutChange(
                      event.target.value as VisualizerShelfLayout,
                    )
                  }
                  className="rk-control h-8 w-full px-2 text-xs text-[var(--text-primary)]"
                  aria-label="Shelf device layout"
                >
                  <option value="auto">Auto</option>
                  <option value="stacked">Stacked</option>
                  <option value="expanded">Expanded</option>
                </select>
              </LayoutField>
              <LayoutField label="Loose devices">
                <SidePanelToggle
                  checked={looseDevicePlacement === "below-racks"}
                  label="Below racks"
                  ariaLabel="Place loose devices below racks"
                  onChange={onToggleLooseDevicePlacement}
                />
              </LayoutField>
            </div>
            <SidePanelToggle
              checked={includeRoomOnlySections}
              label="No rack required"
              ariaLabel="Place rooms without racks in rack zone"
              onChange={onToggleRoomOnlySections}
            />
          </>
        )}
        {model.layoutMode === "pyramid" && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onResetCustomNodePositions}
            disabled={!hasCustomNodePositions}
          >
            Reset node positions
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

function LayoutField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="rk-kicker">{label}</span>
      {children}
    </label>
  );
}

function SidePanelToggle({
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
      className={`flex h-8 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 text-xs font-medium transition-colors ${
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
      <span className="truncate">{label}</span>
    </label>
  );
}

function VisualizerSidePanel({
  model,
  visibleCables,
  cableLayout,
  onCableLayoutChange,
  rackFaceMode,
  onRackFaceModeChange,
  rackScale,
  onRackScaleChange,
  shelfLayout,
  onShelfLayoutChange,
  looseDevicePlacement,
  onToggleLooseDevicePlacement,
  includeRoomOnlySections,
  onToggleRoomOnlySections,
  readableLabels,
  onToggleReadableLabels,
  onResetCustomNodePositions,
  hasCustomNodePositions,
  typeFilters,
  setTypeFilters,
  toggleTypeFilter,
  selection,
  selectedCable,
  selectedNode,
  traceMode,
  traceResult,
  onSelectDevice,
  onSelectCable,
  onTracePortSelect,
  onClearTrace,
}: {
  model: VisualizerModel;
  visibleCables: VisualizerCable[];
  cableLayout: VisualizerCableLayout;
  onCableLayoutChange: (layout: VisualizerCableLayout) => void;
  rackFaceMode: VisualizerRackFaceMode;
  onRackFaceModeChange: (mode: VisualizerRackFaceMode) => void;
  rackScale: VisualizerRackScale;
  onRackScaleChange: (scale: VisualizerRackScale) => void;
  shelfLayout: VisualizerShelfLayout;
  onShelfLayoutChange: (layout: VisualizerShelfLayout) => void;
  looseDevicePlacement: VisualizerLooseDevicePlacement;
  onToggleLooseDevicePlacement: () => void;
  includeRoomOnlySections: boolean;
  onToggleRoomOnlySections: () => void;
  readableLabels: boolean;
  onToggleReadableLabels: () => void;
  onResetCustomNodePositions: () => void;
  hasCustomNodePositions: boolean;
  typeFilters: Set<string>;
  setTypeFilters: Dispatch<SetStateAction<Set<string>>>;
  toggleTypeFilter: (type: string) => void;
  selection: VisualizerSelection;
  selectedCable: VisualizerCable | null;
  selectedNode: VisualizerNode | null;
  traceMode: TraceModeState;
  traceResult: TraceResult | null;
  onSelectDevice: (id: string) => void;
  onSelectCable: (id: string) => void;
  onTracePortSelect: (deviceId: string, portId: string) => void;
  onClearTrace: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      <VisualizerLayoutPanel
        model={model}
        cableLayout={cableLayout}
        onCableLayoutChange={onCableLayoutChange}
        rackFaceMode={rackFaceMode}
        onRackFaceModeChange={onRackFaceModeChange}
        rackScale={rackScale}
        onRackScaleChange={onRackScaleChange}
        shelfLayout={shelfLayout}
        onShelfLayoutChange={onShelfLayoutChange}
        looseDevicePlacement={looseDevicePlacement}
        onToggleLooseDevicePlacement={onToggleLooseDevicePlacement}
        includeRoomOnlySections={includeRoomOnlySections}
        onToggleRoomOnlySections={onToggleRoomOnlySections}
        readableLabels={readableLabels}
        onToggleReadableLabels={onToggleReadableLabels}
        onResetCustomNodePositions={onResetCustomNodePositions}
        hasCustomNodePositions={hasCustomNodePositions}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <VisualizerRailStat
            icon={Server}
            label="Devices"
            value={model.counts.devices}
            hint={`${model.rackZone.racks.length} racks`}
          />
          <VisualizerRailStat
            icon={Cable}
            label="Cables"
            value={visibleCables.length}
            hint="shown"
          />
        </div>
        <div className="space-y-2">
          <VisualizerRailStat
            icon={Route}
            label="Cross-zone"
            value={model.counts.crossZone}
            hint="links"
          />
          <VisualizerRailStat
            icon={Network}
            label="Patch panel"
            value={model.counts.patchPanel}
            hint="handoffs"
          />
        </div>
      </div>

      {traceMode.enabled && (
        <TracePicker
          model={model}
          traceMode={traceMode}
          onTracePortSelect={onTracePortSelect}
          onClearTrace={onClearTrace}
        />
      )}
      {traceMode.enabled && traceResult && (
        <TraceSummary model={model} result={traceResult} />
      )}

      <Card className="shrink-0">
        <CardHeader>
          <CardTitle>
            <CardLabel>Filters</CardLabel>
            <CardHeading>Device types</CardHeading>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
          <TypeChip
            active={typeFilters.size === 0}
            label={`All ${model.counts.devices}`}
            onClick={() => setTypeFilters(new Set())}
          />
          {model.deviceTypes.map((entry) => (
            <TypeChip
              key={entry.type}
              active={typeFilters.has(entry.type)}
              label={`${entry.label} ${entry.count}`}
              onClick={() => toggleTypeFilter(entry.type)}
            />
          ))}
        </CardBody>
      </Card>

      <div
        data-visualizer-scrollable="true"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
      >
        <Inspector
          model={model}
          selection={selection}
          selectedCable={selectedCable}
          selectedNode={selectedNode}
          onSelectDevice={onSelectDevice}
          onSelectCable={onSelectCable}
        />
      </div>
    </div>
  );
}

function TracePicker({
  model,
  traceMode,
  onTracePortSelect,
  onClearTrace,
}: {
  model: VisualizerModel;
  traceMode: TraceModeState;
  onTracePortSelect: (deviceId: string, portId: string) => void;
  onClearTrace: () => void;
}) {
  const { t } = useI18n();
  const traceDevices = useMemo(
    () =>
      model.nodes
        .filter((node) => (model.portsByDeviceId[node.device.id] ?? []).length > 0)
        .sort((a, b) => a.device.hostname.localeCompare(b.device.hostname)),
    [model],
  );
  const [deviceId, setDeviceId] = useState(traceDevices[0]?.device.id ?? "");
  const devicePorts = deviceId ? (model.portsByDeviceId[deviceId] ?? []) : [];
  const [portId, setPortId] = useState(devicePorts[0]?.id ?? "");

  useEffect(() => {
    if (traceDevices.some((node) => node.device.id === deviceId)) return;
    setDeviceId(traceDevices[0]?.device.id ?? "");
  }, [deviceId, traceDevices]);

  useEffect(() => {
    if (devicePorts.some((port) => port.id === portId)) return;
    setPortId(devicePorts[0]?.id ?? "");
  }, [devicePorts, portId]);

  const firstPort = traceMode.firstPortId
    ? model.portById[traceMode.firstPortId]
    : undefined;
  const firstDevice = firstPort ? model.deviceById[firstPort.deviceId] : undefined;

  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle>
          <CardLabel>{t("Trace")}</CardLabel>
          <CardHeading>{t("Device and port")}</CardHeading>
        </CardTitle>
        {traceMode.firstPortId && (
          <Button variant="ghost" size="sm" onClick={onClearTrace}>
            {t("Reset")}
          </Button>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        {firstPort && firstDevice && (
          <div className="rounded-[var(--radius-sm)] border border-[var(--accent-primary-border)] bg-[var(--accent-primary)]/8 px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              {t("Start port")}
            </div>
            <div className="mt-1 truncate text-xs text-[var(--text-primary)]">
              {firstDevice.hostname} / {firstPort.name}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <LayoutField label={t("Device")}>
            <select
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              className="rk-control h-8 w-full px-2 text-xs text-[var(--text-primary)]"
            >
              {traceDevices.map((node) => (
                <option key={node.device.id} value={node.device.id}>
                  {node.device.hostname}
                </option>
              ))}
            </select>
          </LayoutField>
          <LayoutField label={t("Port")}>
            <select
              value={portId}
              onChange={(event) => setPortId(event.target.value)}
              className="rk-control h-8 w-full px-2 text-xs text-[var(--text-primary)]"
            >
              {devicePorts.map((port) => (
                <option key={port.id} value={port.id}>
                  {formatPortEndpointLabel(port, model.deviceById[port.deviceId])}
                </option>
              ))}
            </select>
          </LayoutField>
        </div>
        <Button
          size="sm"
          className="w-full"
          disabled={!deviceId || !portId}
          onClick={() => onTracePortSelect(deviceId, portId)}
        >
          {traceMode.firstPortId ? t("Trace to port") : t("Set start port")}
        </Button>
        {traceMode.message && (
          <div className="text-xs text-[var(--text-tertiary)]">
            {traceMode.message}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Inspector({
  model,
  selection,
  selectedCable,
  selectedNode,
  onSelectDevice,
  onSelectCable,
}: {
  model: VisualizerModel;
  selection: VisualizerSelection;
  selectedCable: VisualizerCable | null;
  selectedNode: VisualizerNode | null;
  onSelectDevice: (id: string) => void;
  onSelectCable: (id: string) => void;
}) {
  const { t } = useI18n();
  const neighbors = selectedNode
    ? (model.directNeighborsByDeviceId[selectedNode.device.id] ?? [])
    : [];
  return (
    <>
      <Card className="shrink-0">
        <CardHeader>
          <CardTitle>
            <CardLabel>Inspector</CardLabel>
            <CardHeading>
              {selectedNode
                ? selectedNode.device.hostname
                : selectedCable
                  ? "Selected cable"
                  : "Select a link"}
            </CardHeading>
          </CardTitle>
          {selectedNode && (
            <Badge tone={healthBadgeTone(selectedNode.health)}>
              {selectedNode.health}
            </Badge>
          )}
          {selectedCable && (
            <Badge>{selectedCable.link.cableType ?? "Cable"}</Badge>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          {!selection && (
            <EmptyState
              icon={Network}
              title={t("No item selected")}
              description={t(
                "Click a device, cable, or port to inspect its topology context.",
              )}
            />
          )}
          {selectedNode && (
            <DeviceInspector
              node={selectedNode}
              neighbors={neighbors}
              onSelectCable={onSelectCable}
            />
          )}
          {selectedCable && !selectedNode && (
            <CableInspector
              cable={selectedCable}
              onSelectDevice={onSelectDevice}
            />
          )}
        </CardBody>
      </Card>

      <Card className="flex min-h-64 flex-col">
        <CardHeader>
          <CardTitle>
            <CardLabel>Visible links</CardLabel>
            <CardHeading>{model.cables.length} cables</CardHeading>
          </CardTitle>
        </CardHeader>
        <CardBody
          data-visualizer-scrollable="true"
          className="max-h-80 min-h-0 space-y-2 overflow-y-auto"
        >
          {model.cables.map((cable) => (
            <button
              key={cable.link.id}
              type="button"
              onClick={() => onSelectCable(cable.link.id)}
              className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-2.5 py-2 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
            >
              <div className="min-w-0">
                <div className="truncate text-xs text-[var(--text-primary)]">
                  {cable.fromDevice?.hostname ?? "Unknown"} to{" "}
                  {cable.toDevice?.hostname ?? "Unknown"}
                </div>
                <Mono className="text-[10px] text-[var(--text-tertiary)]">
                  {cable.fromPort?.name ?? "?"} to {cable.toPort?.name ?? "?"}
                </Mono>
              </div>
              <span
                className="size-3 rounded-sm border border-[var(--border-subtle)]"
                style={{ background: cable.color }}
              />
            </button>
          ))}
        </CardBody>
      </Card>
    </>
  );
}

function DeviceInspector({
  node,
  neighbors,
  onSelectCable,
}: {
  node: VisualizerNode;
  neighbors: Array<{
    device: VisualizerModel["deviceById"][string];
    port: Port;
    peerPort: Port;
    link: VisualizerCable["link"];
    color: string;
  }>;
  onSelectCable: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <Button size="sm" asChild>
        <Link to={`/devices/${node.device.id}`}>
          <ExternalLink className="size-3.5" />
          Open device
        </Link>
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <InfoBox label="IP" value={node.device.managementIp} mono />
        <InfoBox label="MAC" value={node.macAddress} mono />
        <InfoBox label="Type" value={typeLabel(node.device.deviceType)} />
        <InfoBox label="Placement" value={placementLabel(node)} />
        <InfoBox
          label="Ports"
          value={`${node.portSummary.linked}/${node.portSummary.total} linked`}
        />
        <InfoBox
          label="Vendor"
          value={node.vendor ?? node.device.manufacturer}
        />
      </div>
      <div>
        <div className="rk-kicker mb-2">Direct connections</div>
        <div
          data-visualizer-scrollable="true"
          className="max-h-80 space-y-2 overflow-y-auto pr-1"
        >
          {neighbors.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] p-3 text-xs text-[var(--text-tertiary)]">
              No documented cable neighbors.
            </div>
          ) : (
            neighbors.map((neighbor) => (
              <div
                key={`${neighbor.link.id}:${neighbor.device.id}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] px-3 py-2 hover:bg-[var(--surface-hover)]"
              >
                <button
                  type="button"
                  onClick={() => onSelectCable(neighbor.link.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs font-medium text-[var(--text-primary)]">
                    {neighbor.device.hostname}
                  </span>
                  <Mono className="text-[10px] text-[var(--text-tertiary)]">
                    {neighbor.port.name} to {neighbor.peerPort.name}
                    {neighbor.link.cableLength
                      ? ` | ${neighbor.link.cableLength}`
                      : ""}
                  </Mono>
                </button>
                <Link
                  to={`/devices/${neighbor.device.id}`}
                  className="shrink-0 rounded-[var(--radius-xs)] border border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                >
                  Open
                </Link>
                <span
                  className="size-3 shrink-0 rounded-full border border-[var(--border-subtle)]"
                  style={{ background: neighbor.color }}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function CableInspector({
  cable,
  onSelectDevice,
}: {
  cable: VisualizerCable;
  onSelectDevice: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      <EndpointButton
        label="From"
        device={cable.fromDevice}
        port={cable.fromPort}
        onClick={() => cable.fromDevice && onSelectDevice(cable.fromDevice.id)}
      />
      <EndpointButton
        label="To"
        device={cable.toDevice}
        port={cable.toPort}
        onClick={() => cable.toDevice && onSelectDevice(cable.toDevice.id)}
      />
      <div className="grid grid-cols-2 gap-2">
        {cable.fromDevice && (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/devices/${cable.fromDevice.id}`}>Open from</Link>
          </Button>
        )}
        {cable.toDevice && (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/devices/${cable.toDevice.id}`}>Open to</Link>
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <InfoBox label="Type" value={cable.link.cableType} />
        <InfoBox label="Length" value={cable.link.cableLength} />
        <InfoBox label="Color" value={cable.link.color} />
        <InfoBox label="Notes" value={cable.link.notes} />
      </div>
    </div>
  );
}

function TraceSummary({
  model,
  result,
}: {
  model: VisualizerModel;
  result: TraceResult;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="rk-kicker">{t("Trace hops")}</div>
          <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
            {t("{count} hops", { count: result.segments.length })} |{" "}
            {result.totalCableLengthLabel}
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {result.segments.map((segment, index) => {
          const fromDevice = model.deviceById[segment.fromPort.deviceId];
          const toDevice = model.deviceById[segment.toPort.deviceId];
          const isLastHop = index === result.segments.length - 1;
          const fromLabel = `${fromDevice?.hostname ?? t("Unknown")} ${
            segment.fromPort.name
          }`;
          const toLabel = `${toDevice?.hostname ?? t("Unknown")} ${
            segment.toPort.name
          }`;
          return (
            <div
              key={index}
              className="rounded-[var(--radius-sm)] bg-[rgb(0_0_0_/_0.18)] px-2.5 py-2 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-[var(--text-primary)]">
                  <span className="font-semibold">#{index + 1}</span>{" "}
                  {t("{from} to {to}", { from: fromLabel, to: toLabel })}
                </div>
                {isLastHop && <Badge tone="accent">{t("Last hop")}</Badge>}
              </div>
              <Mono className="mt-1 block text-[10px] text-[var(--text-tertiary)]">
                {segment.kind}
                {segment.length ? ` | ${segment.length}` : ""}
              </Mono>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EndpointButton({
  label,
  device,
  port,
  onClick,
}: {
  label: string;
  device?: VisualizerCable["fromDevice"];
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

function InfoBox({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[rgb(255_255_255_/_0.018)] p-2">
      <div className="rk-kicker">{label}</div>
      <div
        className={`mt-1 break-words text-xs text-[var(--text-primary)] ${mono ? "font-mono" : ""}`}
      >
        {value || "-"}
      </div>
    </div>
  );
}

function VisualizerRailStat({
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
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-1)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="rk-kicker truncate">{label}</div>
          <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
            {value}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">
            {hint}
          </div>
        </div>
        <div className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--accent-secondary-border)] bg-[var(--accent-secondary-soft)] text-[var(--accent-secondary)]">
          <Icon className="size-3.5" />
        </div>
      </div>
    </div>
  );
}

function TypeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[var(--radius-sm)] border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)] text-[var(--accent-primary)]"
          : "border-[var(--border-default)] bg-[rgb(255_255_255_/_0.018)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
      }`}
    >
      {label}
    </button>
  );
}

function NoCableBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="absolute left-24 right-24 top-4 z-[80] flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--accent-primary-border)] bg-[color-mix(in_srgb,var(--surface-2)_92%,black)] px-4 py-3 shadow-[var(--shadow-card)]">
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          No cables documented yet.
        </div>
        <div className="text-xs text-[var(--text-tertiary)]">
          Patch a cable in Cables to see connections here.
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        aria-label="Dismiss no cables banner"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

function TraceBanner({ traceMode }: { traceMode: TraceModeState }) {
  const { t } = useI18n();
  return (
    <div className="absolute left-1/2 top-4 z-[85] -translate-x-1/2 rounded-full border border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)] px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-[var(--accent-primary)]">
      {traceMode.message ?? t("Click first port...")}
    </div>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-4 right-4 z-[60] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-1)_82%,transparent)] px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-[var(--text-tertiary)]">
      <span className="text-[var(--success)]">●</span> online{" "}
      <span className="text-[var(--neutral)]">●</span> unknown{" "}
      <span className="text-[var(--danger)]">●</span> down{" "}
      <span className="text-[var(--accent-secondary)]">━</span> linked{" "}
      <span className="text-[var(--text-tertiary)]">┄</span> unknown
    </div>
  );
}

function VisualizerSkeleton() {
  return (
    <div className="flex flex-1 gap-4 overflow-hidden px-6 py-5">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rk-skeleton h-24 rounded-[var(--radius-lg)] border border-[var(--border-default)]"
            />
          ))}
        </div>
        <div className="rk-skeleton min-h-0 flex-1 rounded-[var(--radius-lg)] border border-[var(--border-default)]" />
      </div>
      <div className="hidden w-96 shrink-0 xl:block">
        <div className="rk-skeleton h-full rounded-[var(--radius-lg)] border border-[var(--border-default)]" />
      </div>
    </div>
  );
}

function VisualizerNoDevices() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-5">
      <Card className="max-w-xl">
        <CardBody className="p-8 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-[var(--radius-lg)] border border-[var(--accent-secondary-border)] bg-[var(--accent-secondary-soft)] text-[var(--accent-secondary)]">
            <Network className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
            Add racks, devices, and cables to see your topology
          </h2>
          <p className="mt-2 text-sm text-[var(--text-tertiary)]">
            The Visualizer is generated from Rackpad inventory, so it becomes
            useful as soon as your first devices and patch cables are
            documented.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Button asChild>
              <Link to="/racks">Go to Racks</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/cables">Go to Cables</Link>
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function healthDotColor(health: VisualizerNode["health"]) {
  return {
    online: "var(--success)",
    warning: "var(--warning)",
    offline: "var(--danger)",
    unknown: "var(--neutral)",
  }[health];
}

function healthBadgeTone(health: VisualizerNode["health"]) {
  if (health === "online") return "ok";
  if (health === "offline") return "err";
  if (health === "warning") return "warn";
  return "neutral";
}

function placementLabel(node: VisualizerNode) {
  if (node.rackId) {
    const rack = node.rackName ?? "Rack";
    const prefix = node.roomName ? `${node.roomName} | ${rack}` : rack;
    return `${prefix} | ${node.device.startU ? `U${node.device.startU}` : "rack"}${
      node.device.heightU ? ` / ${node.device.heightU}U` : ""
    }`;
  }
  if (node.roomName)
    return node.device.placement
      ? `${node.roomName} | ${node.device.placement}`
      : node.roomName;
  if (node.device.placement) return node.device.placement;
  return "Room / loose";
}

function faceModeLabel(mode: RackPanel["faceMode"]) {
  if (mode === "both") return "front + rear";
  return mode;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
