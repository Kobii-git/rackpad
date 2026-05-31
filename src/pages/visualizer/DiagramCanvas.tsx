import { useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";
import { nodeStripeColor, typeLabel } from "./model";
import type {
  VisualizerCable,
  VisualizerHealth,
  VisualizerModel,
  VisualizerNode,
} from "./types";

const DIAGRAM_POSITIONS_STORAGE_KEY = "rackpad.visualizer.diagram-positions";
const SECTION_PADDING_X = 24;
const SECTION_PADDING_BOTTOM = 24;
const SECTION_HEADER_HEIGHT = 76;
const SECTION_GAP_X = 40;
const SECTION_GAP_Y = 40;
const SECTION_START_X = 36;
const SECTION_START_Y = 36;
const ROW_MAX_WIDTH = 1600;
const DEVICE_NODE_WIDTH = 252;
const DEVICE_NODE_HEIGHT = 76;
const DEVICE_GAP_X = 18;
const DEVICE_GAP_Y = 16;

interface DiagramCanvasProps {
  model: VisualizerModel;
  loading: boolean;
  healthOverlay: boolean;
  cableType: string;
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
  visibleCableCount: number;
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
}: DiagramCanvasProps) {
  const [savedPositions, setSavedPositions] = useState<
    Record<string, XYPosition>
  >(() => readDiagramPositions(DIAGRAM_POSITIONS_STORAGE_KEY));
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const { flowNodes, flowEdges, sections, visibleCableCount } = useMemo(
    () => buildDiagramLayout(model, cableType, healthOverlay, savedPositions),
    [model, cableType, healthOverlay, savedPositions],
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

  const selectedNode = selectedDeviceId
    ? model.nodesByDeviceId[selectedDeviceId]
    : null;
  const selectedCable = selectedCableId
    ? model.cableById[selectedCableId]
    : null;

  const handleNodeClick: NodeMouseHandler<DiagramFlowNode> = (_, node) => {
    if (node.type !== "device") return;
    setSelectedDeviceId(node.data.deviceId);
    setSelectedCableId(null);
  };

  const handleNodeDragStop: OnNodeDrag<DiagramFlowNode> = (_, node) => {
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
    writeDiagramPositions(DIAGRAM_POSITIONS_STORAGE_KEY, {});
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
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
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
        fitViewOptions={{ padding: 0.18, includeHiddenNodes: false }}
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
          className="rk-panel flex max-w-[calc(100vw-28rem)] items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-xs shadow-[var(--shadow-card)]"
        >
          <span className="grid size-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--accent-secondary-border)] bg-[var(--accent-secondary-soft)] text-[var(--accent-secondary)]">
            <GitBranch className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="rk-kicker">Diagram view</div>
            <div className="truncate text-[11px] text-[var(--text-secondary)]">
              {sections.length} sections | {model.counts.devices} devices |{" "}
              {visibleCableCount} visible cables
            </div>
          </div>
          {Object.keys(savedPositions).length > 0 && (
            <Button variant="ghost" size="sm" onClick={resetPositions}>
              <RotateCcw className="size-3.5" />
              Reset positions
            </Button>
          )}
        </Panel>
        {(selectedNode || selectedCable) && (
          <Panel
            position="top-right"
            className="rk-panel w-80 rounded-[var(--radius-md)] p-3 shadow-[var(--shadow-card)]"
          >
            {selectedNode && <DiagramDeviceInspector node={selectedNode} />}
            {selectedCable && <DiagramCableInspector cable={selectedCable} />}
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

function DiagramDeviceCard({ data, selected }: NodeProps<DiagramDeviceNode>) {
  const shownPorts = data.ports.slice(0, 18);
  const hiddenPortCount = Math.max(0, data.ports.length - shownPorts.length);

  return (
    <div
      className={cn(
        "relative h-[76px] w-[252px] overflow-hidden rounded-[var(--radius-md)] border bg-[var(--surface-2)] px-3 py-2 text-left shadow-[0_14px_30px_rgb(0_0_0_/_0.18)] transition-colors",
        selected
          ? "border-[var(--accent-primary-border)] shadow-[var(--shadow-selected)]"
          : "border-[var(--border-default)]",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="visualizer-diagram-handle"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className="visualizer-diagram-handle"
      />
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
            <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
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
      <div className="absolute bottom-2 left-4 right-3 flex items-center justify-between gap-3">
        <div className="flex max-w-[150px] flex-wrap gap-1">
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

function DiagramSectionCard({ data }: NodeProps<DiagramSectionNode>) {
  return (
    <div
      className="h-full w-full rounded-[var(--radius-lg)] border bg-[color-mix(in_srgb,var(--surface-2)_58%,transparent)] shadow-[0_1px_0_var(--edge-highlight)_inset]"
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

function DiagramDeviceInspector({ node }: { node: VisualizerNode }) {
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
  savedPositions: Record<string, XYPosition>,
): DiagramLayoutResult {
  const sections = positionSections(buildSections(model));
  const flowNodes: DiagramFlowNode[] = [];

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
      draggable: false,
      zIndex: 0,
      style: {
        width: section.width,
        height: section.height,
      },
    });

    section.nodes.forEach((node, index) => {
      const column = index % section.columns;
      const row = Math.floor(index / section.columns);
      const position = savedPositions[node.device.id] ?? {
        x:
          section.x +
          SECTION_PADDING_X +
          column * (DEVICE_NODE_WIDTH + DEVICE_GAP_X),
        y:
          section.y +
          SECTION_HEADER_HEIGHT +
          row * (DEVICE_NODE_HEIGHT + DEVICE_GAP_Y),
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
    });
  }

  const flowEdges = model.cables
    .filter((cable) => cableIsVisible(cable, cableType))
    .filter((cable) => cable.fromDevice && cable.toDevice)
    .map((cable): DiagramFlowEdge => {
      const offline = !cable.up || cable.unknown;
      return {
        id: cable.link.id,
        source: cable.fromDevice?.id ?? "",
        sourceHandle: "out",
        target: cable.toDevice?.id ?? "",
        targetHandle: "in",
        type: "smoothstep",
        data: { cableId: cable.link.id },
        label: cable.link.cableType || undefined,
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
          strokeWidth: cable.crossZone ? 3 : 2.25,
          strokeOpacity: offline ? 0.38 : 0.78,
          strokeDasharray: offline ? "8 7" : undefined,
        },
      };
    });

  return {
    flowNodes,
    flowEdges,
    sections,
    visibleCableCount: flowEdges.length,
  };
}

function buildSections(model: VisualizerModel) {
  const sectionsById = new Map<string, DiagramSection>();

  for (const node of [...model.nodes].sort(compareNodes)) {
    const descriptor = describeSection(node, model);
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

function describeSection(node: VisualizerNode, model: VisualizerModel) {
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
      sortGroup: 1,
    };
  }

  if (node.rackId) {
    return {
      id: `rack:${node.rackId}`,
      title: node.rackName || "Rack",
      subtitle: node.roomName ? `${node.roomName} / rack` : "Rack inventory",
      accent: "var(--accent-secondary)",
      sortGroup: 0,
    };
  }

  if (node.roomId) {
    return {
      id: `room:${node.roomId}`,
      title: node.roomName || "Room",
      subtitle: "Room inventory",
      accent: "var(--accent-primary)",
      sortGroup: 2,
    };
  }

  return {
    id: "loose",
    title: "Loose / unassigned",
    subtitle: "No rack or room placement",
    accent: "var(--neutral)",
    sortGroup: 3,
  };
}

function positionSections(sections: DiagramSection[]) {
  let x = SECTION_START_X;
  let y = SECTION_START_Y;
  let rowHeight = 0;

  return sections.map((section) => {
    const columns = Math.max(
      1,
      Math.min(4, Math.ceil(Math.sqrt(section.nodes.length))),
    );
    const rows = Math.ceil(section.nodes.length / columns);
    const width =
      SECTION_PADDING_X * 2 +
      columns * DEVICE_NODE_WIDTH +
      Math.max(0, columns - 1) * DEVICE_GAP_X;
    const height =
      SECTION_HEADER_HEIGHT +
      SECTION_PADDING_BOTTOM +
      rows * DEVICE_NODE_HEIGHT +
      Math.max(0, rows - 1) * DEVICE_GAP_Y;

    if (x > SECTION_START_X && x + width > ROW_MAX_WIDTH) {
      x = SECTION_START_X;
      y += rowHeight + SECTION_GAP_Y;
      rowHeight = 0;
    }

    const positioned = {
      ...section,
      x,
      y,
      width,
      height,
      columns,
    };
    x += width + SECTION_GAP_X;
    rowHeight = Math.max(rowHeight, height);
    return positioned;
  });
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
  return a.device.hostname.localeCompare(b.device.hostname, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function cableIsVisible(cable: VisualizerCable, cableType: string) {
  return (
    cableType === "all" || (cable.link.cableType || "Unknown") === cableType
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
