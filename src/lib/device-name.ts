/** Canvas coordinates to a fixed, readable screen-space device name. */
export function deviceNameMetrics(
  width: number,
  height: number,
  zoom = 1,
  reservedLeft = 0,
  reservedRight = 0,
  position: "upper-left" | "upper-right" = "upper-right",
) {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const availableWidth = Math.max(
    0,
    (width - reservedLeft - reservedRight) * scale - 8,
  );
  return {
    visible: availableWidth >= 24 && height * scale >= 16,
    fontSize: 12 / scale,
    lineHeight: `${12 / scale}px`,
    maxWidth: Math.min(180, availableWidth) / scale,
    top: 2 / scale,
    left: position === "upper-left" ? reservedLeft + 4 / scale : undefined,
    right: position === "upper-left" ? undefined : reservedRight + 4 / scale,
    padding: `${1 / scale}px ${2 / scale}px`,
  };
}
