import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Box,
  Cable,
  ChevronDown,
  ChevronUp,
  Download,
  Focus,
  HeartPulse,
  Minus,
  Move,
  Plus,
  Redo2,
  RotateCw,
  Search,
  Undo2,
} from "lucide-react";
import { useI18n } from "@/i18n";
import {
  applyRackStudioAction,
  createCable,
  deleteCable,
  updateCable,
} from "@/lib/store";
import { ApiError } from "@/lib/api";
import {
  buildRackStudioCableRoutes,
  cableCategoryForPorts,
  connectorPairIsUsual,
  defaultCableColor,
  defaultCableMetadata,
  portSupportsPhysicalPatching,
  type PhysicalCableCategory,
} from "@/lib/rack-studio-cables";
import {
  buildRackStudioSvg,
  downloadRackStudioPng,
  downloadRackStudioSvg,
} from "@/lib/rack-studio-export";
import {
  clampRackStudioValue,
  devicePlacementState,
  directPlacementState,
  isRackStudioPhysicalDevice,
  loosePlacementState,
  rackTopPlacementState,
  RACK_STUDIO_CANVAS_WIDTH,
  RACK_STUDIO_RACK_HEIGHT,
  RACK_STUDIO_RACK_WIDTH,
  rackCanvasState,
  shelfPlacementBounds,
  storedRackCanvasState,
  validateDirectPlacementPreview,
  validateRackTopPlacementPreview,
} from "@/lib/rack-studio";
import {
  buildRackElevationScene,
  buildRackStudioScene,
  rackFaceForPhysicalFace,
  type RackStudioSceneEquipment,
} from "@/lib/rack-studio-scene";
import type {
  Device,
  DevicePhysicalLayout,
  Port,
  PortLink,
  Rack,
  RackFace,
  RackStudioAction,
  RackStudioActionResult,
  RackStudioPlacementState,
  Room,
} from "@/lib/types";
import { cn, normalizeColorToCss } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhysicalFaceplate } from "./PhysicalFaceplate";
import {
  RackElevationEquipmentFrame,
  RackElevationShell,
} from "./RackElevationPresentation";
import { RackStudioCableInspector } from "./RackStudioCableInspector";

const RACK_U_HEIGHT = 42;
const SELECT_CLASS =
  "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] px-2.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)]";

interface RackStudioWorkspaceProps {
  room?: Room;
  racks: Rack[];
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  portLinks: PortLink[];
  canEdit: boolean;
  initialRackId?: string;
  face: RackFace | "both";
  onFaceChange: (face: RackFace | "both") => void;
}

interface DraggedRack {
  rackId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
}

interface PanningState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
}

function SceneFaceplate({
  item,
  ports,
  linkedPortIds,
  selectedPortId,
  onSelectPort,
}: {
  item: RackStudioSceneEquipment;
  ports: Port[];
  linkedPortIds: Set<string>;
  selectedPortId?: string;
  onSelectPort?: (portId: string) => void;
}) {
  const devicePorts = ports.filter(
    (port) =>
      port.deviceId === item.device.id && portSupportsPhysicalPatching(port),
  );
  const rotated = item.rotation === 90;
  const widthRatio =
    item.rect.width > 0 ? item.rect.height / item.rect.width : 1;
  const heightRatio =
    item.rect.height > 0 ? item.rect.width / item.rect.height : 1;
  return (
    <div className="absolute inset-0 overflow-hidden">
      <PhysicalFaceplate
        layout={item.layout}
        face={item.physicalFace}
        ports={devicePorts}
        linkedPortIds={linkedPortIds}
        selectedPortId={selectedPortId}
        compact
        detail="simplified"
        fit="stretch"
        onSelectPort={onSelectPort}
        className="absolute left-1/2 top-1/2 h-full w-full rounded-none border-0 shadow-none"
        style={
          rotated
            ? {
                width: `${widthRatio * 100}%`,
                height: `${heightRatio * 100}%`,
                transform: "translate(-50%, -50%) rotate(90deg)",
              }
            : { transform: "translate(-50%, -50%)" }
        }
      />
    </div>
  );
}

function inverseAction(result: RackStudioActionResult): RackStudioAction {
  if (result.kind === "rack.move") {
    return {
      kind: result.kind,
      targetId: result.targetId,
      expected: result.after,
      next: result.before,
    };
  }
  return {
    kind: result.kind,
    targetId: result.targetId,
    expected: result.after,
    next: result.before,
  };
}

function replayAction(result: RackStudioActionResult): RackStudioAction {
  if (result.kind === "rack.move") {
    return {
      kind: result.kind,
      targetId: result.targetId,
      expected: result.before,
      next: result.after,
    };
  }
  return {
    kind: result.kind,
    targetId: result.targetId,
    expected: result.before,
    next: result.after,
  };
}

export function RackStudioWorkspace({
  room,
  racks,
  devices,
  layouts,
  ports,
  portLinks,
  canEdit,
  initialRackId,
  face,
  onFaceChange,
}: RackStudioWorkspaceProps) {
  const { t } = useI18n();
  const [editMode, setEditMode] = useState(false);
  const [patchMode, setPatchMode] = useState(false);
  const [phoneView, setPhoneView] = useState(false);
  const [focusedRackId, setFocusedRackId] = useState(
    initialRackId ?? racks[0]?.id ?? "",
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>();
  const [selectedCableId, setSelectedCableId] = useState<string>();
  const [patchStartPortId, setPatchStartPortId] = useState<string>();
  const [pendingUnusualPair, setPendingUnusualPair] = useState<{
    fromPortId: string;
    toPortId: string;
  }>();
  const [cableCategory, setCableCategory] = useState<
    PhysicalCableCategory | "all"
  >("all");
  const [showCableLabels, setShowCableLabels] = useState(true);
  const [exportScope, setExportScope] = useState<"room" | "rack">("room");
  const [search, setSearch] = useState("");
  const [healthOverlay, setHealthOverlay] = useState(false);
  const [zoom, setZoom] = useState(0.72);
  const [pan, setPan] = useState({ x: 12, y: 12 });
  const [draftRackPositions, setDraftRackPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [undoStack, setUndoStack] = useState<RackStudioActionResult[]>([]);
  const [redoStack, setRedoStack] = useState<RackStudioActionResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const roomCanvasRef = useRef<HTMLDivElement>(null);
  const rackDragRef = useRef<DraggedRack | null>(null);
  const panRef = useRef<PanningState | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setPhoneView(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (initialRackId && racks.some((rack) => rack.id === initialRackId)) {
      setFocusedRackId(initialRackId);
    } else if (!racks.some((rack) => rack.id === focusedRackId)) {
      setFocusedRackId(racks[0]?.id ?? "");
    }
  }, [focusedRackId, initialRackId, racks]);

  useEffect(() => {
    if (phoneView) {
      setEditMode(false);
      setPatchMode(false);
    }
  }, [phoneView]);

  const physicalDevices = useMemo(
    () => devices.filter(isRackStudioPhysicalDevice),
    [devices],
  );
  const focusedRack = racks.find((rack) => rack.id === focusedRackId);
  const selectedCable = portLinks.find((link) => link.id === selectedCableId);
  const selectedDevice = physicalDevices.find(
    (device) => device.id === selectedDeviceId,
  );
  const linkedPortIds = useMemo(
    () =>
      new Set(portLinks.flatMap((link) => [link.fromPortId, link.toPortId])),
    [portLinks],
  );
  const normalizedSearch = search.trim().toLowerCase();
  const looseDevices = physicalDevices.filter(
    (device) => !device.rackId && device.placement !== "shelf",
  );
  const effectiveRacks = useMemo(
    () =>
      racks.map((rack) => {
        const draft = draftRackPositions[rack.id];
        return draft ? { ...rack, studioX: draft.x, studioY: draft.y } : rack;
      }),
    [draftRackPositions, racks],
  );
  const roomScene = useMemo(
    () =>
      buildRackStudioScene({
        room,
        face,
        racks: effectiveRacks,
        devices: physicalDevices,
        layouts,
        ports,
      }),
    [effectiveRacks, face, layouts, physicalDevices, ports, room],
  );
  const roomCableRoutes = useMemo(
    () =>
      buildRackStudioCableRoutes({
        room,
        face,
        devices: physicalDevices,
        racks: effectiveRacks,
        layouts,
        ports,
        links: portLinks,
        category: cableCategory,
        scene: roomScene,
      }),
    [
      cableCategory,
      effectiveRacks,
      face,
      layouts,
      physicalDevices,
      portLinks,
      ports,
      room,
      roomScene,
    ],
  );

  const runAction = useCallback(
    async (action: RackStudioAction) => {
      setSaving(true);
      setError("");
      try {
        const result = await applyRackStudioAction(action);
        if (result.kind === "rack.move") {
          setDraftRackPositions((current) => {
            const next = { ...current };
            delete next[result.targetId];
            return next;
          });
        }
        setUndoStack((current) => [...current.slice(-49), result]);
        setRedoStack([]);
        return result;
      } catch (caught) {
        if (action.kind === "rack.move") {
          setDraftRackPositions((current) => {
            const next = { ...current };
            delete next[action.targetId];
            return next;
          });
        }
        setError(
          caught instanceof Error
            ? caught.message
            : t("Failed to update devices."),
        );
        return null;
      } finally {
        setSaving(false);
      }
    },
    [t],
  );

  const undo = useCallback(async () => {
    const entry = undoStack.at(-1);
    if (!entry || saving) return;
    setSaving(true);
    setError("");
    try {
      await applyRackStudioAction(inverseAction(entry));
      if (entry.kind === "rack.move") {
        setDraftRackPositions((current) => {
          const next = { ...current };
          delete next[entry.targetId];
          return next;
        });
      }
      setUndoStack((current) => current.slice(0, -1));
      setRedoStack((current) => [...current, entry]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Failed to update devices."),
      );
    } finally {
      setSaving(false);
    }
  }, [saving, t, undoStack]);

  const redo = useCallback(async () => {
    const entry = redoStack.at(-1);
    if (!entry || saving) return;
    setSaving(true);
    setError("");
    try {
      await applyRackStudioAction(replayAction(entry));
      if (entry.kind === "rack.move") {
        setDraftRackPositions((current) => {
          const next = { ...current };
          delete next[entry.targetId];
          return next;
        });
      }
      setRedoStack((current) => current.slice(0, -1));
      setUndoStack((current) => [...current, entry]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Failed to update devices."),
      );
    } finally {
      setSaving(false);
    }
  }, [redoStack, saving, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier || event.key.toLowerCase() !== "z") return;
      if (!editMode) return;
      event.preventDefault();
      if (event.shiftKey) void redo();
      else void undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editMode, redo, undo]);

  const fitCanvas = useCallback(() => {
    const frame = roomCanvasRef.current;
    if (!frame) return;
    const nextZoom = Math.min(
      (frame.clientWidth - 24) / RACK_STUDIO_CANVAS_WIDTH,
      (frame.clientHeight - 24) / roomScene.bounds.height,
      1,
    );
    setZoom(clampRackStudioValue(nextZoom, 0.35, 1.6));
    setPan({ x: 12, y: 12 });
  }, [roomScene.bounds.height]);

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const active = panRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    setPan({
      x: active.startPanX + event.clientX - active.startClientX,
      y: active.startPanY + event.clientY - active.startClientY,
    });
  }

  function handleCanvasPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginRackDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    rack: Rack,
    index: number,
  ) {
    if (!editMode || !canEdit || phoneView) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = draftRackPositions[rack.id] ?? rackCanvasState(rack, index);
    rackDragRef.current = {
      rackId: rack.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: current.x ?? 0,
      startY: current.y ?? 0,
      currentX: current.x ?? 0,
      currentY: current.y ?? 0,
      moved: false,
    };
  }

  function moveRackDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = rackDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const deltaX = (event.clientX - active.startClientX) / zoom;
    const deltaY = (event.clientY - active.startClientY) / zoom;
    active.moved = active.moved || Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
    active.currentX = Math.round(
      clampRackStudioValue(
        active.startX + deltaX,
        0,
        RACK_STUDIO_CANVAS_WIDTH - RACK_STUDIO_RACK_WIDTH,
      ),
    );
    active.currentY = Math.round(
      clampRackStudioValue(
        active.startY + deltaY,
        0,
        roomScene.rackPlacementAreaHeight - RACK_STUDIO_RACK_HEIGHT,
      ),
    );
    setDraftRackPositions((current) => ({
      ...current,
      [active.rackId]: {
        x: active.currentX,
        y: active.currentY,
      },
    }));
  }

  function endRackDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    rack: Rack,
  ) {
    const active = rackDragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    rackDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!active.moved) {
      setFocusedRackId(rack.id);
      return;
    }
    void runAction({
      kind: "rack.move",
      targetId: rack.id,
      expected: storedRackCanvasState(rack),
      next: {
        roomId: rack.roomId ?? null,
        x: active.currentX,
        y: active.currentY,
      },
    });
  }

  async function placeDevice(device: Device, next: RackStudioPlacementState) {
    return runAction({
      kind: "device.place",
      targetId: device.id,
      expected: devicePlacementState(device),
      next,
    });
  }

  async function completePhysicalPatch(
    fromPortId: string,
    toPortId: string,
    confirmUnusual: boolean,
  ) {
    const fromPort = ports.find((port) => port.id === fromPortId);
    const toPort = ports.find((port) => port.id === toPortId);
    if (!fromPort || !toPort) return;
    setSaving(true);
    setError("");
    try {
      const defaults = defaultCableMetadata(fromPort, toPort);
      const created = await createCable({
        fromPortId,
        toPortId,
        ...defaults,
        physicalMode: true,
        confirmUnusual,
      });
      setSelectedCableId(created.id);
      setSelectedDeviceId(undefined);
      setPatchStartPortId(undefined);
      setPendingUnusualPair(undefined);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        caught.code === "CABLE_CONNECTOR_CONFIRMATION_REQUIRED"
      ) {
        setPendingUnusualPair({ fromPortId, toPortId });
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : t("Something went wrong. Try again."),
        );
      }
    } finally {
      setSaving(false);
    }
  }

  function selectPatchPort(portId: string) {
    if (!patchMode || !canEdit || phoneView) return;
    const port = ports.find((candidate) => candidate.id === portId);
    if (!port || !portSupportsPhysicalPatching(port)) return;
    const existingLink = portLinks.find(
      (link) => link.fromPortId === portId || link.toPortId === portId,
    );
    if (existingLink) {
      setSelectedCableId(existingLink.id);
      setSelectedDeviceId(undefined);
      setPatchStartPortId(undefined);
      return;
    }
    if (!patchStartPortId) {
      setPatchStartPortId(portId);
      setSelectedCableId(undefined);
      return;
    }
    if (patchStartPortId === portId) {
      setPatchStartPortId(undefined);
      return;
    }
    const fromPort = ports.find(
      (candidate) => candidate.id === patchStartPortId,
    );
    if (!fromPort) return;
    if (!connectorPairIsUsual(fromPort, port)) {
      setPendingUnusualPair({ fromPortId: fromPort.id, toPortId: port.id });
      return;
    }
    void completePhysicalPatch(fromPort.id, port.id, false);
  }

  async function saveCable(id: string, changes: Partial<Omit<PortLink, "id">>) {
    setSaving(true);
    setError("");
    try {
      await updateCable(id, changes);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Something went wrong. Try again."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeCable(id: string) {
    setSaving(true);
    setError("");
    try {
      await deleteCable(id);
      setSelectedCableId(undefined);
      setPatchStartPortId(undefined);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Something went wrong. Try again."),
      );
    } finally {
      setSaving(false);
    }
  }

  function buildExport() {
    if (!room) return null;
    const isLight = document.documentElement.classList.contains("light");
    return buildRackStudioSvg({
      room,
      racks: effectiveRacks,
      devices: physicalDevices,
      layouts,
      ports,
      links: portLinks,
      face,
      focusRackId: exportScope === "rack" ? focusedRack?.id : undefined,
      showLabels: showCableLabels,
      theme: isLight ? "light" : "dark",
      labels: {
        cable: t("Cable"),
        cables: t("Cables"),
        devices: t("devices"),
        front: t("Front"),
        rear: t("Rear"),
        room: t("Room"),
        rack: t("Rack"),
        legend: `${t("Cable")} · ${t("Type")}`,
        crossRoom: t("Room"),
        categories: {
          network: t("Network"),
          fiber: t("Fiber"),
          power: t("Power"),
          console: t("Console"),
          usb: t("USB"),
          storage: t("Storage"),
          other: t("Other"),
        },
      },
    });
  }

  async function exportImage(format: "svg" | "png") {
    const image = buildExport();
    if (!image) return;
    setError("");
    try {
      if (format === "svg") downloadRackStudioSvg(image);
      else await downloadRackStudioPng(image);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("Something went wrong. Try again."),
      );
    }
  }

  return (
    <section
      className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-2)] shadow-[var(--shadow-card)]"
      data-testid="rack-studio-workspace"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-2.5">
        <div className="mr-2 flex items-center gap-2">
          <Move className="size-4 text-[var(--accent-primary)]" />
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)]">
            {t("Studio Beta")}
          </span>
        </div>

        <div className="flex rounded-[var(--radius-sm)] border border-[var(--border-default)] p-0.5">
          <button
            type="button"
            className={cn(
              "rounded-[3px] px-2.5 py-1 text-[11px]",
              !editMode && !patchMode
                ? "bg-[var(--accent-primary-soft)] text-[var(--accent-primary-hover)]"
                : "text-[var(--text-tertiary)]",
            )}
            onClick={() => {
              setEditMode(false);
              setPatchMode(false);
              setPatchStartPortId(undefined);
            }}
          >
            {t("Overview")}
          </button>
          <button
            type="button"
            disabled={!canEdit || phoneView}
            className={cn(
              "rounded-[3px] px-2.5 py-1 text-[11px] disabled:opacity-40",
              editMode
                ? "bg-[var(--accent-primary-soft)] text-[var(--accent-primary-hover)]"
                : "text-[var(--text-tertiary)]",
            )}
            onClick={() => {
              setEditMode(true);
              setPatchMode(false);
              setPatchStartPortId(undefined);
            }}
          >
            {t("Edit")}
          </button>
          <button
            type="button"
            disabled={!canEdit || phoneView}
            className={cn(
              "flex items-center gap-1 rounded-[3px] px-2.5 py-1 text-[11px] disabled:opacity-40",
              patchMode
                ? "bg-[var(--accent-primary-soft)] text-[var(--accent-primary-hover)]"
                : "text-[var(--text-tertiary)]",
            )}
            onClick={() => {
              setPatchMode(true);
              setEditMode(false);
              setSelectedDeviceId(undefined);
            }}
          >
            <Cable className="size-3" />
            {t("Cables")}
          </button>
        </div>

        <div className="relative min-w-40 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("Search")}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <Button
          size="sm"
          variant={healthOverlay ? "default" : "outline"}
          onClick={() => setHealthOverlay((current) => !current)}
        >
          <HeartPulse className="size-3.5" />
          {t("Health")}
        </Button>

        <select
          aria-label={t("All cable types")}
          value={cableCategory}
          onChange={(event) =>
            setCableCategory(
              event.target.value as PhysicalCableCategory | "all",
            )
          }
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] px-2 text-[11px] text-[var(--text-secondary)]"
        >
          <option value="all">{t("All cable types")}</option>
          <option value="network">{t("Network")}</option>
          <option value="fiber">{t("Fiber")}</option>
          <option value="power">{t("Power")}</option>
          <option value="console">{t("Console")}</option>
          <option value="usb">{t("USB")}</option>
          <option value="storage">{t("Storage")}</option>
          <option value="other">{t("Other")}</option>
        </select>

        <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={showCableLabels}
            onChange={(event) => setShowCableLabels(event.target.checked)}
          />
          {t("Labels")}
        </label>

        <div className="flex items-center gap-1">
          <select
            aria-label={t("Download")}
            value={exportScope}
            onChange={(event) =>
              setExportScope(event.target.value as "room" | "rack")
            }
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-1)] px-2 text-[11px] text-[var(--text-secondary)]"
          >
            <option value="room">{t("Room")}</option>
            <option value="rack">{t("Rack")}</option>
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!room || (exportScope === "rack" && !focusedRack)}
            onClick={() => void exportImage("svg")}
          >
            <Download className="size-3.5" />
            {t("Download {label}", { label: "SVG" })}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!room || (exportScope === "rack" && !focusedRack)}
            onClick={() => void exportImage("png")}
          >
            {t("Download {label}", { label: "PNG" })}
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            aria-label={t("Undo")}
            disabled={!editMode || undoStack.length === 0 || saving}
            onClick={() => void undo()}
          >
            <Undo2 />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label={t("Redo")}
            disabled={!editMode || redoStack.length === 0 || saving}
            onClick={() => void redo()}
          >
            <Redo2 />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label={t("Zoom out")}
            onClick={() =>
              setZoom((current) =>
                clampRackStudioValue(current - 0.1, 0.35, 1.6),
              )
            }
          >
            <Minus />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label={t("Zoom in")}
            onClick={() =>
              setZoom((current) =>
                clampRackStudioValue(current + 0.1, 0.35, 1.6),
              )
            }
          >
            <Plus />
          </Button>
          <Button size="sm" variant="outline" onClick={fitCanvas}>
            <Focus className="size-3.5" />
            {t("Fit")}
          </Button>
        </div>
      </div>

      {phoneView && (
        <div className="border-b border-[var(--border-default)] bg-[var(--color-warning-soft)] px-3 py-2 text-xs text-[var(--color-warning)]">
          {t("Studio editing is available on tablets and larger screens.")}
        </div>
      )}
      {patchMode && (
        <div className="flex items-center gap-2 border-b border-[var(--border-default)] bg-[var(--accent-primary-soft)] px-3 py-2 text-xs text-[var(--accent-primary-hover)]">
          <Cable className="size-3.5" />
          {t("Select a port")}
          {patchStartPortId ? (
            <span className="font-mono text-[11px]">
              {ports.find((port) => port.id === patchStartPortId)?.name}
            </span>
          ) : null}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {error}
        </div>
      )}

      <div className="grid min-h-[640px] xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 border-r border-[var(--border-default)]">
          <div className="border-b border-[var(--border-default)] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
                  {t("Room")}
                </div>
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {room?.name ?? t("Rack")}
                </div>
              </div>
              <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                {Math.round(zoom * 100)}%
              </span>
            </div>
          </div>

          <div
            ref={roomCanvasRef}
            className="relative h-[420px] touch-none overflow-hidden bg-[radial-gradient(circle_at_1px_1px,var(--border-muted)_1px,transparent_0)] [background-size:22px_22px]"
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerUp}
          >
            <div
              className="absolute left-0 top-0 border border-dashed border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_54%,transparent)] shadow-[inset_0_0_80px_rgb(0_0_0_/_0.16)]"
              style={{
                width: roomScene.bounds.width,
                height: roomScene.bounds.height,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible"
                viewBox={`0 0 ${roomScene.bounds.width} ${roomScene.bounds.height}`}
                aria-label={t("Cables")}
              >
                {roomCableRoutes.map((route) => {
                  const selected = selectedCableId === route.link.id;
                  const labelPoint = route.points.at(-1);
                  return (
                    <g key={route.link.id}>
                      <path
                        d={route.path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        className="pointer-events-stroke cursor-pointer"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedCableId(route.link.id);
                          setSelectedDeviceId(undefined);
                        }}
                      />
                      <path
                        d={route.path}
                        fill="none"
                        stroke={route.color}
                        strokeWidth={selected ? 5 : 3}
                        strokeDasharray={route.handoff ? "8 5" : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={selected ? 1 : 0.82}
                        className="pointer-events-none"
                      />
                      {showCableLabels && labelPoint ? (
                        <text
                          x={labelPoint.x + 5}
                          y={labelPoint.y - 6}
                          fill="var(--text-primary)"
                          stroke="var(--surface-1)"
                          strokeWidth={3}
                          paintOrder="stroke"
                          fontSize={9}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          className="pointer-events-none"
                        >
                          {route.crossRoom
                            ? t("{value1}: {name}", {
                                value1: route.label,
                                name: t("Room"),
                              })
                            : route.handoffFace
                              ? t("{value1}: {name}", {
                                  value1: route.label,
                                  name:
                                    route.handoffFace === "front"
                                      ? t("Front")
                                      : t("Rear"),
                                })
                              : route.label}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
              {effectiveRacks.map((rack, index) => {
                const stored = rackCanvasState(rack, index);
                const position = draftRackPositions[rack.id] ?? {
                  x: stored.x ?? 0,
                  y: stored.y ?? 0,
                };
                const rackDevices = physicalDevices.filter(
                  (device) => device.rackId === rack.id,
                );
                const rackEquipment = roomScene.equipment.filter(
                  (item) => item.rackId === rack.id,
                );
                const matches =
                  !normalizedSearch ||
                  rack.name.toLowerCase().includes(normalizedSearch) ||
                  rackDevices.some((device) =>
                    device.hostname.toLowerCase().includes(normalizedSearch),
                  );
                return (
                  <button
                    key={rack.id}
                    type="button"
                    className={cn(
                      "absolute touch-none overflow-visible rounded-[5px] border-2 bg-[var(--surface-2)] text-left shadow-[0_12px_28px_rgb(0_0_0_/_0.24)] transition-[border-color,opacity,box-shadow]",
                      focusedRackId === rack.id
                        ? "border-[var(--accent-primary)] shadow-[0_0_0_3px_var(--accent-primary-border),0_14px_32px_rgb(0_0_0_/_0.28)]"
                        : "border-[var(--border-strong)]",
                      editMode && canEdit && "cursor-move",
                      !matches && "opacity-25",
                    )}
                    style={{
                      left: position.x,
                      top: position.y,
                      width: RACK_STUDIO_RACK_WIDTH,
                      height: RACK_STUDIO_RACK_HEIGHT,
                    }}
                    onClick={() => setFocusedRackId(rack.id)}
                    onPointerDown={(event) => beginRackDrag(event, rack, index)}
                    onPointerMove={moveRackDrag}
                    onPointerUp={(event) => endRackDrag(event, rack)}
                    onPointerCancel={(event) => endRackDrag(event, rack)}
                  >
                    <div className="flex h-9 items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-1)] px-2.5">
                      <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-primary)]">
                        {rack.name}
                      </span>
                      <span className="font-mono text-[9px] text-[var(--text-tertiary)]">
                        {rack.totalU}
                        {t("U")}
                      </span>
                    </div>
                    <div className="relative mx-3 mt-3 h-[198px] border-x-[8px] border-y-[5px] border-[var(--border-strong)] bg-[var(--bg-shell)]">
                      {Array.from(
                        { length: Math.min(rack.totalU, 42) },
                        (_, row) => (
                          <span
                            key={row}
                            className="absolute inset-x-0 border-b border-[var(--border-muted)]"
                            style={{
                              top: `${((row + 1) / Math.min(rack.totalU, 42)) * 100}%`,
                            }}
                          />
                        ),
                      )}
                      {rackEquipment.map((item) => (
                        <span
                          key={item.id}
                          className={cn(
                            "absolute overflow-hidden rounded-[1px] border border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)]",
                            healthOverlay && statusClass(item.device.status),
                          )}
                          style={{
                            left: item.rect.x - position.x - 12,
                            top: item.rect.y - position.y - 48,
                            width: Math.max(2, item.rect.width),
                            height: Math.max(2, item.rect.height),
                          }}
                        >
                          <SceneFaceplate
                            item={item}
                            ports={ports}
                            linkedPortIds={linkedPortIds}
                          />
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center justify-between px-3 py-2 font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                      <span>
                        {rackDevices.length} {t("devices")}
                      </span>
                      {rack.studioX == null && (
                        <span aria-hidden="true">◇</span>
                      )}
                    </div>
                  </button>
                );
              })}
              {roomScene.tray ? (
                <div
                  className="absolute z-10 rounded-[6px] border border-dashed border-[var(--border-strong)] bg-[var(--surface-2)]/80"
                  style={{
                    left: roomScene.tray.x,
                    top: roomScene.tray.y,
                    width: roomScene.tray.width,
                    height: roomScene.tray.height,
                  }}
                >
                  <div className="px-3 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                    {t("Loose gear")}
                  </div>
                  {roomScene.equipment
                    .filter((item) => item.mountKind === "loose")
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "absolute overflow-hidden rounded-[3px] border bg-[var(--surface-1)] text-left",
                          selectedDeviceId === item.device.id
                            ? "border-[var(--accent-primary)]"
                            : "border-[var(--border-default)]",
                        )}
                        style={{
                          left: item.rect.x - roomScene.tray!.x,
                          top: item.rect.y - roomScene.tray!.y,
                          width: item.rect.width,
                          height: item.rect.height,
                        }}
                        onClick={() => setSelectedDeviceId(item.device.id)}
                      >
                        <SceneFaceplate
                          item={item}
                          ports={ports}
                          linkedPortIds={linkedPortIds}
                          selectedPortId={patchStartPortId}
                          onSelectPort={
                            patchMode && canEdit && !phoneView
                              ? selectPatchPort
                              : undefined
                          }
                        />
                        <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/65 px-1 font-mono text-[7px] text-white">
                          {item.device.hostname}
                        </span>
                      </button>
                    ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-y border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
                  {focusedRack?.name ?? t("Rack")}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {focusedRack ? (
                    <>
                      {focusedRack.totalU}
                      {t("U")} ·{" "}
                      {
                        physicalDevices.filter(
                          (device) => device.rackId === focusedRack.id,
                        ).length
                      }{" "}
                      {t("devices")}
                    </>
                  ) : (
                    t("Select a device")
                  )}
                </div>
              </div>
              <div className="flex rounded-[var(--radius-sm)] border border-[var(--border-default)] p-0.5">
                {(["front", "rear", "both"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={face === option}
                    className={cn(
                      "rounded-[3px] px-2.5 py-1 font-mono text-[10px] uppercase",
                      face === option
                        ? "bg-[var(--accent-primary-soft)] text-[var(--accent-primary-hover)]"
                        : "text-[var(--text-tertiary)]",
                    )}
                    onClick={() => onFaceChange(option)}
                  >
                    {option === "front"
                      ? t("Front")
                      : option === "rear"
                        ? t("Rear")
                        : t("Both")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {focusedRack ? (
            <div className="max-h-[72vh] overflow-auto bg-[var(--bg-shell)] p-4">
              <div className="flex flex-wrap items-start gap-5">
                {(face === "both" ? (["front", "rear"] as const) : [face]).map(
                  (rackFace) => (
                    <RackStudioElevation
                      key={rackFace}
                      rack={focusedRack}
                      face={rackFace}
                      devices={physicalDevices}
                      layouts={layouts}
                      ports={ports}
                      portLinks={portLinks}
                      selectedDeviceId={selectedDeviceId}
                      onSelectDevice={setSelectedDeviceId}
                      selectedPortId={patchStartPortId}
                      onSelectPort={selectPatchPort}
                      patchMode={patchMode && canEdit && !phoneView}
                      selectedCableId={selectedCableId}
                      onSelectCable={(linkId) => {
                        setSelectedCableId(linkId);
                        setSelectedDeviceId(undefined);
                      }}
                      cableCategory={cableCategory}
                      showCableLabels={showCableLabels}
                      editMode={editMode && canEdit && !phoneView}
                      healthOverlay={healthOverlay}
                      search={normalizedSearch}
                      onPlace={placeDevice}
                    />
                  ),
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-[var(--text-tertiary)]">
              {t("Select a device")}
            </div>
          )}
        </div>

        <aside className="min-w-0 bg-[var(--surface-1)]">
          {pendingUnusualPair ? (
            <div className="space-y-3 border-b border-[var(--border-default)] bg-[var(--color-warning-soft)] p-3 text-xs text-[var(--color-warning)]">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                {t("Needs attention")}
              </div>
              <div>
                {
                  ports.find(
                    (port) => port.id === pendingUnusualPair.fromPortId,
                  )?.kind
                }{" "}
                →{" "}
                {
                  ports.find((port) => port.id === pendingUnusualPair.toPortId)
                    ?.kind
                }
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={() =>
                    void completePhysicalPatch(
                      pendingUnusualPair.fromPortId,
                      pendingUnusualPair.toPortId,
                      true,
                    )
                  }
                >
                  {t("Save")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPendingUnusualPair(undefined)}
                >
                  {t("Cancel")}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="border-b border-[var(--border-default)] px-3 py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
              {t("Loose gear")}
            </div>
            <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {looseDevices.filter((device) =>
                normalizedSearch
                  ? device.hostname.toLowerCase().includes(normalizedSearch)
                  : true,
              ).length === 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-default)] px-3 py-5 text-center text-xs text-[var(--text-tertiary)]">
                  {t("No loose devices assigned")}
                </div>
              ) : (
                looseDevices
                  .filter((device) =>
                    normalizedSearch
                      ? device.hostname.toLowerCase().includes(normalizedSearch)
                      : true,
                  )
                  .map((device) => (
                    <button
                      key={device.id}
                      type="button"
                      onClick={() => setSelectedDeviceId(device.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-left",
                        selectedDeviceId === device.id
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary-soft)]"
                          : "border-[var(--border-default)] bg-[var(--surface-2)] hover:border-[var(--border-strong)]",
                      )}
                    >
                      <Box className="size-4 text-[var(--accent-primary)]" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-primary)]">
                        {device.hostname}
                      </span>
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          statusClass(device.status),
                        )}
                      />
                    </button>
                  ))
              )}
            </div>
          </div>

          {patchMode || selectedCable ? (
            <RackStudioCableInspector
              link={selectedCable}
              ports={ports}
              devices={physicalDevices}
              room={room}
              face={face}
              canEdit={canEdit && !phoneView}
              saving={saving}
              onUpdate={saveCable}
              onDelete={removeCable}
            />
          ) : (
            <PlacementInspector
              device={selectedDevice}
              racks={racks}
              devices={physicalDevices}
              focusedRack={focusedRack}
              room={room}
              editMode={editMode && canEdit && !phoneView}
              saving={saving}
              onPlace={placeDevice}
            />
          )}
        </aside>
      </div>
    </section>
  );
}

function statusClass(status: Device["status"]) {
  if (status === "online") return "bg-emerald-400 border-emerald-400";
  if (status === "offline") return "bg-red-400 border-red-400";
  if (status === "warning") return "bg-amber-400 border-amber-400";
  if (status === "maintenance") return "bg-violet-400 border-violet-400";
  return "bg-slate-400 border-slate-400";
}

interface ElevationProps {
  rack: Rack;
  face: RackFace;
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  portLinks: PortLink[];
  selectedDeviceId?: string;
  onSelectDevice: (deviceId: string) => void;
  selectedPortId?: string;
  onSelectPort: (portId: string) => void;
  patchMode: boolean;
  selectedCableId?: string;
  onSelectCable: (linkId: string) => void;
  cableCategory: PhysicalCableCategory | "all";
  showCableLabels: boolean;
  editMode: boolean;
  healthOverlay: boolean;
  search: string;
  onPlace: (
    device: Device,
    next: RackStudioPlacementState,
  ) => Promise<RackStudioActionResult | null>;
}

interface DirectDragDraft {
  deviceId: string;
  next: RackStudioPlacementState;
  valid: boolean;
  reason: string | null;
}

function RackStudioElevation({
  rack,
  face,
  devices,
  layouts,
  ports,
  portLinks,
  selectedDeviceId,
  onSelectDevice,
  selectedPortId,
  onSelectPort,
  patchMode,
  selectedCableId,
  onSelectCable,
  cableCategory,
  showCableLabels,
  editMode,
  healthOverlay,
  search,
  onPlace,
}: ElevationProps) {
  const { t } = useI18n();
  const [dragDraft, setDragDraft] = useState<DirectDragDraft>();
  const dragDraftRef = useRef<DirectDragDraft | undefined>(undefined);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<{
    device: Device;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    state: RackStudioPlacementState;
    captureTarget: HTMLElement;
  } | null>(null);
  const layoutByDeviceId = new Map(
    layouts.map((layout) => [layout.deviceId, layout]),
  );
  const linkedPortIds = new Set(
    portLinks.flatMap((link) => [link.fromPortId, link.toPortId]),
  );
  const rackDevices = devices.filter((device) => device.rackId === rack.id);
  const elevationScene = buildRackElevationScene({
    rack,
    rackFace: face,
    devices,
    layouts,
    ports,
    width: 1000,
    unitHeight: RACK_U_HEIGHT,
  });
  const directDevices = rackDevices.filter((device) => {
    const state = devicePlacementState(device);
    return state.mountKind === "direct";
  });
  const sideDevices = rackDevices.filter((device) => {
    const state = devicePlacementState(device);
    return state.mountKind === "side";
  });
  const rackTopDevices = rackDevices.filter((device) => {
    const state = devicePlacementState(device);
    return state.mountKind === "rack-top";
  });

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  function beginDeviceDrag(
    event: ReactPointerEvent<HTMLElement>,
    device: Device,
  ) {
    if (!editMode) return;
    const state = devicePlacementState(device);
    if (state.mountKind !== "direct" && state.mountKind !== "rack-top") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragDraftRef.current = undefined;
    setDragDraft(undefined);
    dragRef.current = {
      device,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      state,
      captureTarget: event.currentTarget,
    };
    const handleMove = (moveEvent: PointerEvent) => {
      updateDeviceDrag(
        moveEvent.pointerId,
        moveEvent.clientX,
        moveEvent.clientY,
      );
    };
    const handleEnd = (endEvent: PointerEvent) => {
      if (dragRef.current?.pointerId !== endEvent.pointerId) return;
      finishDeviceDrag(endEvent.pointerId);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
      if (dragCleanupRef.current === cleanup) {
        dragCleanupRef.current = null;
      }
    };
    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
  }

  function updateDeviceDrag(
    pointerId: number,
    clientX: number,
    clientY: number,
  ) {
    const active = dragRef.current;
    if (!active || active.pointerId !== pointerId) return;
    const deviceFrame = active.captureTarget.closest<HTMLElement>(
      '[data-testid="rack-studio-device"], [data-testid="rack-studio-rack-top-device"]',
    );
    const rackFrame = deviceFrame?.parentElement;
    if (!rackFrame) return;
    const frameWidth = rackFrame.getBoundingClientRect().width;
    const deltaColumns = Math.round(
      ((clientX - active.startClientX) / frameWidth) * 12,
    );
    const deltaU = Math.round(-(clientY - active.startClientY) / RACK_U_HEIGHT);
    const columnSpan = active.state.columnSpan ?? 12;
    const next = {
      ...active.state,
      column: clampRackStudioValue(
        (active.state.column ?? 0) + deltaColumns,
        0,
        12 - columnSpan,
      ),
      startU:
        active.state.mountKind === "direct"
          ? clampRackStudioValue(
              (active.state.startU ?? 1) + deltaU,
              1,
              rack.totalU - (active.state.heightU ?? 1) + 1,
            )
          : null,
    };
    const preview =
      active.state.mountKind === "rack-top"
        ? validateRackTopPlacementPreview({
            targetDeviceId: active.device.id,
            next,
            rack,
            devices,
          })
        : validateDirectPlacementPreview({
            targetDeviceId: active.device.id,
            next,
            rack,
            devices,
          });
    const draft: DirectDragDraft = {
      deviceId: active.device.id,
      next,
      valid: preview.valid,
      reason: preview.reason,
    };
    dragDraftRef.current = draft;
    setDragDraft(draft);
  }

  function finishDeviceDrag(pointerId: number) {
    const active = dragRef.current;
    if (!active || active.pointerId !== pointerId) return;
    dragRef.current = null;
    dragCleanupRef.current?.();
    if (active.captureTarget.hasPointerCapture(pointerId)) {
      active.captureTarget.releasePointerCapture(pointerId);
    }
    const draft = dragDraftRef.current;
    dragDraftRef.current = undefined;
    setDragDraft(undefined);
    if (draft?.deviceId === active.device.id && draft.valid) {
      void onPlace(active.device, draft.next);
    }
  }

  function handleDeviceKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
    device: Device,
  ) {
    if (
      !editMode ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    const state = devicePlacementState(device);
    if (state.mountKind !== "direct" && state.mountKind !== "rack-top") return;
    const multiplier = event.shiftKey ? 2 : 1;
    const next = { ...state };
    if (event.key === "ArrowLeft") {
      next.column = clampRackStudioValue(
        (state.column ?? 0) - multiplier,
        0,
        12 - (state.columnSpan ?? 12),
      );
    } else if (event.key === "ArrowRight") {
      next.column = clampRackStudioValue(
        (state.column ?? 0) + multiplier,
        0,
        12 - (state.columnSpan ?? 12),
      );
    } else if (state.mountKind === "rack-top") {
      return;
    } else if (event.key === "ArrowUp") {
      next.startU = clampRackStudioValue(
        (state.startU ?? 1) + multiplier,
        1,
        rack.totalU - (state.heightU ?? 1) + 1,
      );
    } else {
      next.startU = clampRackStudioValue(
        (state.startU ?? 1) - multiplier,
        1,
        rack.totalU - (state.heightU ?? 1) + 1,
      );
    }
    const preview =
      state.mountKind === "rack-top"
        ? validateRackTopPlacementPreview({
            targetDeviceId: device.id,
            next,
            rack,
            devices,
          })
        : validateDirectPlacementPreview({
            targetDeviceId: device.id,
            next,
            rack,
            devices,
          });
    if (!preview.valid) return;
    event.preventDefault();
    void onPlace(device, next);
  }

  return (
    <div className="w-[min(690px,100%)]">
      <div className="mb-2 flex items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        <span>{face === "front" ? t("Front") : t("Rear")}</span>
        <span>
          12 × {rack.totalU}
          {t("U")}
        </span>
      </div>
      <div style={{ paddingTop: elevationScene.rackOffsetY }}>
        <RackElevationShell
          totalU={rack.totalU}
          unitHeight={RACK_U_HEIGHT}
          className="mx-7"
        >
          <RackStudioElevationCableLayer
            rack={rack}
            face={face}
            devices={devices}
            layouts={layouts}
            ports={ports}
            links={portLinks}
            selectedCableId={selectedCableId}
            category={cableCategory}
            showLabels={showCableLabels}
            onSelect={onSelectCable}
          />

          {rackTopDevices.map((device) => {
            const storedState = devicePlacementState(device);
            const state =
              dragDraft?.deviceId === device.id ? dragDraft.next : storedState;
            const item = elevationScene.equipment.find(
              (candidate) =>
                candidate.device.id === device.id &&
                candidate.mountKind === "rack-top",
            );
            const height = (state.heightU ?? 1) * RACK_U_HEIGHT - 2;
            const physicalFace: RackFace =
              state.face === face ? "front" : "rear";
            return (
              <RackElevationEquipmentFrame
                key={device.id}
                device={device}
                layout={item?.layout ?? layoutByDeviceId.get(device.id)}
                physicalFace={item?.physicalFace ?? physicalFace}
                ports={ports.filter(
                  (port) =>
                    port.deviceId === device.id &&
                    port.portRole !== "aggregate" &&
                    port.kind !== "virtual" &&
                    port.kind !== "wifi",
                )}
                linkedPortIds={linkedPortIds}
                selectedPortId={selectedPortId}
                rectWidth={((state.columnSpan ?? 12) / 12) * 1000}
                rectHeight={height}
                selected={selectedDeviceId === device.id}
                healthClassName={cn(
                  healthOverlay && statusClass(device.status),
                  dragDraft?.deviceId === device.id &&
                    (dragDraft.valid
                      ? "border-emerald-400 shadow-[0_0_0_2px_rgb(52_211_153_/_0.35)]"
                      : "border-red-400 shadow-[0_0_0_2px_rgb(248_113_113_/_0.35)]"),
                )}
                testId="rack-studio-rack-top-device"
                onSelectDevice={onSelectDevice}
                onSelectPort={
                  patchMode
                    ? (_deviceId, portId) => onSelectPort(portId)
                    : undefined
                }
                onKeyDown={(event) => handleDeviceKeyDown(event, device)}
                onPointerDown={(event) => beginDeviceDrag(event, device)}
                className={cn(
                  "z-40",
                  editMode && "cursor-ew-resize touch-none",
                )}
                title={
                  dragDraft?.deviceId === device.id
                    ? (dragDraft.reason ?? device.hostname)
                    : device.hostname
                }
                style={{
                  top:
                    (item?.rect.y ?? elevationScene.rackOffsetY - height - 4) -
                    elevationScene.rackOffsetY,
                  left: `${((state.column ?? 0) / 12) * 100}%`,
                  width: `${((state.columnSpan ?? 12) / 12) * 100}%`,
                  height,
                }}
              />
            );
          })}

          {directDevices.map((device) => {
            const storedState = devicePlacementState(device);
            const physicalFace: RackFace =
              storedState.face === face ? "front" : "rear";
            const state =
              dragDraft?.deviceId === device.id ? dragDraft.next : storedState;
            const heightU = state.heightU ?? 1;
            const topU = Math.min(
              rack.totalU,
              (state.startU ?? 1) + heightU - 1,
            );
            const top = (rack.totalU - topU) * RACK_U_HEIGHT + 9;
            const layout = layoutByDeviceId.get(device.id);
            const devicePorts = ports.filter(
              (port) =>
                port.deviceId === device.id &&
                port.portRole !== "aggregate" &&
                port.kind !== "virtual" &&
                port.kind !== "wifi",
            );
            const matches =
              !search ||
              device.hostname.toLowerCase().includes(search) ||
              device.model?.toLowerCase().includes(search);
            const shelfChildren = devices.filter(
              (child) =>
                child.parentDeviceId === device.id &&
                devicePlacementState(child).mountKind === "shelf",
            );
            return (
              <RackElevationEquipmentFrame
                key={device.id}
                device={device}
                layout={layout}
                physicalFace={physicalFace}
                ports={devicePorts}
                linkedPortIds={linkedPortIds}
                selectedPortId={selectedPortId}
                rectWidth={((state.columnSpan ?? 12) / 12) * 1000}
                rectHeight={heightU * RACK_U_HEIGHT - 2}
                selected={selectedDeviceId === device.id}
                matches={Boolean(matches)}
                healthClassName={cn(
                  healthOverlay && statusClass(device.status),
                  dragDraft?.deviceId === device.id &&
                    (dragDraft.valid
                      ? "border-emerald-400 shadow-[0_0_0_2px_rgb(52_211_153_/_0.35)]"
                      : "border-red-400 shadow-[0_0_0_2px_rgb(248_113_113_/_0.35)]"),
                )}
                testId="rack-studio-device"
                onSelectDevice={onSelectDevice}
                onSelectPort={
                  patchMode
                    ? (_deviceId, portId) => onSelectPort(portId)
                    : undefined
                }
                onKeyDown={(event) => handleDeviceKeyDown(event, device)}
                onPointerDown={(event) => beginDeviceDrag(event, device)}
                className={cn(editMode && "cursor-move touch-none")}
                title={
                  dragDraft?.deviceId === device.id
                    ? (dragDraft.reason ?? device.hostname)
                    : device.hostname
                }
                style={{
                  top,
                  left: `${((state.column ?? 0) / 12) * 100}%`,
                  width: `${((state.columnSpan ?? 12) / 12) * 100}%`,
                  height: heightU * RACK_U_HEIGHT - 2,
                }}
              >
                {editMode ? (
                  <button
                    type="button"
                    aria-label={t("{value1}: {name}", {
                      value1: t("Position"),
                      name: device.hostname,
                    })}
                    className="absolute right-1 top-1 z-50 grid size-6 touch-none place-items-center rounded-[2px] border border-[var(--accent-primary)] bg-[var(--surface-1)] text-[var(--accent-primary)] shadow-sm"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectDevice(device.id);
                    }}
                    onPointerDown={(event) => beginDeviceDrag(event, device)}
                  >
                    <Move className="size-3" />
                  </button>
                ) : null}
                {shelfChildren.map((child) => (
                  <ShelfChild
                    key={child.id}
                    child={child}
                    item={elevationScene.equipment.find(
                      (candidate) =>
                        candidate.device.id === child.id &&
                        candidate.mountKind === "shelf",
                    )}
                    siblings={shelfChildren}
                    selected={selectedDeviceId === child.id}
                    editMode={editMode}
                    ports={ports}
                    linkedPortIds={linkedPortIds}
                    selectedPortId={selectedPortId}
                    onSelectPort={patchMode ? onSelectPort : undefined}
                    onSelect={onSelectDevice}
                    onPlace={onPlace}
                  />
                ))}
              </RackElevationEquipmentFrame>
            );
          })}

          {sideDevices.map((device) => {
            const state = devicePlacementState(device);
            const item = elevationScene.equipment.find(
              (candidate) =>
                candidate.device.id === device.id &&
                candidate.mountKind === "side",
            );
            const rect = item?.rect ?? {
              x: state.side === "right" ? 1000 - 28 : 0,
              y: 12,
              width: 28,
              height: rack.totalU * RACK_U_HEIGHT - 8,
            };
            return (
              <RackElevationEquipmentFrame
                key={device.id}
                device={device}
                layout={item?.layout}
                physicalFace={
                  item?.physicalFace ?? (state.face === face ? "front" : "rear")
                }
                ports={ports.filter(
                  (port) =>
                    port.deviceId === device.id &&
                    port.portRole !== "aggregate" &&
                    port.kind !== "virtual" &&
                    port.kind !== "wifi",
                )}
                linkedPortIds={linkedPortIds}
                selectedPortId={selectedPortId}
                rotation={90}
                rectWidth={rect.width}
                rectHeight={rect.height}
                selected={selectedDeviceId === device.id}
                healthClassName={
                  healthOverlay ? statusClass(device.status) : undefined
                }
                className="z-40"
                style={{
                  left: rect.x,
                  top: rect.y - elevationScene.rackOffsetY,
                  width: rect.width,
                  height: rect.height,
                }}
                onSelectDevice={onSelectDevice}
                onSelectPort={
                  patchMode
                    ? (_deviceId, portId) => onSelectPort(portId)
                    : undefined
                }
              />
            );
          })}
        </RackElevationShell>
      </div>
    </div>
  );
}

function RackStudioElevationCableLayer({
  rack,
  face,
  devices,
  layouts,
  ports,
  links,
  selectedCableId,
  category,
  showLabels,
  onSelect,
}: {
  rack: Rack;
  face: RackFace;
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  links: PortLink[];
  selectedCableId?: string;
  category: PhysicalCableCategory | "all";
  showLabels: boolean;
  onSelect: (linkId: string) => void;
}) {
  const { t } = useI18n();
  const portById = new Map(ports.map((port) => [port.id, port]));
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const anchors = new Map<string, { x: number; y: number }>();
  const scene = buildRackElevationScene({
    rack,
    rackFace: face,
    devices,
    layouts,
    ports,
    width: 1000,
    unitHeight: RACK_U_HEIGHT,
  });
  const height = scene.height;
  for (const anchor of scene.portAnchors) {
    anchors.set(anchor.portId, { x: anchor.x, y: anchor.y });
  }

  const routeElements = links.flatMap((link) => {
    if (link.visible === false) return [];
    const fromPort = portById.get(link.fromPortId);
    const toPort = portById.get(link.toPortId);
    const cableCategory = cableCategoryForPorts(fromPort, toPort);
    if (category !== "all" && category !== cableCategory) return [];
    const from = anchors.get(link.fromPortId);
    const to = anchors.get(link.toPortId);
    if (!from && !to) return [];
    let points: Array<{ x: number; y: number }>;
    let handoff = false;
    let handoffFace: RackFace | undefined;
    if (from && to) {
      let hash = 0;
      for (const character of link.id) {
        hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
      }
      const gutter = Math.max(
        8,
        Math.min(992, (from.x + to.x) / 2 + ((hash % 11) - 5) * 10),
      );
      points = [from, { x: gutter, y: from.y }, { x: gutter, y: to.y }, to];
    } else {
      handoff = true;
      const local = (from ?? to)!;
      const remotePort = from ? toPort : fromPort;
      const remoteDevice = remotePort
        ? deviceById.get(remotePort.deviceId)
        : undefined;
      if (remoteDevice?.rackId === rack.id && remotePort) {
        handoffFace = rackFaceForPhysicalFace(
          remoteDevice,
          remotePort.face === "rear" ? "rear" : "front",
        );
      }
      points = [local, { x: local.x < 500 ? 992 : 8, y: local.y }];
    }
    const path = points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
      )
      .join(" ");
    const selected = selectedCableId === link.id;
    const last = points.at(-1)!;
    const label = link.label || link.cableType || t("Cable");
    const color =
      normalizeColorToCss(link.color) ?? defaultCableColor(cableCategory);
    return [
      <g key={link.id}>
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={18}
          vectorEffect="non-scaling-stroke"
          className="pointer-events-stroke cursor-pointer"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(link.id);
          }}
        />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={selected ? 5 : 3}
          strokeDasharray={handoff ? "8 5" : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="pointer-events-none"
        />
        {showLabels ? (
          <text
            x={last.x + (last.x < 500 ? 8 : -8)}
            y={last.y - 7}
            textAnchor={last.x < 500 ? "start" : "end"}
            fill="var(--text-primary)"
            stroke="var(--surface-1)"
            strokeWidth={3}
            paintOrder="stroke"
            fontSize={12}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            className="pointer-events-none"
          >
            {handoff
              ? t("{value1}: {name}", {
                  value1: label,
                  name: handoffFace
                    ? handoffFace === "front"
                      ? t("Front")
                      : t("Rear")
                    : t("Room"),
                })
              : label}
          </text>
        ) : null}
      </g>,
    ];
  });

  return (
    <svg
      className="pointer-events-none absolute inset-x-0 z-20 w-full overflow-visible"
      style={{ top: -scene.rackOffsetY, height }}
      viewBox={`0 0 1000 ${height}`}
      preserveAspectRatio="none"
      aria-label={t("Cables")}
    >
      {routeElements}
    </svg>
  );
}

function ShelfChild({
  child,
  item,
  siblings,
  selected,
  editMode,
  ports,
  linkedPortIds,
  selectedPortId,
  onSelectPort,
  onSelect,
  onPlace,
}: {
  child: Device;
  item?: RackStudioSceneEquipment;
  siblings: Device[];
  selected: boolean;
  editMode: boolean;
  ports: Port[];
  linkedPortIds: Set<string>;
  selectedPortId?: string;
  onSelectPort?: (portId: string) => void;
  onSelect: (id: string) => void;
  onPlace: (
    device: Device,
    next: RackStudioPlacementState,
  ) => Promise<RackStudioActionResult | null>;
}) {
  const [draft, setDraft] = useState<RackStudioPlacementState>();
  const draftRef = useRef<RackStudioPlacementState | undefined>(undefined);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const state = draft ?? devicePlacementState(child);
  const bounds = shelfPlacementBounds(state);
  if (!bounds) return null;
  const effectiveBounds = bounds;
  const overlaps = siblings.some((sibling) => {
    if (sibling.id === child.id) return false;
    const other = shelfPlacementBounds(devicePlacementState(sibling));
    return Boolean(
      other &&
      effectiveBounds.x < other.x + other.width &&
      effectiveBounds.x + effectiveBounds.width > other.x &&
      effectiveBounds.y < other.y + other.height &&
      effectiveBounds.y + effectiveBounds.height > other.y,
    );
  });

  function begin(event: ReactPointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    onSelect(child.id);
    if (!editMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draftRef.current = undefined;
    setDraft(undefined);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: state.shelfX ?? 0,
      startY: state.shelfY ?? 0,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const parent = event.currentTarget.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const deltaX = ((event.clientX - active.clientX) / rect.width) * 1000;
    const deltaY = ((event.clientY - active.clientY) / rect.height) * 1000;
    const next: RackStudioPlacementState = {
      ...state,
      shelfX: Math.round(
        clampRackStudioValue(
          active.startX + deltaX,
          0,
          1000 - effectiveBounds.width,
        ),
      ),
      shelfY: Math.round(
        clampRackStudioValue(
          active.startY + deltaY,
          0,
          1000 - effectiveBounds.height,
        ),
      ),
    };
    draftRef.current = next;
    setDraft(next);
  }

  function end(event: ReactPointerEvent<HTMLDivElement>) {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const finalDraft = draftRef.current;
    draftRef.current = undefined;
    const finalBounds = finalDraft
      ? shelfPlacementBounds(finalDraft)
      : undefined;
    const finalOverlaps = Boolean(
      finalBounds &&
      siblings.some((sibling) => {
        if (sibling.id === child.id) return false;
        const other = shelfPlacementBounds(devicePlacementState(sibling));
        return Boolean(
          other &&
          finalBounds.x < other.x + other.width &&
          finalBounds.x + finalBounds.width > other.x &&
          finalBounds.y < other.y + other.height &&
          finalBounds.y + finalBounds.height > other.y,
        );
      }),
    );
    if (finalDraft && !finalOverlaps) void onPlace(child, finalDraft);
    setDraft(undefined);
  }

  return (
    <RackElevationEquipmentFrame
      device={child}
      layout={item?.layout}
      physicalFace={item?.physicalFace ?? "front"}
      ports={ports.filter(
        (port) =>
          port.deviceId === child.id &&
          port.portRole !== "aggregate" &&
          port.kind !== "virtual" &&
          port.kind !== "wifi",
      )}
      linkedPortIds={linkedPortIds}
      selectedPortId={selectedPortId}
      rotation={item?.rotation ?? 0}
      rectWidth={effectiveBounds.width}
      rectHeight={effectiveBounds.height}
      selected={selected}
      onSelectDevice={onSelect}
      onSelectPort={
        onSelectPort ? (_deviceId, portId) => onSelectPort(portId) : undefined
      }
      className={cn(
        "z-30 bg-[var(--surface-2)] font-mono text-[7px] shadow-sm",
        editMode && "cursor-move touch-none",
        overlaps && "border-red-400 bg-red-500/20",
      )}
      style={{
        left: `${effectiveBounds.x / 10}%`,
        top: `${effectiveBounds.y / 10}%`,
        width: `${effectiveBounds.width / 10}%`,
        height: `${effectiveBounds.height / 10}%`,
      }}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}

function PlacementInspector({
  device,
  racks,
  devices,
  focusedRack,
  room,
  editMode,
  saving,
  onPlace,
}: {
  device?: Device;
  racks: Rack[];
  devices: Device[];
  focusedRack?: Rack;
  room?: Room;
  editMode: boolean;
  saving: boolean;
  onPlace: (
    device: Device,
    next: RackStudioPlacementState,
  ) => Promise<RackStudioActionResult | null>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<RackStudioPlacementState>();

  useEffect(() => {
    if (!device) {
      setDraft(undefined);
      return;
    }
    const current = devicePlacementState(device);
    if (current.mountKind === "loose" && focusedRack && editMode) {
      setDraft(
        directPlacementState({
          roomId: focusedRack.roomId ?? room?.id ?? null,
          rackId: focusedRack.id,
          startU: 1,
          heightU: device.heightU ?? 1,
          face: "front",
          column: 0,
          columnSpan: 12,
        }),
      );
    } else {
      setDraft(current);
    }
  }, [device, editMode, focusedRack, room?.id]);

  if (!device || !draft) {
    return (
      <div className="p-4">
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
          {t("Inspector")}
        </div>
        <div className="mt-8 text-center text-xs text-[var(--text-tertiary)]">
          {t("Select a device")}
        </div>
      </div>
    );
  }

  const inspectedDevice = device;

  const selectedRack = racks.find((rack) => rack.id === draft.rackId);
  const shelfOptions = devices.filter((candidate) => {
    const state = devicePlacementState(candidate);
    return (
      candidate.deviceType === "rack_shelf" && state.mountKind === "direct"
    );
  });

  function numberField(
    key: keyof RackStudioPlacementState,
    value: number | null,
    minimum: number,
    maximum: number,
  ) {
    return (
      <Input
        type="number"
        min={minimum}
        max={maximum}
        value={value ?? ""}
        disabled={!editMode}
        onChange={(event) =>
          setDraft((current) =>
            current
              ? {
                  ...current,
                  [key]: event.target.value ? Number(event.target.value) : null,
                }
              : current,
          )
        }
        className="h-8 text-xs"
      />
    );
  }

  function changeMountKind(kind: RackStudioPlacementState["mountKind"]) {
    if (kind === "loose") {
      setDraft(loosePlacementState(room?.id ?? inspectedDevice.roomId ?? null));
      return;
    }
    const rack = selectedRack ?? focusedRack ?? racks[0];
    if (!rack) return;
    if (kind === "direct") {
      setDraft(
        directPlacementState({
          roomId: rack.roomId ?? room?.id ?? null,
          rackId: rack.id,
          startU: 1,
          heightU: inspectedDevice.heightU ?? 1,
          face: "front",
          column: 0,
          columnSpan: 12,
        }),
      );
      return;
    }
    if (kind === "rack-top") {
      setDraft(
        rackTopPlacementState({
          roomId: rack.roomId ?? room?.id ?? null,
          rackId: rack.id,
          heightU: inspectedDevice.heightU ?? 1,
        }),
      );
      return;
    }
    if (kind === "side") {
      setDraft({
        ...loosePlacementState(rack.roomId ?? room?.id ?? null),
        mountKind: "side",
        rackId: rack.id,
        heightU: inspectedDevice.heightU ?? 1,
        face: "front",
        side: "left",
      });
      return;
    }
    const shelf = shelfOptions[0];
    const shelfState = shelf ? devicePlacementState(shelf) : null;
    setDraft({
      ...loosePlacementState(rack.roomId ?? room?.id ?? null),
      mountKind: "shelf",
      rackId: shelfState?.rackId ?? rack.id,
      parentDeviceId: shelf?.id ?? null,
      heightU: inspectedDevice.heightU ?? 1,
      face: shelfState?.face ?? "front",
      shelfX: 50,
      shelfY: 50,
      shelfWidth: 220,
      shelfHeight: 180,
      orientation: 0,
    });
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
          {t("Inspector")}
        </div>
        <div className="mt-1 truncate font-mono text-sm font-semibold text-[var(--text-primary)]">
          {inspectedDevice.hostname}
        </div>
        <div className="text-[11px] text-[var(--text-tertiary)]">
          {inspectedDevice.manufacturer} {inspectedDevice.model}
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-[11px] text-[var(--text-secondary)]">
          {t("Placement")}
        </span>
        <select
          className={SELECT_CLASS}
          disabled={!editMode}
          value={draft.mountKind}
          onChange={(event) =>
            changeMountKind(
              event.target.value as RackStudioPlacementState["mountKind"],
            )
          }
        >
          <option value="direct">{t("Direct")}</option>
          <option value="shelf">{t("Shelf")}</option>
          <option value="side">{t("0U side")}</option>
          <option value="rack-top">{t("Rack top")}</option>
          <option value="loose">{t("Loose gear")}</option>
        </select>
      </label>

      {draft.mountKind !== "loose" && draft.mountKind !== "shelf" && (
        <label className="block space-y-1">
          <span className="text-[11px] text-[var(--text-secondary)]">
            {t("Rack")}
          </span>
          <select
            className={SELECT_CLASS}
            disabled={!editMode}
            value={draft.rackId ?? ""}
            onChange={(event) => {
              const rack = racks.find(
                (entry) => entry.id === event.target.value,
              );
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      rackId: event.target.value,
                      roomId: rack?.roomId ?? room?.id ?? null,
                    }
                  : current,
              );
            }}
          >
            {racks.map((rack) => (
              <option key={rack.id} value={rack.id}>
                {rack.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {(draft.mountKind === "direct" || draft.mountKind === "rack-top") && (
        <div className="grid grid-cols-2 gap-2">
          {draft.mountKind === "direct" ? (
            <InspectorField label={t("Start U")}>
              {numberField(
                "startU",
                draft.startU,
                1,
                selectedRack?.totalU ?? 100,
              )}
            </InspectorField>
          ) : null}
          <InspectorField label={t("Height (U)")}>
            {numberField("heightU", draft.heightU, 1, 20)}
          </InspectorField>
          <InspectorField label={t("Columns")}>
            {numberField("column", draft.column, 0, 11)}
          </InspectorField>
          <InspectorField label={t("Column span")}>
            {numberField("columnSpan", draft.columnSpan, 1, 12)}
          </InspectorField>
        </div>
      )}

      {(draft.mountKind === "direct" ||
        draft.mountKind === "side" ||
        draft.mountKind === "rack-top") && (
        <label className="block space-y-1">
          <span className="text-[11px] text-[var(--text-secondary)]">
            {t("Rack face")}
          </span>
          <select
            className={SELECT_CLASS}
            disabled={!editMode}
            value={draft.face ?? "front"}
            onChange={(event) =>
              setDraft((current) =>
                current
                  ? { ...current, face: event.target.value as RackFace }
                  : current,
              )
            }
          >
            <option value="front">{t("Front")}</option>
            <option value="rear">{t("Rear")}</option>
          </select>
        </label>
      )}

      {draft.mountKind === "side" && (
        <label className="block space-y-1">
          <span className="text-[11px] text-[var(--text-secondary)]">
            {t("Placement")}
          </span>
          <select
            className={SELECT_CLASS}
            disabled={!editMode}
            value={draft.side ?? "left"}
            onChange={(event) =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      side: event.target.value as "left" | "right",
                    }
                  : current,
              )
            }
          >
            <option value="left">{t("Left side")}</option>
            <option value="right">{t("Right side")}</option>
          </select>
        </label>
      )}

      {draft.mountKind === "shelf" && (
        <>
          <label className="block space-y-1">
            <span className="text-[11px] text-[var(--text-secondary)]">
              {t("Shelf")}
            </span>
            <select
              className={SELECT_CLASS}
              disabled={!editMode}
              value={draft.parentDeviceId ?? ""}
              onChange={(event) => {
                const shelf = devices.find(
                  (entry) => entry.id === event.target.value,
                );
                const state = shelf ? devicePlacementState(shelf) : null;
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        parentDeviceId: event.target.value || null,
                        rackId: state?.rackId ?? null,
                        roomId: state?.roomId ?? room?.id ?? null,
                        face: state?.face ?? "front",
                      }
                    : current,
                );
              }}
            >
              <option value="">{t("Select")}</option>
              {shelfOptions.map((shelf) => (
                <option key={shelf.id} value={shelf.id}>
                  {shelf.hostname}
                </option>
              ))}
            </select>
          </label>
          <InspectorField label={t("Position")}>
            <div className="grid grid-cols-2 gap-2">
              {numberField("shelfX", draft.shelfX, 0, 1000)}
              {numberField("shelfY", draft.shelfY, 0, 1000)}
            </div>
          </InspectorField>
          <div className="grid grid-cols-2 gap-2">
            <InspectorField label={t("Width")}>
              {numberField("shelfWidth", draft.shelfWidth, 1, 1000)}
            </InspectorField>
            <InspectorField label={t("Height")}>
              {numberField("shelfHeight", draft.shelfHeight, 1, 1000)}
            </InspectorField>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!editMode}
            onClick={() =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      orientation: current.orientation === 90 ? 0 : 90,
                    }
                  : current,
              )
            }
          >
            <RotateCw className="size-3.5" />
            {t("Orientation")}: {draft.orientation ?? 0}°
          </Button>
        </>
      )}

      {editMode && (
        <Button
          className="w-full"
          disabled={saving}
          onClick={() => void onPlace(inspectedDevice, draft)}
        >
          {saving ? <ChevronUp className="animate-pulse" /> : <ChevronDown />}
          {t("Save")}
        </Button>
      )}
    </div>
  );
}

function InspectorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}
