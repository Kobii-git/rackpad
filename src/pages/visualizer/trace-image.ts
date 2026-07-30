import { normalizeColorToCss } from "@/lib/utils";
import type { Port, PortLink } from "@/lib/types";
import type { TraceResult, VisualizerModel } from "./types";

const IMAGE_WIDTH = 640;
const IMAGE_PADDING = 24;
const CARD_WIDTH = IMAGE_WIDTH - IMAGE_PADDING * 2;
const CARD_HEADER_PADDING = 20;
const PORT_HEIGHT = 44;
const INTERNAL_CONNECTION_HEIGHT = 36;
const BLOCK_GAP = 14;
const FOOTER_HEIGHT = 58;
const MAX_CANVAS_DIMENSION = 16_384;

export type TraceImageTheme = "dark" | "light";

interface TraceImagePalette {
  background: string;
  card: string;
  cardBorder: string;
  connectorCard: string;
  connectorDetail: string;
  connectorTitle: string;
  connectorTrack: string;
  defaultCable: string;
  footerDivider: string;
  footerText: string;
  iconBackground: string;
  iconBorder: string;
  iconStroke: string;
  patchBorder: string;
  patchLine: string;
  patchPill: string;
  patchText: string;
  portBackground: string;
  portBorder: string;
  portText: string;
  primaryText: string;
  secondaryText: string;
  tertiaryText: string;
  deviceAccents: Record<string, string>;
}

const TRACE_IMAGE_PALETTES: Record<TraceImageTheme, TraceImagePalette> = {
  light: {
    background: "#f8fafc",
    card: "#ffffff",
    cardBorder: "#94a3b8",
    connectorCard: "#ffffff",
    connectorDetail: "#475569",
    connectorTitle: "#0f172a",
    connectorTrack: "#334155",
    defaultCable: "#0f766e",
    footerDivider: "#cbd5e1",
    footerText: "#334155",
    iconBackground: "#f8fafc",
    iconBorder: "#cbd5e1",
    iconStroke: "#334155",
    patchBorder: "#c4b5fd",
    patchLine: "#7c3aed",
    patchPill: "#ffffff",
    patchText: "#5b21b6",
    portBackground: "#f1f5f9",
    portBorder: "#cbd5e1",
    portText: "#1e293b",
    primaryText: "#0f172a",
    secondaryText: "#334155",
    tertiaryText: "#64748b",
    deviceAccents: {
      switch: "#0284c7",
      patch_panel: "#7c3aed",
      ap: "#dc2626",
      firewall: "#ea580c",
      server: "#d97706",
      endpoint: "#16a34a",
      default: "#0f766e",
    },
  },
  dark: {
    background: "#070a0f",
    card: "#141d2c",
    cardBorder: "#526071",
    connectorCard: "#141d2c",
    connectorDetail: "#bdc7d2",
    connectorTitle: "#edf2f7",
    connectorTrack: "#637082",
    defaultCable: "#4dc8d7",
    footerDivider: "#334155",
    footerText: "#bdc7d2",
    iconBackground: "#0c121b",
    iconBorder: "#334155",
    iconStroke: "#bdc7d2",
    patchBorder: "#8f8cff",
    patchLine: "#a78bfa",
    patchPill: "#1c283c",
    patchText: "#ddd6fe",
    portBackground: "#0c121b",
    portBorder: "#334155",
    portText: "#edf2f7",
    primaryText: "#edf2f7",
    secondaryText: "#bdc7d2",
    tertiaryText: "#8d9aaa",
    deviceAccents: {
      switch: "#4dc8d7",
      patch_panel: "#a78bfa",
      ap: "#de6666",
      firewall: "#f29d38",
      server: "#ead043",
      endpoint: "#59c36a",
      default: "#41c7b5",
    },
  },
};

export interface TraceImageLabels {
  cable: string;
  direction: "ltr" | "rtl";
  front: string;
  rear: string;
  internalPassThrough: string;
  length: string;
  rack: string;
  room: string;
  unknown: string;
  deviceType: (type: string) => string;
  hops: (count: number) => string;
}

export interface TraceImageExport {
  filename: string;
  height: number;
  svg: string;
  width: number;
}

interface TraceImagePort {
  id: string;
  label: string;
}

interface TraceImageDeviceBlock {
  kind: "device";
  deviceId: string;
  deviceType: string;
  title: string;
  detail: string;
  placement: string;
  accent: string;
  ports: TraceImagePort[];
  internalAfterPortIds: Set<string>;
}

interface TraceImageConnectorBlock {
  kind: "connector";
  color: string;
  detail: string;
  label: string;
}

type TraceImageBlock = TraceImageDeviceBlock | TraceImageConnectorBlock;

interface TraceImageBlockLayout {
  block: TraceImageBlock;
  detailLines: string[];
  height: number;
  placementLines: string[];
  titleLines: string[];
}

export function buildTraceImageSvg(
  model: VisualizerModel,
  result: TraceResult,
  labels: TraceImageLabels,
  theme: TraceImageTheme,
): TraceImageExport {
  const palette = TRACE_IMAGE_PALETTES[theme];
  const blocks = buildTraceImageBlocks(model, result, labels, palette);
  const layouts = blocks.map((block) => layoutBlock(block));
  const blocksHeight = layouts.reduce(
    (total, layout) => total + layout.height,
    0,
  );
  const gapsHeight = Math.max(0, layouts.length - 1) * BLOCK_GAP;
  const height =
    IMAGE_PADDING + blocksHeight + gapsHeight + FOOTER_HEIGHT + IMAGE_PADDING;

  let y = IMAGE_PADDING;
  const body: string[] = [];
  for (const layout of layouts) {
    body.push(
      layout.block.kind === "device"
        ? renderDeviceBlock(layout, y, labels, palette)
        : renderConnectorBlock(layout, y, palette),
    );
    y += layout.height + BLOCK_GAP;
  }

  const totalLength =
    result.totalCableLengthLabel === "Unknown"
      ? labels.unknown
      : result.totalCableLengthLabel;
  const footerY = height - IMAGE_PADDING - FOOTER_HEIGHT;
  body.push(
    `<line x1="${IMAGE_PADDING}" y1="${footerY}" x2="${IMAGE_WIDTH - IMAGE_PADDING}" y2="${footerY}" stroke="${palette.footerDivider}" />`,
    `<text x="${IMAGE_WIDTH / 2}" y="${footerY + 28}" text-anchor="middle" fill="${palette.footerText}" font-size="14" font-weight="600">${escapeXml(
      `${labels.hops(result.segments.length)} · ${labels.length}: ${totalLength}`,
    )}</text>`,
  );

  const filename = buildTraceImageFilename(model, result, labels.unknown);
  const title = `${labels.cable}: ${filename.replace(/\.png$/, "")}`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}" direction="${labels.direction}" data-theme="${theme}">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect width="${IMAGE_WIDTH}" height="${height}" fill="${palette.background}" />`,
    `<g font-family="Inter, IBM Plex Sans, Arial, sans-serif">`,
    ...body,
    `</g>`,
    `</svg>`,
  ].join("");

  return { filename, height, svg, width: IMAGE_WIDTH };
}

export async function downloadTraceImagePng(
  traceImage: TraceImageExport,
): Promise<void> {
  const svgBlob = new Blob([traceImage.svg], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const scale = Math.min(
      2,
      MAX_CANVAS_DIMENSION / traceImage.width,
      MAX_CANVAS_DIMENSION / traceImage.height,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(traceImage.width * scale));
    canvas.height = Math.max(1, Math.floor(traceImage.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is not available.");

    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.drawImage(image, 0, 0, traceImage.width, traceImage.height);
    const pngBlob = await canvasToPng(canvas);
    downloadBlob(traceImage.filename, pngBlob);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function buildTraceImageBlocks(
  model: VisualizerModel,
  result: TraceResult,
  labels: TraceImageLabels,
  palette: TraceImagePalette,
): TraceImageBlock[] {
  const firstSegment = result.segments[0];
  if (!firstSegment) return [];

  const blocks: TraceImageBlock[] = [];
  let current = createDeviceBlock(
    model,
    firstSegment.fromPort,
    labels,
    palette,
  );

  for (const segment of result.segments) {
    if (current.deviceId !== segment.fromPort.deviceId) {
      blocks.push(current);
      current = createDeviceBlock(model, segment.fromPort, labels, palette);
    } else {
      addPort(current, segment.fromPort, labels);
    }

    if (
      segment.kind === "patch" &&
      segment.fromPort.deviceId === segment.toPort.deviceId
    ) {
      current.internalAfterPortIds.add(segment.fromPort.id);
      addPort(current, segment.toPort, labels);
      continue;
    }

    blocks.push(current);
    blocks.push(
      createConnectorBlock(segment.link, segment.color, labels, palette),
    );
    current = createDeviceBlock(model, segment.toPort, labels, palette);
  }

  blocks.push(current);
  return blocks;
}

function createDeviceBlock(
  model: VisualizerModel,
  port: Port,
  labels: TraceImageLabels,
  palette: TraceImagePalette,
): TraceImageDeviceBlock {
  const device = model.deviceById[port.deviceId];
  const node = model.nodesByDeviceId[port.deviceId];
  const effectiveType =
    node?.effectiveDeviceType ??
    model.effectiveDeviceTypeByDeviceId[port.deviceId] ??
    device?.deviceType ??
    "unknown";
  const modelLabel = [device?.manufacturer, device?.model]
    .filter(Boolean)
    .join(" ");
  const detail = [labels.deviceType(effectiveType), modelLabel]
    .filter(Boolean)
    .join(" · ");
  const placementParts = [
    node?.roomName ? `${labels.room}: ${node.roomName}` : null,
    node?.rackName ? `${labels.rack}: ${node.rackName}` : null,
    device?.face === "front"
      ? labels.front
      : device?.face === "rear"
        ? labels.rear
        : null,
    device?.startU != null ? `U${device.startU}` : null,
  ].filter((value): value is string => Boolean(value));

  const block: TraceImageDeviceBlock = {
    kind: "device",
    deviceId: port.deviceId,
    deviceType: effectiveType,
    title: device?.hostname || labels.unknown,
    detail: detail || labels.unknown,
    placement: placementParts.join(" / "),
    accent: deviceAccent(effectiveType, palette),
    ports: [],
    internalAfterPortIds: new Set(),
  };
  addPort(block, port, labels);
  return block;
}

function addPort(
  block: TraceImageDeviceBlock,
  port: Port,
  labels: Pick<TraceImageLabels, "front" | "rear">,
) {
  if (block.ports.some((entry) => entry.id === port.id)) return;
  const face =
    port.face === "front"
      ? labels.front
      : port.face === "rear"
        ? labels.rear
        : null;
  block.ports.push({
    id: port.id,
    label: face ? `${port.name} (${face})` : port.name,
  });
}

function createConnectorBlock(
  link: PortLink | undefined,
  color: string,
  labels: TraceImageLabels,
  palette: TraceImagePalette,
): TraceImageConnectorBlock {
  const label = link?.cableType
    ? `${labels.cable} · ${link.cableType}`
    : labels.cable;
  return {
    kind: "connector",
    color: safeExportColor(color || link?.color, palette.defaultCable),
    label,
    detail: link?.cableLength ? `${labels.length}: ${link.cableLength}` : "",
  };
}

function layoutBlock(block: TraceImageBlock): TraceImageBlockLayout {
  if (block.kind === "connector") {
    const titleLines = wrapText(block.label, 42);
    const detailLines = block.detail ? wrapText(block.detail, 48) : [];
    return {
      block,
      titleLines,
      detailLines,
      placementLines: [],
      height: Math.max(
        104,
        60 + titleLines.length * 18 + detailLines.length * 17,
      ),
    };
  }

  const titleLines = wrapText(block.title, 42);
  const detailLines = wrapText(block.detail, 62);
  const placementLines = block.placement ? wrapText(block.placement, 68) : [];
  const headerHeight =
    CARD_HEADER_PADDING * 2 +
    titleLines.length * 23 +
    detailLines.length * 18 +
    placementLines.length * 17;
  return {
    block,
    titleLines,
    detailLines,
    placementLines,
    height:
      headerHeight +
      block.ports.length * PORT_HEIGHT +
      block.internalAfterPortIds.size * INTERNAL_CONNECTION_HEIGHT +
      16,
  };
}

function renderDeviceBlock(
  layout: TraceImageBlockLayout,
  y: number,
  labels: TraceImageLabels,
  palette: TraceImagePalette,
) {
  const block = layout.block as TraceImageDeviceBlock;
  const x = IMAGE_PADDING;
  const technicalTextX = x + 22;
  const cardRight = x + CARD_WIDTH;
  const localizedTextX =
    labels.direction === "rtl" ? cardRight - 22 : technicalTextX;
  const parts = [
    `<g>`,
    `<rect x="${x}" y="${y}" width="${CARD_WIDTH}" height="${layout.height}" rx="14" fill="${palette.card}" stroke="${palette.cardBorder}" stroke-width="1.5" />`,
    `<path d="M ${x + 14} ${y} H ${cardRight - 14} Q ${cardRight} ${y} ${cardRight} ${y + 14} V ${y + 10} H ${x} V ${y + 14} Q ${x} ${y} ${x + 14} ${y} Z" fill="${block.accent}" />`,
    renderDeviceIcon(block.deviceType, cardRight - 58, y + 20, palette),
  ];

  let cursorY = y + 34;
  parts.push(
    renderTextLines(layout.titleLines, technicalTextX, cursorY, {
      fill: palette.primaryText,
      fontSize: 20,
      fontWeight: 700,
      lineHeight: 23,
      technical: true,
    }),
  );
  cursorY += layout.titleLines.length * 23 + 5;
  parts.push(
    renderTextLines(layout.detailLines, technicalTextX, cursorY, {
      fill: palette.secondaryText,
      fontSize: 14,
      fontWeight: 600,
      lineHeight: 18,
      technical: true,
    }),
  );
  cursorY += layout.detailLines.length * 18 + 3;
  if (layout.placementLines.length > 0) {
    parts.push(
      renderTextLines(layout.placementLines, localizedTextX, cursorY, {
        fill: palette.tertiaryText,
        fontSize: 13,
        fontWeight: 400,
        lineHeight: 17,
        textAnchor: "start",
      }),
    );
    cursorY += layout.placementLines.length * 17;
  }
  cursorY += 13;

  for (const port of block.ports) {
    parts.push(
      `<rect x="${x + 12}" y="${cursorY}" width="${CARD_WIDTH - 24}" height="${PORT_HEIGHT - 8}" rx="7" fill="${palette.portBackground}" stroke="${palette.portBorder}" />`,
      `<text x="${IMAGE_WIDTH / 2}" y="${cursorY + 24}" text-anchor="middle" direction="ltr" unicode-bidi="embed" fill="${palette.portText}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="14" font-weight="650">${escapeXml(
        port.label,
      )}</text>`,
    );
    cursorY += PORT_HEIGHT;

    if (block.internalAfterPortIds.has(port.id)) {
      const connectionCenter = cursorY + INTERNAL_CONNECTION_HEIGHT / 2;
      parts.push(
        `<line x1="${IMAGE_WIDTH / 2}" y1="${cursorY - 4}" x2="${IMAGE_WIDTH / 2}" y2="${cursorY + INTERNAL_CONNECTION_HEIGHT + 4}" stroke="${palette.patchLine}" stroke-width="4" stroke-dasharray="5 4" />`,
        `<rect x="${IMAGE_WIDTH / 2 - 112}" y="${connectionCenter - 13}" width="224" height="26" rx="13" fill="${palette.patchPill}" stroke="${palette.patchBorder}" />`,
        `<text x="${IMAGE_WIDTH / 2}" y="${connectionCenter + 5}" text-anchor="middle" fill="${palette.patchText}" font-size="12" font-weight="650">${escapeXml(
          labels.internalPassThrough,
        )}</text>`,
      );
      cursorY += INTERNAL_CONNECTION_HEIGHT;
    }
  }

  parts.push(`</g>`);
  return parts.join("");
}

const TRACE_DEVICE_ICONS: Record<string, string> = {
  network:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/><circle cx="17" cy="16" r="1"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="m9 12 2 2 4-4"/>',
  server:
    '<rect x="3" y="2" width="18" height="8" rx="2"/><rect x="3" y="14" width="18" height="8" rx="2"/><path d="M7 6h.01M7 18h.01M11 6h6M11 18h6"/>',
  boxes:
    '<path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="m4.3 6.7 7.7 4.4 7.7-4.4M12 11.1V20"/>',
  wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/>',
  monitor:
    '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  cable:
    '<path d="M6 3v5M4 3h4M18 16v5M16 21h4M6 8a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6"/>',
  minus: '<path d="M5 12h14"/>',
  storage:
    '<path d="M4 6h16M4 10h16M6 2h12l2 4v14H4V6l2-4Z"/><path d="M8 16h.01M12 16h4"/>',
  power: '<path d="M12 2v10M7.1 4.9a8 8 0 1 0 9.8 0"/>',
  battery:
    '<rect x="2" y="6" width="18" height="12" rx="2"/><path d="M22 10v4M6 12h8M10 8v8"/>',
};

function renderDeviceIcon(
  type: string,
  x: number,
  y: number,
  palette: TraceImagePalette,
) {
  const key = traceDeviceIconKey(type);
  return [
    `<g data-device-icon="${key}">`,
    `<rect x="${x}" y="${y}" width="38" height="38" rx="9" fill="${palette.iconBackground}" stroke="${palette.iconBorder}" />`,
    `<g transform="translate(${x + 7} ${y + 7})" fill="none" stroke="${palette.iconStroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">`,
    TRACE_DEVICE_ICONS[key],
    `</g>`,
    `</g>`,
  ].join("");
}

function traceDeviceIconKey(type: string) {
  switch (type) {
    case "switch":
    case "router":
      return "network";
    case "firewall":
      return "shield";
    case "server":
      return "server";
    case "ap":
    case "access_point":
      return "wifi";
    case "endpoint":
    case "kvm":
      return "monitor";
    case "patch_panel":
    case "brush_panel":
      return "cable";
    case "blanking_panel":
      return "minus";
    case "storage":
      return "storage";
    case "pdu":
      return "power";
    case "ups":
      return "battery";
    default:
      return "boxes";
  }
}

function renderConnectorBlock(
  layout: TraceImageBlockLayout,
  y: number,
  palette: TraceImagePalette,
) {
  const block = layout.block as TraceImageConnectorBlock;
  const centerX = IMAGE_WIDTH / 2;
  const labelHeight =
    22 + layout.titleLines.length * 18 + layout.detailLines.length * 17;
  const labelY = y + (layout.height - labelHeight) / 2;
  const parts = [
    `<g>`,
    `<line x1="${centerX}" y1="${y - BLOCK_GAP}" x2="${centerX}" y2="${y + layout.height + BLOCK_GAP}" stroke="${palette.connectorTrack}" stroke-width="9" />`,
    `<line x1="${centerX}" y1="${y - BLOCK_GAP}" x2="${centerX}" y2="${y + layout.height + BLOCK_GAP}" stroke="${block.color}" stroke-width="5" />`,
    `<rect x="${centerX - 184}" y="${labelY}" width="368" height="${labelHeight}" rx="12" fill="${palette.connectorCard}" stroke="${palette.cardBorder}" />`,
  ];
  let cursorY = labelY + 23;
  parts.push(
    renderTextLines(layout.titleLines, centerX, cursorY, {
      fill: palette.connectorTitle,
      fontSize: 14,
      fontWeight: 700,
      lineHeight: 18,
      textAnchor: "middle",
    }),
  );
  cursorY += layout.titleLines.length * 18 + 2;
  if (layout.detailLines.length > 0) {
    parts.push(
      renderTextLines(layout.detailLines, centerX, cursorY, {
        fill: palette.connectorDetail,
        fontSize: 13,
        fontWeight: 400,
        lineHeight: 17,
        textAnchor: "middle",
      }),
    );
  }
  parts.push(`</g>`);
  return parts.join("");
}

function renderTextLines(
  lines: string[],
  x: number,
  y: number,
  options: {
    fill: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    technical?: boolean;
    textAnchor?: "start" | "middle" | "end";
  },
) {
  if (lines.length === 0) return "";
  const technical = options.technical
    ? ` direction="ltr" unicode-bidi="embed"`
    : "";
  const textAnchor = options.textAnchor ?? "start";
  return `<text x="${x}" y="${y}" text-anchor="${textAnchor}"${technical} fill="${options.fill}" font-size="${options.fontSize}" font-weight="${options.fontWeight}">${lines
    .map(
      (line, index) =>
        `<tspan x="${x}" dy="${index === 0 ? 0 : options.lineHeight}">${escapeXml(
          line,
        )}</tspan>`,
    )
    .join("")}</text>`;
}

function buildTraceImageFilename(
  model: VisualizerModel,
  result: TraceResult,
  unknown: string,
) {
  const fromPort = model.portById[result.fromPortId];
  const toPort = model.portById[result.toPortId];
  const fromDevice = fromPort ? model.deviceById[fromPort.deviceId] : undefined;
  const toDevice = toPort ? model.deviceById[toPort.deviceId] : undefined;
  const parts = [
    fromDevice?.hostname || unknown,
    fromPort?.name || unknown,
    "to",
    toDevice?.hostname || unknown,
    toPort?.name || unknown,
  ].map(sanitizeFilenamePart);
  return `rackpad-trace-${parts.join("-")}.png`;
}

function sanitizeFilenamePart(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48);
  return normalized || "unknown";
}

function wrapText(value: string, maxCharacters: number) {
  const text = value.trim();
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const chunks = splitLongWord(word, maxCharacters);
    for (const chunk of chunks) {
      if (!current) {
        current = chunk;
      } else if (`${current} ${chunk}`.length <= maxCharacters) {
        current = `${current} ${chunk}`;
      } else {
        lines.push(current);
        current = chunk;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function splitLongWord(value: string, maxCharacters: number) {
  const characters = Array.from(value);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += maxCharacters) {
    chunks.push(characters.slice(index, index + maxCharacters).join(""));
  }
  return chunks;
}

function safeExportColor(value: string | null | undefined, fallback: string) {
  const normalized = normalizeColorToCss(value);
  if (!normalized) return fallback;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) return normalized;
  if (/^[a-z]{3,24}$/i.test(normalized)) return normalized;
  if (/^(?:rgb|hsl)a?\([\d\s.,%+-]+\)$/i.test(normalized)) {
    return normalized;
  }
  return fallback;
}

function deviceAccent(type: string, palette: TraceImagePalette) {
  const key = type === "access_point" ? "ap" : type;
  return palette.deviceAccents[key] ?? palette.deviceAccents.default;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Trace SVG could not be decoded."));
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Trace PNG could not be created."));
    }, "image/png");
  });
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
