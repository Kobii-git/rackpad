export interface LegacyShelfGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CANVAS_SIZE = 1000;
const CANVAS_MARGIN = 20;
const LEGACY_COLUMNS = 5;
const LEGACY_CELL_SIZE = 196;
const LEGACY_ITEM_SIZE = 176;
const LEGACY_CAPACITY = 25;

/**
 * Produces deterministic shelf coordinates for legacy devices that predate
 * explicit geometry. The original five-column layout is retained when it
 * fits; denser shelves scale into the same normalized canvas.
 */
export function legacyShelfGeometry(
  index: number,
  total: number,
): LegacyShelfGeometry {
  const safeIndex = Math.max(0, Math.floor(index));
  const safeTotal = Math.max(safeIndex + 1, Math.floor(total), 1);

  if (safeTotal <= LEGACY_CAPACITY) {
    return {
      x: CANVAS_MARGIN + (safeIndex % LEGACY_COLUMNS) * LEGACY_CELL_SIZE,
      y:
        CANVAS_MARGIN +
        Math.floor(safeIndex / LEGACY_COLUMNS) * LEGACY_CELL_SIZE,
      width: LEGACY_ITEM_SIZE,
      height: LEGACY_ITEM_SIZE,
    };
  }

  const columns = Math.ceil(Math.sqrt(safeTotal));
  const rows = Math.ceil(safeTotal / columns);
  const usableSize = CANVAS_SIZE - CANVAS_MARGIN * 2;
  const cellWidth = usableSize / columns;
  const cellHeight = usableSize / rows;
  const gap = Math.min(8, Math.max(1, Math.min(cellWidth, cellHeight) * 0.08));

  return {
    x: CANVAS_MARGIN + (safeIndex % columns) * cellWidth,
    y: CANVAS_MARGIN + Math.floor(safeIndex / columns) * cellHeight,
    width: cellWidth - gap,
    height: cellHeight - gap,
  };
}
