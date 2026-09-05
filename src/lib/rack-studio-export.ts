import type {
  Device,
  DevicePhysicalLayout,
  Port,
  PortLink,
  Rack,
  RackFace,
  Room,
} from "./types";
import {
  RACK_STUDIO_RACK_HEIGHT,
  RACK_STUDIO_RACK_WIDTH,
  rackCanvasState,
} from "./rack-studio";
import {
  buildRackStudioScene,
  type RackStudioSceneEquipment,
  type RackStudioScenePortAnchor,
} from "./rack-studio-scene";
import {
  buildRackElevationCableRoutes,
  buildRackStudioCableRoutes,
  renderCableGeometry,
  defaultCableColor,
  type PhysicalCableCategory,
  type RackStudioCableRouteStyle,
} from "./rack-studio-cables";

export type RackStudioExportTheme = "dark" | "light";

export interface RackStudioExportLabels {
  cable: string;
  cables: string;
  devices: string;
  front: string;
  rear: string;
  room: string;
  rack: string;
  legend: string;
  crossRoom: string;
  categories: Record<PhysicalCableCategory, string>;
}

export interface RackStudioImageExport {
  filename: string;
  height: number;
  svg: string;
  width: number;
}

export interface RackStudioExportInput {
  room: Room;
  racks: Rack[];
  devices: Device[];
  layouts: DevicePhysicalLayout[];
  ports: Port[];
  links: PortLink[];
  face: RackFace | "both";
  focusRackId?: string;
  showLabels: boolean;
  routeStyle: RackStudioCableRouteStyle;
  theme: RackStudioExportTheme;
  labels: RackStudioExportLabels;
}

const PALETTES = {
  light: {
    background: "#f8fafc",
    panel: "#ffffff",
    panel2: "#e2e8f0",
    border: "#64748b",
    rail: "#334155",
    text: "#0f172a",
    subdued: "#475569",
    port: "#0f172a",
    portLinked: "#0891b2",
    device: "#f1f5f9",
  },
  dark: {
    background: "#070a0f",
    panel: "#111827",
    panel2: "#1e293b",
    border: "#526071",
    rail: "#64748b",
    text: "#f8fafc",
    subdued: "#bdc7d2",
    port: "#020617",
    portLinked: "#4dc8d7",
    device: "#172033",
  },
} as const;

function escapeXml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeColor(value: string | undefined, fallback: string) {
  const candidate = value?.trim();
  return candidate && /^#[\da-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "rack-studio"
  );
}

function linkedPortIds(links: PortLink[]) {
  return new Set(links.flatMap((link) => [link.fromPortId, link.toPortId]));
}

function renderTitleBlock(input: RackStudioExportInput, width: number) {
  const palette = PALETTES[input.theme];
  const rack = input.focusRackId
    ? input.racks.find((candidate) => candidate.id === input.focusRackId)
    : undefined;
  const title = rack
    ? `${input.labels.rack}: ${rack.name}`
    : `${input.labels.room}: ${input.room.name}`;
  return [
    `<text x="40" y="38" fill="${palette.text}" font-size="20" font-weight="700">${escapeXml(title)}</text>`,
    `<text x="40" y="59" fill="${palette.subdued}" font-size="11">${escapeXml(
      `${input.devices.length} ${input.labels.devices} · ${input.links.length} ${input.labels.cables} · ${input.face}`,
    )}</text>`,
    `<line x1="40" y1="72" x2="${width - 40}" y2="72" stroke="${palette.border}" />`,
  ].join("");
}

function renderLegend(
  input: RackStudioExportInput,
  categories: PhysicalCableCategory[],
  x: number,
  y: number,
) {
  const palette = PALETTES[input.theme];
  const entries = categories.map((category, index) => {
    const rowY = y + 26 + index * 22;
    return `<g><line x1="${x + 12}" y1="${rowY}" x2="${x + 40}" y2="${rowY}" stroke="${defaultCableColor(category)}" stroke-width="4"/><text x="${x + 50}" y="${rowY + 4}" fill="${palette.subdued}" font-size="11">${escapeXml(input.labels.categories[category])}</text></g>`;
  });
  return [
    `<g><rect x="${x}" y="${y}" width="180" height="${42 + categories.length * 22}" rx="6" fill="${palette.panel}" stroke="${palette.border}"/>`,
    `<text x="${x + 12}" y="${y + 17}" fill="${palette.text}" font-size="11" font-weight="700">${escapeXml(input.labels.legend)}</text>`,
    ...entries,
    `</g>`,
  ].join("");
}

function renderSceneEquipment(input: {
  item: RackStudioSceneEquipment;
  anchors: RackStudioScenePortAnchor[];
  linked: Set<string>;
  portById: Map<string, Port>;
  palette: (typeof PALETTES)[RackStudioExportTheme];
  offsetX?: number;
  offsetY?: number;
  scaleX?: number;
  scaleY?: number;
}) {
  const offsetX = input.offsetX ?? 0;
  const offsetY = input.offsetY ?? 0;
  const scaleX = input.scaleX ?? 1;
  const scaleY = input.scaleY ?? 1;
  const x = offsetX + input.item.rect.x * scaleX;
  const y = offsetY + input.item.rect.y * scaleY;
  const width = Math.max(2, input.item.rect.width * scaleX);
  const height = Math.max(2, input.item.rect.height * scaleY);
  const ports = input.anchors
    .filter(
      (anchor) =>
        anchor.deviceId === input.item.device.id &&
        anchor.rackFace === input.item.rackFace &&
        anchor.physicalFace === input.item.physicalFace,
    )
    .map((anchor) => {
      const port = input.portById.get(anchor.portId);
      const portX = offsetX + anchor.x * scaleX;
      const portY = offsetY + anchor.y * scaleY;
      return `<circle cx="${portX.toFixed(2)}" cy="${portY.toFixed(2)}" r="${Math.max(1.5, Math.min(width, height) * 0.035).toFixed(2)}" fill="${input.linked.has(anchor.portId) ? input.palette.portLinked : input.palette.port}" stroke="${input.palette.border}" stroke-width="0.6"><title>${escapeXml(`${input.item.device.hostname}: ${port?.name ?? anchor.portId}`)}</title></circle>`;
    })
    .join("");
  return [
    `<g data-mount-kind="${input.item.mountKind}" data-device-id="${escapeXml(input.item.device.id)}"><rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" rx="1.5" fill="${input.palette.device}" stroke="${input.palette.border}" stroke-width="0.8"/>`,
    ports,
    `</g>`,
  ].join("");
}

function renderRoomExport(input: RackStudioExportInput) {
  const palette = PALETTES[input.theme];
  const marginX = 60;
  const marginY = 92;
  const scene = buildRackStudioScene({
    room: input.room,
    face: input.face,
    racks: input.racks,
    devices: input.devices,
    layouts: input.layouts,
    ports: input.ports,
  });
  const width = scene.bounds.width + 260;
  const height = scene.bounds.height + 150;
  const linked = linkedPortIds(input.links);
  const portById = new Map(input.ports.map((port) => [port.id, port]));
  const racks = input.racks.map((rack, rackIndex) => {
    const position = rackCanvasState(rack, rackIndex);
    const rackX = marginX + (position.x ?? 0);
    const rackY = marginY + (position.y ?? 0);
    return [
      `<g><rect x="${rackX}" y="${rackY}" width="${RACK_STUDIO_RACK_WIDTH}" height="${RACK_STUDIO_RACK_HEIGHT}" rx="5" fill="${palette.panel}" stroke="${palette.border}" stroke-width="2"/>`,
      `<rect x="${rackX + 12}" y="${rackY + 48}" width="${RACK_STUDIO_RACK_WIDTH - 24}" height="198" fill="${palette.background}" stroke="${palette.rail}" stroke-width="7"/>`,
      `<text x="${rackX + 10}" y="${rackY + 22}" fill="${palette.text}" font-size="10" font-weight="700">${escapeXml(rack.name)}</text></g>`,
    ].join("");
  });
  const equipment = scene.equipment
    .map((item) =>
      renderSceneEquipment({
        item,
        anchors: scene.portAnchors,
        linked,
        portById,
        palette,
        offsetX: marginX,
        offsetY: marginY,
      }),
    )
    .join("");
  const tray = scene.tray
    ? `<g><rect x="${marginX + scene.tray.x}" y="${marginY + scene.tray.y}" width="${scene.tray.width}" height="${scene.tray.height}" rx="6" fill="${palette.panel}" stroke="${palette.border}" stroke-dasharray="5 5"/><text x="${marginX + scene.tray.x + 12}" y="${marginY + scene.tray.y + 20}" fill="${palette.subdued}" font-size="10">${escapeXml(input.labels.devices)}</text></g>`
    : "";
  const routes = buildRackStudioCableRoutes({
    room: input.room,
    face: input.face,
    devices: input.devices,
    racks: input.racks,
    layouts: input.layouts,
    ports: input.ports,
    links: input.links,
    style: input.routeStyle,
    scene,
  });
  const routeSvg = routes
    .map((route) => {
      const shifted = route.points.map((point) => ({
        x: point.x + marginX,
        y: point.y + marginY,
      }));
      const last = shifted.at(-1)!;
      const suffix = route.crossRoom
        ? input.labels.crossRoom
        : route.handoffFace === "front"
          ? input.labels.front
          : route.handoffFace === "rear"
            ? input.labels.rear
            : "";
      return [
        `<path d="${renderCableGeometry(route.geometry, { x: marginX, y: marginY })}" fill="none" stroke="${safeColor(route.color, defaultCableColor(route.category))}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" ${route.handoff ? 'stroke-dasharray="8 5"' : ""} opacity="0.9"/>`,
        input.showLabels
          ? `<text x="${last.x + 5}" y="${last.y - 5}" fill="${palette.text}" font-size="9">${escapeXml(suffix ? `${route.label} · ${suffix}` : route.label)}</text>`
          : "",
      ].join("");
    })
    .join("");
  const categories = [...new Set(routes.map((route) => route.category))];

  return {
    width,
    height,
    filename: `${slug(input.room.name)}-rack-studio.svg`,
    body: [
      renderTitleBlock(input, width),
      `<rect x="${marginX}" y="${marginY}" width="${scene.bounds.width}" height="${scene.bounds.height}" rx="8" fill="${palette.panel2}" stroke="${palette.border}" stroke-dasharray="5 5"/>`,
      ...racks,
      tray,
      equipment,
      routeSvg,
      renderLegend(input, categories, width - 210, 92),
    ].join(""),
  };
}

function renderFocusedExport(input: RackStudioExportInput, rack: Rack) {
  const palette = PALETTES[input.theme];
  const faces: RackFace[] =
    input.face === "both" ? ["front", "rear"] : [input.face];
  const rackWidth = 440;
  const rackHeight = 620;
  const faceGap = 50;
  const width =
    90 + faces.length * rackWidth + (faces.length - 1) * faceGap + 250;
  const height = 760;
  const linked = linkedPortIds(input.links);
  const portById = new Map(input.ports.map((port) => [port.id, port]));
  const routes: string[] = [];
  const categories = new Set<PhysicalCableCategory>();

  const rackFaces = faces.map((face, faceIndex) => {
    const x = 50 + faceIndex * (rackWidth + faceGap);
    const y = 102;
    const innerX = x + 34;
    const innerY = y + 48;
    const innerWidth = rackWidth - 68;
    const innerHeight = rackHeight - 72;
    const planned = buildRackElevationCableRoutes({
      rack,
      face,
      devices: input.devices,
      layouts: input.layouts,
      ports: input.ports,
      links: input.links,
      style: input.routeStyle,
      width: 1000,
      unitHeight: 42,
    });
    const elevation = planned.scene;
    const scaleX = innerWidth / elevation.width;
    const scaleY = innerHeight / elevation.height;
    const rackBodyY = innerY + elevation.rackOffsetY * scaleY;
    const rackBodyHeight = (elevation.height - elevation.rackOffsetY) * scaleY;
    for (const route of planned.routes) {
      categories.add(route.category);
      const shifted = route.points.map((point) => ({
        x: innerX + point.x * scaleX,
        y: innerY + point.y * scaleY,
      }));
      const last = shifted.at(-1)!;
      const label =
        route.link.label || route.link.cableType || input.labels.cable;
      const handoffLabel = route.handoffFace
        ? route.handoffFace === "front"
          ? input.labels.front
          : input.labels.rear
        : input.labels.crossRoom;
      routes.push(
        `<path d="${renderCableGeometry(route.geometry, { x: innerX, y: innerY }, { x: scaleX, y: scaleY })}" fill="none" stroke="${safeColor(route.color, defaultCableColor(route.category))}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" ${route.handoff ? 'stroke-dasharray="8 5"' : ""}/>`,
      );
      if (input.showLabels || route.handoff) {
        routes.push(
          `<text x="${last.x + (last.x < innerX + innerWidth / 2 ? 5 : -5)}" y="${last.y - 6}" text-anchor="${last.x < innerX + innerWidth / 2 ? "start" : "end"}" fill="${palette.text}" font-size="9">${escapeXml(route.handoff ? `${label} · ${handoffLabel}` : label)}</text>`,
        );
      }
    }
    const devices = elevation.equipment
      .map((item) =>
        renderSceneEquipment({
          item,
          anchors: elevation.portAnchors,
          linked,
          portById,
          palette,
          offsetX: innerX,
          offsetY: innerY,
          scaleX,
          scaleY,
        }),
      )
      .join("");
    const uLines = Array.from({ length: rack.totalU }, (_, index) => {
      const rowY = rackBodyY + ((index + 1) / rack.totalU) * rackBodyHeight;
      return `<line x1="${innerX}" y1="${rowY}" x2="${innerX + innerWidth}" y2="${rowY}" stroke="${palette.border}" stroke-width="0.35"/>`;
    }).join("");
    return [
      `<g><rect x="${x}" y="${y}" width="${rackWidth}" height="${rackHeight}" rx="7" fill="${palette.panel}" stroke="${palette.border}" stroke-width="2"/>`,
      `<text x="${x + 18}" y="${y + 27}" fill="${palette.text}" font-size="13" font-weight="700">${escapeXml(`${rack.name} · ${face === "front" ? input.labels.front : input.labels.rear}`)}</text>`,
      `<rect x="${innerX - 11}" y="${rackBodyY - 7}" width="${innerWidth + 22}" height="${rackBodyHeight + 14}" fill="${palette.background}" stroke="${palette.rail}" stroke-width="9"/>`,
      uLines,
      devices,
      `</g>`,
    ].join("");
  });

  return {
    width,
    height,
    filename: `${slug(rack.name)}-rack-studio.svg`,
    body: [
      renderTitleBlock(input, width),
      ...rackFaces,
      ...routes,
      renderLegend(input, [...categories], width - 210, 102),
    ].join(""),
  };
}

export function buildRackStudioSvg(
  input: RackStudioExportInput,
): RackStudioImageExport {
  const focusRack = input.focusRackId
    ? input.racks.find((rack) => rack.id === input.focusRackId)
    : undefined;
  const rendered = focusRack
    ? renderFocusedExport(input, focusRack)
    : renderRoomExport(input);
  const palette = PALETTES[input.theme];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${rendered.width}" height="${rendered.height}" viewBox="0 0 ${rendered.width} ${rendered.height}" data-theme="${input.theme}">`,
    `<title>${escapeXml(input.room.name)}</title>`,
    `<rect width="${rendered.width}" height="${rendered.height}" fill="${palette.background}"/>`,
    `<g font-family="Inter, IBM Plex Sans, Arial, sans-serif">`,
    rendered.body,
    `</g></svg>`,
  ].join("");
  return {
    filename: rendered.filename,
    height: rendered.height,
    svg,
    width: rendered.width,
  };
}

export function downloadRackStudioSvg(image: RackStudioImageExport) {
  downloadBlob(
    image.filename,
    new Blob([image.svg], { type: "image/svg+xml;charset=utf-8" }),
  );
}

export async function downloadRackStudioPng(image: RackStudioImageExport) {
  const svgUrl = URL.createObjectURL(
    new Blob([image.svg], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const loaded = await loadImage(svgUrl);
    const scale = Math.min(2, 16_384 / image.width, 16_384 / image.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(image.width * scale));
    canvas.height = Math.max(1, Math.floor(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas rendering is not available.");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.drawImage(loaded, 0, 0, image.width, image.height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG export failed."));
      }, "image/png");
    });
    downloadBlob(image.filename.replace(/\.svg$/i, ".png"), png);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image export failed."));
    image.src = url;
  });
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
