import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
  type OnNodeDrag,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ExternalLink, GitBranch, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DeviceTypeIcon } from "@/components/shared/DeviceTypeIcon";
import { StatusDot } from "@/components/shared/StatusDot";
import { formatDeviceAddress } from "@/lib/network-labels";
import type {
  Device,
  Port,
  VirtualSwitch,
  WifiAccessPoint,
  WifiClientAssociation,
  WifiSsid,
} from "@/lib/types";
import { cn, formatPortLabel, normalizeColorToCss } from "@/lib/utils";
import { nodeStripeColor, typeColor, typeLabel } from "./model";
import type {
  VisualizerCable,
  VisualizerHealth,
  VisualizerModel,
  VisualizerNode,
} from "./types";

const DIAGRAM_POSITIONS_STORAGE_KEY = "rackpad.visualizer.diagram-positions";
const DIAGRAM_SECTION_POSITIONS_STORAGE_KEY =
  "rackpad.visualizer.diagram-section-positions";
const SECTION_PADDING_X = 24;
const SECTION_PADDING_BOTTOM = 30;
const SECTION_HEADER_HEIGHT = 84;
const SECTION_GAP_X = 56;
const SECTION_GAP_Y = 56;
const SECTION_START_X = 36;
const SECTION_START_Y = 116;
const ROW_MAX_WIDTH = 1900;
const DEVICE_NODE_WIDTH = 300;
const DEVICE_NODE_HEIGHT = 92;
const DEVICE_GAP_X = 30;
const DEVICE_GAP_Y = 24;
const STACKED_DEVICE_GAP_Y = 14;
const EDGE_LABEL_LIMIT = 42;

interface DiagramCanvasProps {
  model: VisualizerModel;
  loading: boolean;
  healthOverlay: boolean;
  cableType: string;
  wifiSsids: WifiSsid[];
  wifiAccessPoints: WifiAccessPoint[];
  wifiClientAssociations: WifiClientAssociation[];
  virtualSwitches: VirtualSwitch[];
}

interface DiagramPortData {
  id: string;
  linked: boolean;
  color: string | null;
}

interface DiagramDeviceData extends Record<string, unknown> {
  address: string;
  deviceId: string;
  deviceType: string;
  health: VisualizerHealth;
  hostname: string;
  connectionCount: number;
  portSummary: string;
  ports: DiagramPortData[];
  sectionLabel: string;
  stripeColor: string;
  typeColor: string;
  typeLabel: string;
}

interface DiagramSectionData extends Record<string, unknown> {
  accent: string;
  countLabel: string;
  subtitle: string;
  title: string;
}

interface DiagramWifiContext {
  accessPointByDeviceId: Record<string, WifiAccessPoint>;
  associationByClientId: Record<string, WifiClientAssociation>;
  ssidById: Record<string, WifiSsid>;
}

type DiagramDeviceNode = FlowNode<DiagramDeviceData, "device">;
type DiagramSectionNode = FlowNode<DiagramSectionData, "section">;
type DiagramFlowNode = DiagramDeviceNode | DiagramSectionNode;

interface DiagramEdgeData extends Record<string, unknown> {
  cableId: string;
}

type DiagramFlowEdge = FlowEdge<DiagramEdgeData, "smoothstep">;

interface DiagramSection {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  layout: "grid" | "stack";
  sortGroup: number;
  nodes: VisualizerNode[];
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
}

interface DiagramLayoutResult {
  flowNodes: DiagramFlowNode[];
  flowEdges: DiagramFlowEdge[];
  sections: DiagramSection[];
  visibleDeviceCount: number;
  hiddenDeviceCount: number;
  visibleDeviceIds: Set<string>;
  visibleCableCount: number;
}

interface DiagramDragOrigin {
  sectionId: string;
  sectionStart: XYPosition;
  deviceStarts: Record<string, XYPosition>;
}

interface VirtualNetworkRow {
  id: string;
  device?: Device;
  host?: Device;
  port?: Port;
  role: string;
  virtualSwitch?: VirtualSwitch;
}

const nodeTypes = {
  device: DiagramDeviceCard,
  section: DiagramSectionCard,
} as NodeTypes;

export function DiagramCanvas({
  model,
  loading,
  healthOverlay,
  cableType,
  wifiSsids,
  wifiAccessPoints,
  wifiClientAssociations,
  virtualSwitches,
}: DiagramCanvasProps) {
  const [savedPositions, setSavedPositions] = useState<
    Record<string, XYPosition>
  >(() => readDiagramPositions(DIAGRAM_POSITIONS_STORAGE_KEY));
  const [savedSectionPositions, setSavedSectionPositions] = useState<
    Record<string, XYPosition>
  >(() => readDiagramPositions(DIAGRAM_SECTION_POSITIONS_STORAGE_KEY));
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const sectionDragOriginRef = useRef<DiagramDragOrigin | null>(null);
  const wifiContext = useMemo(
    () =>
      buildDiagramWifiContext(
        wifiSsids,
        wifiAccessPoints,
        wifiClientAssociations,
      ),
    [wifiSsids, wifiAccessPoints, wifiClientAssociations],
  );
  const {
    flowNodes,
    flowEdges,
    sections,
    visibleDeviceCount,
    hiddenDeviceCount,
    visibleDeviceIds,
    visibleCableCount,
  } = useMemo(
    () =>
      buildDiagramLayout(
        model,
        cableType,
        healthOverlay,
        typeFilters,
        savedPositions,
        savedSectionPositions,
        wifiContext,
      ),
    [
      model,
      cableType,
      healthOverlay,
      typeFilters,
      savedPositions,
      savedSectionPositions,
      wifiContext,
    ],
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<DiagramFlowNode>(flowNodes);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<DiagramFlowEdge>(flowEdges);

  useEffect(() => {
    setNodes(flowNodes);
  }, [flowNodes, setNodes]);

  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  useEffect(() => {
    if (selectedDeviceId && !visibleDeviceIds.has(selectedDeviceId)) {
      setSelectedDeviceId(null);
    }
    if (selectedCableId && !flowEdges.some((edge) => edge.id === selectedCableId)) {
      setSelectedCableId(null);
    }
  }, [flowEdges, selectedCableId, selectedDeviceId, visibleDeviceIds]);

  const sectionDeviceIdsById = useMemo(
    () =>
      Object.fromEntries(
        sections.map((section) => [
          section.id,
          new Set(section.nodes.map((node) => node.device.id)),
        ]),
      ) as Record<string, Set<string>>,
    [sections],
  );

  const selectedNode = selectedDeviceId
    ? model.nodesByDeviceId[selectedDeviceId]
    : null;
  const selectedCable = selectedCableId
    ? model.cableById[selectedCableId]
    : null;
  const connectedCables = selectedNode
    ? model.cables.filter(
        (cable) =>
          cableIsVisible(cable, cableType) &&
          cableHasVisibleEndpoints(cable, visibleDeviceIds) &&
          (cable.fromDevice?.id === selectedNode.device.id ||
            cable.toDevice?.id === selectedNode.device.id),
      )
    : [];
  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const highlighted =
          selectedCableId === edge.id ||
          (selectedDeviceId != null &&
            (edge.source === selectedDeviceId || edge.target === selectedDeviceId));
        const dimmed =
          Boolean(selectedCableId || selectedDeviceId) && !highlighted;
        return {
          ...edge,
          animated: highlighted,
          zIndex: highlighted ? 8 : 1,
          style: {
            ...edge.style,
            strokeOpacity: highlighted
              ? 0.96
              : dimmed
                ? 0.14
                : edge.style?.strokeOpacity,
            strokeWidth: highlighted ? 4 : edge.style?.strokeWidth,
          },
        };
      }),
    [edges, selectedCableId, selectedDeviceId],
  );

  const handleNodeClick: NodeMouseHandler<DiagramFlowNode> = (_, node) => {
    if (node.type !== "device") return;
    setSelectedDeviceId(node.data.deviceId);
    setSelectedCableId(null);
  };

  const handleNodeDragStart: OnNodeDrag<DiagramFlowNode> = (_, node) => {
    if (node.type !== "section") {
      sectionDragOriginRef.current = null;
      return;
    }
    const childIds = sectionDeviceIdsById[node.id] ?? new Set<string>();
    const deviceStarts = Object.fromEntries(
      nodes
        .filter((entry) => childIds.has(entry.id))
        .map((entry) => [entry.id, { ...entry.position }]),
    );
    sectionDragOriginRef.current = {
      sectionId: node.id,
      sectionStart: { ...node.position },
      deviceStarts,
    };
    setSelectedDeviceId(null);
    setSelectedCableId(null);
  };

  const handleNodeDrag: OnNodeDrag<DiagramFlowNode> = (_, node) => {
    const origin = sectionDragOriginRef.current;
    if (!origin || node.type !== "section" || node.id !== origin.sectionId) {
      return;
    }
    const delta = {
      x: node.position.x - origin.sectionStart.x,
      y: node.position.y - origin.sectionStart.y,
    };
    const childIds = sectionDeviceIdsById[node.id] ?? new Set<string>();
    setNodes((current) =>
      current.map((entry) => {
        if (entry.id === node.id) {
          return {
            ...entry,
            position: {
              x: Math.round(node.position.x),
              y: Math.round(node.position.y),
            },
          };
        }
        if (!childIds.has(entry.id)) return entry;
        const start = origin.deviceStarts[entry.id];
        if (!start) return entry;
        return {
          ...entry,
          position: {
            x: Math.round(start.x + delta.x),
            y: Math.round(start.y + delta.y),
          },
        };
      }),
    );
  };

  const handleNodeDragStop: OnNodeDrag<DiagramFlowNode> = (_, node) => {
    if (node.type === "section") {
      const origin = sectionDragOriginRef.current;
      if (!origin || origin.sectionId !== node.id) return;
      const delta = {
        x: node.position.x - origin.sectionStart.x,
        y: node.position.y - origin.sectionStart.y,
      };
      const nextSectionPositions = {
        ...savedSectionPositions,
        [node.id]: {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        },
      };
      const movedDevicePositions = Object.fromEntries(
        Object.entries(origin.deviceStarts).map(([deviceId, start]) => [
          deviceId,
          {
            x: Math.round(start.x + delta.x),
            y: Math.round(start.y + delta.y),
          },
        ]),
      );
      const nextPositions = {
        ...savedPositions,
        ...movedDevicePositions,
      };
      setSavedSectionPositions(nextSectionPositions);
      setSavedPositions(nextPositions);
      writeDiagramPositions(
        DIAGRAM_SECTION_POSITIONS_STORAGE_KEY,
        nextSectionPositions,
      );
      writeDiagramPositions(DIAGRAM_POSITIONS_STORAGE_KEY, nextPositions);
      sectionDragOriginRef.current = null;
      return;
    }
    if (node.type !== "device") return;
    setSavedPositions((current) => {
      const next = {
        ...current,
        [node.data.deviceId]: {
          x: Math.round(node.position.x),
          y: Math.round(node.position.y),
        },
      };
      writeDiagramPositions(DIAGRAM_POSITIONS_STORAGE_KEY, next);
      return next;
    });
  };

  function resetPositions() {
    setSavedPositions({});
    setSavedSectionPositions({});
    writeDiagramPositions(DIAGRAM_POSITIONS_STORAGE_KEY, {});
    writeDiagramPositions(DIAGRAM_SECTION_POSITIONS_STORAGE_KEY, {});
  }

  function toggleTypeFilter(type: string) {
    setTypeFilters((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="grid h-[calc(100vh-8.5rem)] min-h-[620px] place-items-center border-t border-[var(--border-subtle)] bg-[var(--surface-1)]">
        <div className="rk-panel rounded-[var(--radius-md)] p-5 text-sm text-[var(--text-secondary)]">
          Building topology diagram...
        </div>
      </div>
    );
  }

  if (model.nodes.length === 0) {
    return (
      <div className="grid h-[calc(100vh-8.5rem)] min-h-[620px] place-items-center border-t border-[var(--border-subtle)] bg-grid">
        <div className="rk-panel max-w-sm rounded-[var(--radius-md)] p-5 text-center">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            No devices to diagram
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
            Add devices, ports, and cables to build a draw-style topology map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="visualizer-diagram relative h-[calc(100vh-8.5rem)] min-h-[620px] overflow-hidden border-t border-[var(--border-subtle)] bg-[var(--surface-1)]">
      <ReactFlow<DiagramFlowNode, DiagramFlowEdge>
        nodes={nodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        onEdgeClick={(_, edge) => {
          setSelectedCableId(edge.id);
          setSelectedDeviceId(null);
        }}
        onPaneClick={() => {
          setSelectedDeviceId(null);
          setSelectedCableId(null);
        }}
        fitView
        fitViewOptions={{
          padding: 0.14,
          includeHiddenNodes: false,
          minZoom: 0.42,
          maxZoom: 1,
        }}
        minZoom={0.12}
        maxZoom={1.8}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        selectionOnDrag
        proOptions={{ hideAttribution: true }}
        className="bg-[var(--surface-1)]"
      >
        <Background color="var(--bg-grid)" gap={24} size={1} />
        <Controls
          position="bottom-left"
          className="visualizer-diagram-controls"
        />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          className="visualizer-diagram-minimap"
          maskColor="rgb(15 22 33 / 0.52)"
          nodeStrokeWidth={2}
          style={{ width: 160, height: 108 }}
          nodeColor={(node) =>
            node.type === "section"
              ? "var(--surface-4)"
              : "var(--accent-primary)"
          }
        />
        <Panel
          position="top-left"
          className="rk-panel flex max-w-[calc(100vw-28rem)] flex-col gap-2 rounded-[var(--radius-md)] px-3 py-2 text-xs shadow-[var(--shadow-card)]"
        >
          <div className="flex w-full items-center gap-3">
            <span className="grid size-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--accent-secondary-border)] bg-[var(--accent-secondary-soft)] text-[var(--accent-secondary)]">
              <GitBranch className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="rk-kicker">Diagram view</div>
              <div className="truncate text-[11px] text-[var(--text-secondary)]">
                {sections.length} sections | {visibleDeviceCount} shown
                {hiddenDeviceCount > 0 ? ` / ${hiddenDeviceCount} hidden` : ""} |{" "}
                {visibleCableCount} visible cables
              </div>
            </div>
            {Object.keys(savedPositions).length +
              Object.keys(savedSectionPositions).length >
              0 && (
              <Button variant="ghost" size="sm" onClick={resetPositions}>
                <RotateCcw className="size-3.5" />
                Reset positions
              </Button>
            )}
          </div>
          <div className="flex w-full max-w-full items-center gap-1.5 overflow-x-auto pb-0.5">
            <DiagramTypeChip
              active={typeFilters.size === 0}
              label={`All ${model.counts.devices}`}
              onClick={() => setTypeFilters(new Set())}
            />
            {model.deviceTypes.map((entry) => (
              <DiagramTypeChip
                key={entry.type}
                active={typeFilters.has(entry.type)}
                label={`${entry.label} ${entry.count}`}
                onClick={() => toggleTypeFilter(entry.type)}
              />
            ))}
          </div>
        </Panel>
        {(selectedNode || selectedCable) && (
          <Panel
            position="top-right"
            className="rk-panel max-h-[calc(100vh-11rem)] w-[360px] overflow-y-auto rounded-[var(--radius-md)] p-3 shadow-[var(--shadow-card)]"
          >
            {selectedNode && (
              <DiagramDeviceInspector
                node={selectedNode}
                model={model}
                connectedCables={connectedCables}
                virtualSwitches={virtualSwitches}
              />
            )}
            {selectedCable && <DiagramCableInspector cable={selectedCable} />}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

function DiagramDeviceCard({ data, selected }: NodeProps<DiagramDeviceNode>) {
  const shownPorts = data.ports.slice(0, 24);
  const hiddenPortCount = Math.max(0, data.ports.length - shownPorts.length);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[var(--radius-md)] border bg-[var(--surface-2)] px-3 py-2.5 text-left shadow-[0_14px_30px_rgb(0_0_0_/_0.18)] transition-colors",
        selected
          ? "border-[var(--accent-primary-border)] shadow-[var(--shadow-selected)]"
          : "border-[var(--border-default)]",
      )}
      style={{ width: DEVICE_NODE_WIDTH, height: DEVICE_NODE_HEIGHT }}
      title={`${data.hostname}${data.address ? ` | ${data.address}` : ""}`}
    >
      <DiagramHandles />
      <span
        className="absolute inset-y-2 left-1 w-0.5 rounded-full"
        style={{ background: data.stripeColor }}
      />
      <div className="flex min-w-0 items-start gap-2 pl-1.5">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)]"
          style={{ color: data.typeColor }}
        >
          <DeviceTypeIcon type={data.deviceType} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
              {data.hostname}
            </span>
            <StatusDot status={healthToDeviceStatus(data.health)} />
          </div>
          <div className="mt-0.5 truncate font-mono text-[9px] text-[var(--text-tertiary)]">
            {data.address}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[9px] uppercase tracking-[0.13em] text-[var(--text-muted)]">
            <span className="truncate">{data.typeLabel}</span>
            <span className="shrink-0">|</span>
            <span className="shrink-0">{data.portSummary}</span>
            <span className="shrink-0">|</span>
            <span className="shrink-0">{data.connectionCount} links</span>
          </div>
        </div>
        <Link
          to={`/devices/${data.deviceId}`}
          className="nodrag nopan grid size-7 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
          title="Open device"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="size-3.5" />
        </Link>
      </div>
      <div className="absolute bottom-2.5 left-4 right-3 flex items-center justify-between gap-3">
        <div className="flex max-w-[188px] flex-wrap gap-1">
          {shownPorts.map((port) => (
            <span
              key={port.id}
              className="size-1.5 rounded-[2px] border"
              style={{
                background: port.linked
                  ? port.color || "var(--accent-secondary)"
                  : "transparent",
                borderColor: port.linked
                  ? port.color || "var(--accent-secondary)"
                  : "var(--border-strong)",
              }}
            />
          ))}
          {hiddenPortCount > 0 && (
            <span className="font-mono text-[8px] text-[var(--text-muted)]">
              +{hiddenPortCount}
            </span>
          )}
        </div>
        <span className="max-w-[78px] truncate text-right font-mono text-[8px] text-[var(--text-muted)]">
          {data.sectionLabel}
        </span>
      </div>
    </div>
  );
}

function DiagramHandles() {
  return (
    <>
      {(["Left", "Right", "Top", "Bottom"] as const).map((side) => {
        const position = Position[side];
        const id = side.toLowerCase();
        return (
          <span key={id}>
            <Handle
              type="target"
              position={position}
              id={`target-${id}`}
              className="visualizer-diagram-handle"
            />
            <Handle
              type="source"
              position={position}
              id={`source-${id}`}
              className="visualizer-diagram-handle"
            />
          </span>
        );
      })}
    </>
  );
}

function DiagramSectionCard({ data }: NodeProps<DiagramSectionNode>) {
  return (
    <div
      className="diagram-section-card h-full w-full rounded-[var(--radius-lg)] border bg-[color-mix(in_srgb,var(--surface-2)_58%,transparent)] shadow-[0_1px_0_var(--edge-highlight)_inset]"
      style={{
        borderColor: "var(--border-default)",
        boxShadow: `0 0 0 1px var(--edge-highlight) inset, 0 0 0 1px ${data.accent}22`,
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="min-w-0">
          <div className="rk-kicker truncate">{data.subtitle}</div>
          <div className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">
            {data.title}
          </div>
        </div>
        <div
          className="rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em]"
          style={{
            borderColor: data.accent,
            color: data.accent,
            background: "color-mix(in srgb, var(--surface-1) 82%, transparent)",
          }}
        >
          {data.countLabel}
        </div>
      </div>
    </div>
  );
}

function DiagramTypeChip({
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
      className={cn(
        "nodrag nopan h-7 shrink-0 rounded-[var(--radius-sm)] border px-2.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors",
        active
          ? "border-[var(--accent-primary-border)] bg-[var(--accent-primary-soft)] text-[var(--accent-primary)]"
          : "border-[var(--border-default)] bg-[color-mix(in_srgb,var(--surface-1)_68%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
      )}
    >
      {label}
    </button>
  );
}

function DiagramDeviceInspector({
  node,
  model,
  connectedCables,
  virtualSwitches,
}: {
  node: VisualizerNode;
  model: VisualizerModel;
  connectedCables: VisualizerCable[];
  virtualSwitches: VirtualSwitch[];
}) {
  const virtualRows = buildVirtualNetworkRows(node, model, virtualSwitches);
  return (
    <div>
      <div className="rk-kicker">Device</div>
      <div className="mt-2 flex items-start gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)]"
          style={{ color: node.typeColor }}
        >
          <DeviceTypeIcon type={node.device.deviceType} className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {node.device.hostname}
          </div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">
            {typeLabel(node.device.deviceType)}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <InspectorValue label="Address" value={formatNodeAddress(node)} mono />
        <InspectorValue
          label="Ports"
          value={`${node.portSummary.linked}/${node.portSummary.total} linked`}
        />
        <InspectorValue label="Rack" value={node.rackName || "Loose"} />
        <InspectorValue label="Room" value={node.roomName || "Unassigned"} />
      </div>
      {virtualRows.length > 0 && (
        <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2">
            <div className="rk-kicker">Virtual NICs</div>
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {virtualRows.length}
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            <div className="space-y-1.5">
              {virtualRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-primary)]">
                      {row.device ? (
                        <Link
                          to={`/devices/${row.device.id}`}
                          className="transition-colors hover:text-[var(--accent-primary)]"
                        >
                          {row.device.hostname}
                        </Link>
                      ) : (
                        node.device.hostname
                      )}
                    </span>
                    <span className="font-mono text-[9px] uppercase text-[var(--text-muted)]">
                      {row.role}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-[var(--text-tertiary)]">
                    {row.port ? (
                      <Link
                        to={`/ports?deviceId=${row.port.deviceId}&portId=${row.port.id}`}
                        className="min-w-0 truncate text-[var(--accent-secondary)] transition-colors hover:text-[var(--accent-secondary-hover)]"
                      >
                        {formatPortLabel(row.port, { includeFace: true })}
                      </Link>
                    ) : (
                      <span className="text-[var(--text-muted)]">
                        no NIC documented
                      </span>
                    )}
                    <span className="text-[var(--text-muted)]">{"->"}</span>
                    <span className="min-w-0 truncate text-[var(--text-primary)]">
                      {row.virtualSwitch?.name ?? "No vSwitch"}
                    </span>
                  </div>
                  {row.host && row.host.id !== node.device.id && (
                    <div className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                      Host{" "}
                      <Link
                        to={`/devices/${row.host.id}`}
                        className="text-[var(--text-secondary)] transition-colors hover:text-[var(--accent-primary)]"
                      >
                        {row.host.hostname}
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2">
          <div className="rk-kicker">Connected cables</div>
          <span className="font-mono text-[10px] text-[var(--text-muted)]">
            {connectedCables.length}
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {connectedCables.length === 0 ? (
            <div className="px-1 py-2 text-xs text-[var(--text-secondary)]">
              No visible cable links for the current filter.
            </div>
          ) : (
            <div className="space-y-1.5">
              {connectedCables.map((cable) => {
                const peer =
                  cable.fromDevice?.id === node.device.id
                    ? cable.toDevice
                    : cable.fromDevice;
                const ownPort =
                  cable.fromDevice?.id === node.device.id
                    ? cable.fromPort
                    : cable.toPort;
                const peerPort =
                  cable.fromDevice?.id === node.device.id
                    ? cable.toPort
                    : cable.fromPort;
                return (
                  <div
                    key={cable.link.id}
                    className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: cable.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-primary)]">
                        {peer?.hostname ?? "Unknown device"}
                      </span>
                      <span className="font-mono text-[9px] uppercase text-[var(--text-muted)]">
                        {cable.link.cableType || "Cable"}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-tertiary)]">
                      {ownPort?.name ?? "port"}
                      {" -> "}
                      {peerPort?.name ?? "port"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <Link
        to={`/devices/${node.device.id}`}
        className="mt-3 inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
      >
        <ExternalLink className="size-3.5" />
        Open device
      </Link>
    </div>
  );
}

function DiagramCableInspector({ cable }: { cable: VisualizerCable }) {
  return (
    <div>
      <div className="rk-kicker">Cable</div>
      <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ background: cable.color }}
        />
        {cable.link.cableType || "Cable"}
      </div>
      <div className="mt-3 grid gap-2">
        <InspectorValue
          label="From"
          value={`${cable.fromDevice?.hostname ?? "Unknown"} / ${
            cable.fromPort?.name ?? "port"
          }`}
        />
        <InspectorValue
          label="To"
          value={`${cable.toDevice?.hostname ?? "Unknown"} / ${
            cable.toPort?.name ?? "port"
          }`}
        />
        <InspectorValue label="Length" value={cable.link.cableLength} />
      </div>
    </div>
  );
}

function InspectorValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2">
      <div className="rk-kicker">{label}</div>
      <div
        className={cn(
          "mt-1 min-h-4 break-words text-xs text-[var(--text-primary)]",
          mono && "font-mono",
        )}
      >
        {value || "-"}
      </div>
    </div>
  );
}

function buildDiagramLayout(
  model: VisualizerModel,
  cableType: string,
  healthOverlay: boolean,
  typeFilters: Set<string>,
  savedPositions: Record<string, XYPosition>,
  savedSectionPositions: Record<string, XYPosition>,
  wifiContext: DiagramWifiContext,
): DiagramLayoutResult {
  const visibleNodes = model.nodes.filter(
    (node) =>
      typeFilters.size === 0 || typeFilters.has(node.device.deviceType),
  );
  const visibleDeviceIds = new Set(
    visibleNodes.map((node) => node.device.id),
  );
  const visibleCables = model.cables
    .filter((cable) => cableIsVisible(cable, cableType))
    .filter((cable) => cable.fromDevice && cable.toDevice)
    .filter((cable) => cableHasVisibleEndpoints(cable, visibleDeviceIds));
  const connectionCountByDeviceId = buildConnectionCounts(visibleCables);
  const sections = positionSections(
    buildSections(model, wifiContext, visibleNodes),
    savedSectionPositions,
  );
  const flowNodes: DiagramFlowNode[] = [];
  const nodeGeometryById = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();

  for (const section of sections) {
    flowNodes.push({
      id: section.id,
      type: "section",
      position: { x: section.x, y: section.y },
      data: {
        accent: section.accent,
        countLabel: `${section.nodes.length} device${
          section.nodes.length === 1 ? "" : "s"
        }`,
        subtitle: section.subtitle,
        title: section.title,
      },
      selectable: false,
      draggable: true,
      zIndex: 0,
      style: {
        width: section.width,
        height: section.height,
      },
    });

    section.nodes.forEach((node, index) => {
      const column = index % section.columns;
      const row = Math.floor(index / section.columns);
      const rowGap =
        section.layout === "stack" ? STACKED_DEVICE_GAP_Y : DEVICE_GAP_Y;
      const position = savedPositions[node.device.id] ?? {
        x:
          section.x +
          SECTION_PADDING_X +
          column * (DEVICE_NODE_WIDTH + DEVICE_GAP_X),
        y:
          section.y +
          SECTION_HEADER_HEIGHT +
          row * (DEVICE_NODE_HEIGHT + rowGap),
      };

      flowNodes.push({
        id: node.device.id,
        type: "device",
        position,
        data: {
          address: formatNodeAddress(node),
          deviceId: node.device.id,
          deviceType: node.device.deviceType,
          health: node.health,
          hostname: node.device.hostname,
          connectionCount: connectionCountByDeviceId[node.device.id] ?? 0,
          portSummary: `${node.portSummary.linked}/${node.portSummary.total}`,
          ports: node.ports.map((port) => ({
            id: port.port.id,
            linked: port.linked,
            color: port.color,
          })),
          sectionLabel: shortSectionLabel(section.title),
          stripeColor: nodeStripeColor(node, healthOverlay),
          typeColor: node.typeColor,
          typeLabel: typeLabel(node.device.deviceType),
        },
        zIndex: 2,
      });
      nodeGeometryById.set(node.device.id, {
        x: position.x,
        y: position.y,
        width: DEVICE_NODE_WIDTH,
        height: DEVICE_NODE_HEIGHT,
      });
    });
  }

  const showLabels = visibleCables.length <= EDGE_LABEL_LIMIT;
  const flowEdges = visibleCables
    .map((cable): DiagramFlowEdge => {
      const offline = !cable.up || cable.unknown;
      const snmpUp = cable.snmpVerified && cable.up && !offline;
      const sourceGeometry = cable.fromDevice
        ? nodeGeometryById.get(cable.fromDevice.id)
        : undefined;
      const targetGeometry = cable.toDevice
        ? nodeGeometryById.get(cable.toDevice.id)
        : undefined;
      const handles = chooseEdgeHandles(sourceGeometry, targetGeometry);
      return {
        id: cable.link.id,
        source: cable.fromDevice?.id ?? "",
        sourceHandle: `source-${handles.source}`,
        target: cable.toDevice?.id ?? "",
        targetHandle: `target-${handles.target}`,
        type: "smoothstep",
        data: { cableId: cable.link.id },
        label: showLabels ? cable.link.cableType || undefined : undefined,
        labelShowBg: true,
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 4,
        labelBgStyle: {
          fill: "var(--surface-2)",
          fillOpacity: 0.92,
          stroke: "var(--border-subtle)",
        },
        labelStyle: {
          fill: "var(--text-tertiary)",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
        },
        style: {
          stroke: cable.color,
          strokeWidth: cable.crossZone ? 3 : snmpUp ? 2.75 : 2.25,
          strokeOpacity: offline ? 0.38 : snmpUp ? 0.92 : 0.78,
          strokeDasharray: offline ? "8 7" : undefined,
        },
      };
    });

  return {
    flowNodes,
    flowEdges,
    sections,
    visibleDeviceCount: visibleNodes.length,
    hiddenDeviceCount: model.nodes.length - visibleNodes.length,
    visibleDeviceIds,
    visibleCableCount: flowEdges.length,
  };
}

function buildSections(
  model: VisualizerModel,
  wifiContext: DiagramWifiContext,
  nodes: VisualizerNode[],
) {
  const sectionsById = new Map<string, DiagramSection>();

  for (const node of [...nodes].sort(compareNodes)) {
    const descriptor = describeSection(node, model, wifiContext);
    const existing = sectionsById.get(descriptor.id);
    if (existing) {
      existing.nodes.push(node);
      continue;
    }
    sectionsById.set(descriptor.id, {
      ...descriptor,
      nodes: [node],
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      columns: 1,
    });
  }

  return [...sectionsById.values()].sort(
    (a, b) =>
      a.sortGroup - b.sortGroup ||
      a.title.localeCompare(b.title, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

function describeSection(
  node: VisualizerNode,
  model: VisualizerModel,
  wifiContext: DiagramWifiContext,
) {
  const wifiAssociation = wifiContext.associationByClientId[node.device.id];
  if (wifiAssociation) {
    const accessPoint = model.deviceById[wifiAssociation.apDeviceId];
    const ssid = wifiAssociation.ssidId
      ? wifiContext.ssidById[wifiAssociation.ssidId]
      : undefined;
    return {
      id: `wifi:${wifiAssociation.apDeviceId}:${
        wifiAssociation.ssidId ?? "unassigned"
      }`,
      title: ssid?.name ?? "Unassigned SSID",
      subtitle: [
        "WiFi",
        accessPoint?.hostname,
        wifiAssociation.band?.replace("ghz", " GHz"),
      ]
        .filter(Boolean)
        .join(" / "),
      accent:
        normalizeColorToCss(ssid?.color) ??
        (accessPoint ? typeColor(accessPoint.deviceType) : typeColor("ap")),
      layout: "grid" as const,
      sortGroup: 2,
    };
  }

  const parent = node.device.parentDeviceId
    ? model.deviceById[node.device.parentDeviceId]
    : null;
  if (parent) {
    const parentNode = model.nodesByDeviceId[parent.id];
    return {
      id: `parent:${parent.id}`,
      title: parent.hostname,
      subtitle:
        parent.deviceType === "rack_shelf"
          ? "Shelf / stacked devices"
          : "Hosted child devices",
      accent: parentNode?.typeColor ?? node.typeColor,
      layout: (parent.deviceType === "rack_shelf" ? "stack" : "grid") as
        | "stack"
        | "grid",
      sortGroup: 1,
    };
  }

  if (node.rackId) {
    return {
      id: `rack:${node.rackId}`,
      title: node.rackName || "Rack",
      subtitle: node.roomName ? `${node.roomName} / rack` : "Rack inventory",
      accent: "var(--accent-secondary)",
      layout: "grid" as const,
      sortGroup: 0,
    };
  }

  if (node.roomId) {
    return {
      id: `room:${node.roomId}`,
      title: node.roomName || "Room",
      subtitle: "Room inventory",
      accent: "var(--accent-primary)",
      layout: "grid" as const,
      sortGroup: 3,
    };
  }

  return {
    id: "loose",
    title: "Loose / unassigned",
    subtitle: "No rack or room placement",
    accent: "var(--neutral)",
    layout: "grid" as const,
    sortGroup: 4,
  };
}

function positionSections(
  sections: DiagramSection[],
  savedSectionPositions: Record<string, XYPosition>,
) {
  let x = SECTION_START_X;
  let y = SECTION_START_Y;
  let rowHeight = 0;

  return sections.map((section) => {
    const columns = sectionColumnCount(section);
    const rows = Math.ceil(section.nodes.length / columns);
    const gapY =
      section.layout === "stack" ? STACKED_DEVICE_GAP_Y : DEVICE_GAP_Y;
    const width =
      SECTION_PADDING_X * 2 +
      columns * DEVICE_NODE_WIDTH +
      Math.max(0, columns - 1) * DEVICE_GAP_X;
    const height =
      SECTION_HEADER_HEIGHT +
      SECTION_PADDING_BOTTOM +
      rows * DEVICE_NODE_HEIGHT +
      Math.max(0, rows - 1) * gapY;

    if (x > SECTION_START_X && x + width > ROW_MAX_WIDTH) {
      x = SECTION_START_X;
      y += rowHeight + SECTION_GAP_Y;
      rowHeight = 0;
    }

    const savedPosition = savedSectionPositions[section.id];
    const positioned = {
      ...section,
      x: savedPosition?.x ?? x,
      y: savedPosition?.y ?? y,
      width,
      height,
      columns,
    };
    x += width + SECTION_GAP_X;
    rowHeight = Math.max(rowHeight, height);
    return positioned;
  });
}

function buildDiagramWifiContext(
  wifiSsids: WifiSsid[],
  wifiAccessPoints: WifiAccessPoint[],
  wifiClientAssociations: WifiClientAssociation[],
): DiagramWifiContext {
  return {
    accessPointByDeviceId: Object.fromEntries(
      wifiAccessPoints.map((accessPoint) => [
        accessPoint.deviceId,
        accessPoint,
      ]),
    ),
    associationByClientId: Object.fromEntries(
      wifiClientAssociations.map((association) => [
        association.clientDeviceId,
        association,
      ]),
    ),
    ssidById: Object.fromEntries(wifiSsids.map((ssid) => [ssid.id, ssid])),
  };
}

function buildConnectionCounts(cables: VisualizerCable[]) {
  return cables.reduce<Record<string, number>>((acc, cable) => {
    if (cable.fromDevice) {
      acc[cable.fromDevice.id] = (acc[cable.fromDevice.id] ?? 0) + 1;
    }
    if (cable.toDevice) {
      acc[cable.toDevice.id] = (acc[cable.toDevice.id] ?? 0) + 1;
    }
    return acc;
  }, {});
}

function buildVirtualNetworkRows(
  node: VisualizerNode,
  model: VisualizerModel,
  virtualSwitches: VirtualSwitch[],
): VirtualNetworkRow[] {
  const switchesById = Object.fromEntries(
    virtualSwitches.map((virtualSwitch) => [virtualSwitch.id, virtualSwitch]),
  );
  const hostSwitchIds = new Set(
    virtualSwitches
      .filter((virtualSwitch) => virtualSwitch.hostDeviceId === node.device.id)
      .map((virtualSwitch) => virtualSwitch.id),
  );
  const rows: VirtualNetworkRow[] = [];
  const selectedPorts = model.portsByDeviceId[node.device.id] ?? [];

  selectedPorts
    .filter((port) => port.virtualSwitchId)
    .forEach((port) => {
      const virtualSwitch = port.virtualSwitchId
        ? switchesById[port.virtualSwitchId]
        : undefined;
      rows.push({
        id: `own:${port.id}`,
        device: node.device,
        host: virtualSwitch
          ? model.deviceById[virtualSwitch.hostDeviceId]
          : undefined,
        port,
        role: ["vm", "container"].includes(node.device.deviceType)
          ? "guest nic"
          : "uplink",
        virtualSwitch,
      });
    });

  const childDevices = Object.values(model.deviceById)
    .filter((device) => device.parentDeviceId === node.device.id)
    .filter((device) => ["vm", "container"].includes(device.deviceType))
    .sort((a, b) =>
      a.hostname.localeCompare(b.hostname, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );

  for (const child of childDevices) {
    const childPorts = (model.portsByDeviceId[child.id] ?? []).filter(
      (port) =>
        port.kind === "virtual" ||
        (port.virtualSwitchId && hostSwitchIds.has(port.virtualSwitchId)),
    );
    if (childPorts.length === 0) {
      rows.push({
        id: `child:${child.id}:missing`,
        device: child,
        host: node.device,
        role: child.deviceType,
      });
      continue;
    }
    childPorts.forEach((port) => {
      const virtualSwitch = port.virtualSwitchId
        ? switchesById[port.virtualSwitchId]
        : undefined;
      rows.push({
        id: `child:${child.id}:${port.id}`,
        device: child,
        host: node.device,
        port,
        role: child.deviceType,
        virtualSwitch,
      });
    });
  }

  return rows;
}

function chooseEdgeHandles(
  source?: { x: number; y: number; width: number; height: number },
  target?: { x: number; y: number; width: number; height: number },
) {
  if (!source || !target) {
    return { source: "right", target: "left" };
  }
  const sourceCenter = {
    x: source.x + source.width / 2,
    y: source.y + source.height / 2,
  };
  const targetCenter = {
    x: target.x + target.width / 2,
    y: target.y + target.height / 2,
  };
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { source: "right", target: "left" }
      : { source: "left", target: "right" };
  }
  return dy >= 0
    ? { source: "bottom", target: "top" }
    : { source: "top", target: "bottom" };
}

function compareNodes(a: VisualizerNode, b: VisualizerNode) {
  const roomCompare = (a.roomName || "").localeCompare(
    b.roomName || "",
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
  if (roomCompare !== 0) return roomCompare;
  const rackCompare = (a.rackName || "").localeCompare(
    b.rackName || "",
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    },
  );
  if (rackCompare !== 0) return rackCompare;
  const startA = a.device.startU ?? -1;
  const startB = b.device.startU ?? -1;
  if (startA !== startB) return startB - startA;
  const ipA = nodeSortIpValue(a);
  const ipB = nodeSortIpValue(b);
  if (ipA != null && ipB != null && ipA !== ipB) return ipA - ipB;
  return a.device.hostname.localeCompare(b.device.hostname, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function nodeSortIpValue(node: VisualizerNode) {
  return (
    parseSortableIp(node.device.managementIp) ??
    parseSortableIp(node.device.displayName) ??
    parseSortableIp(node.device.hostname)
  );
}

function parseSortableIp(value?: string | null) {
  if (!value) return null;
  const match = value.match(
    /(?:^|[^\d])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})(?:[^\d]|$)/,
  );
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return (
    octets[0] * 256 ** 3 +
    octets[1] * 256 ** 2 +
    octets[2] * 256 +
    octets[3]
  );
}

function sectionColumnCount(section: DiagramSection) {
  if (section.layout === "stack") return 1;
  if (section.nodes.length <= 1) return 1;
  if (section.nodes.length <= 4) return 2;
  return Math.max(2, Math.min(4, Math.ceil(Math.sqrt(section.nodes.length))));
}

function cableIsVisible(cable: VisualizerCable, cableType: string) {
  return (
    cableType === "all" || (cable.link.cableType || "Unknown") === cableType
  );
}

function cableHasVisibleEndpoints(
  cable: VisualizerCable,
  visibleDeviceIds: Set<string>,
) {
  return Boolean(
    cable.fromDevice &&
      cable.toDevice &&
      visibleDeviceIds.has(cable.fromDevice.id) &&
      visibleDeviceIds.has(cable.toDevice.id),
  );
}

function formatNodeAddress(node: VisualizerNode) {
  return formatDeviceAddress(
    {
      managementIp: node.device.managementIp,
      macAddress: node.macAddress,
    },
    typeLabel(node.device.deviceType),
  );
}

function shortSectionLabel(label: string) {
  return label.length > 12 ? `${label.slice(0, 11)}...` : label;
}

function healthToDeviceStatus(health: VisualizerHealth) {
  return health === "offline" ||
    health === "warning" ||
    health === "online" ||
    health === "unknown"
    ? health
    : "unknown";
}

function readDiagramPositions(key: string): Record<string, XYPosition> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => {
        if (!value || typeof value !== "object") return false;
        const point = value as Partial<XYPosition>;
        return Number.isFinite(point.x) && Number.isFinite(point.y);
      }),
    ) as Record<string, XYPosition>;
  } catch {
    return {};
  }
}

function writeDiagramPositions(key: string, value: Record<string, XYPosition>) {
  try {
    if (Object.keys(value).length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage can be unavailable in hardened browser profiles.
  }
}
