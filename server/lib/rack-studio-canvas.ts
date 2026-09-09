import { db } from "../db.js";
import { ValidationError } from "./validation.js";

export const RACK_STUDIO_CANVAS_WIDTH = 1000;
export const RACK_STUDIO_CANVAS_MIN_HEIGHT = 620;
export const RACK_STUDIO_RACK_WIDTH = 158;
export const RACK_STUDIO_RACK_HEIGHT = 278;

const RACK_COLUMNS = 5;
const RACK_ROW_HEIGHT = 292;
const RACK_MARGIN = 34;
const TRAY_GAP = 28;
const TRAY_HEADER_HEIGHT = 34;
const TRAY_CARD_HEIGHT = 88;
const TRAY_CARD_GAP = 18;
const TRAY_COLUMNS = 4;

interface RackCanvasPosition {
  id: string;
  studioY: number | null;
}

export function calculateRackStudioCanvasBounds(input: {
  racks: RackCanvasPosition[];
  looseDeviceCount: number;
}) {
  const automaticRows = Math.max(1, Math.ceil(input.racks.length / RACK_COLUMNS));
  const automaticBottom =
    RACK_MARGIN +
    (automaticRows - 1) * RACK_ROW_HEIGHT +
    RACK_STUDIO_RACK_HEIGHT +
    RACK_MARGIN;
  const positionedBottom = input.racks.reduce(
    (bottom, rack) =>
      Math.max(
        bottom,
        (rack.studioY ?? 0) + RACK_STUDIO_RACK_HEIGHT + RACK_MARGIN,
      ),
    0,
  );
  const rackAreaHeight = Math.max(
    RACK_STUDIO_CANVAS_MIN_HEIGHT,
    automaticBottom,
    positionedBottom,
  );
  const rackPlacementAreaHeight = Math.max(
    RACK_STUDIO_CANVAS_MIN_HEIGHT,
    automaticBottom,
  );
  if (input.looseDeviceCount === 0) {
    return {
      width: RACK_STUDIO_CANVAS_WIDTH,
      height: rackAreaHeight,
      rackAreaHeight,
      rackPlacementAreaHeight,
    };
  }
  const trayRows = Math.ceil(input.looseDeviceCount / TRAY_COLUMNS);
  const trayHeight =
    TRAY_HEADER_HEIGHT +
    trayRows * TRAY_CARD_HEIGHT +
    (trayRows + 1) * TRAY_CARD_GAP;
  return {
    width: RACK_STUDIO_CANVAS_WIDTH,
    height: rackAreaHeight + TRAY_GAP + trayHeight + RACK_MARGIN,
    rackAreaHeight,
    rackPlacementAreaHeight,
  };
}

export function rackStudioRoomCanvasBounds(roomId: string) {
  const racks = db
    .prepare(
      "SELECT id, studioY FROM racks WHERE roomId = ? ORDER BY name, id",
    )
    .all(roomId) as RackCanvasPosition[];
  const looseCount = (
    db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM devices
          WHERE roomId = ?
            AND rackId IS NULL
            AND placement NOT IN ('virtual', 'wireless')
        `,
      )
      .get(roomId) as { count: number }
  ).count;
  return calculateRackStudioCanvasBounds({ racks, looseDeviceCount: looseCount });
}

export function assertRackStudioRackFootprint(input: {
  roomId: string;
  x: number | null;
  y: number | null;
}) {
  if (input.x === null || input.y === null) return;
  const bounds = rackStudioRoomCanvasBounds(input.roomId);
  if (
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y) ||
    input.x < 0 ||
    input.y < 0 ||
    input.x + RACK_STUDIO_RACK_WIDTH > bounds.width ||
    input.y + RACK_STUDIO_RACK_HEIGHT > bounds.rackPlacementAreaHeight
  ) {
    throw new ValidationError(
      "Rack position must keep the full rack footprint inside the room canvas.",
    );
  }
}

export function assertRackStudioWaypointBounds(input: {
  roomId: string;
  x: number;
  y: number;
}) {
  const bounds = rackStudioRoomCanvasBounds(input.roomId);
  if (input.x > bounds.width || input.y > bounds.height) {
    throw new ValidationError(
      `Cable route waypoint must stay inside room ${input.roomId}'s Rack Studio canvas.`,
    );
  }
}
