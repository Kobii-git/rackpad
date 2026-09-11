import type { PhysicalFacePrimitiveV1 } from "./types";

/** Original decorative paths in the primitive's own coordinates. This same
 * detail is consumed by the interactive faceplate and SVG/PNG export. */
export function faceplateDetailPath(
  primitive: PhysicalFacePrimitiveV1,
): string {
  if (!("width" in primitive)) return "";
  const { x, y, width, height } = primitive;
  if (primitive.kind === "vent") {
    const count = Math.max(3, Math.min(48, Math.round(width / 14)));
    return Array.from({ length: count }, (_, index) => {
      const px = x + ((index + 1) / (count + 1)) * width;
      return `M ${px} ${y + height * 0.15} V ${y + height * 0.85}`;
    }).join(" ");
  }
  if (primitive.kind === "bay") {
    return `M ${x + width * 0.12} ${y + height * 0.75} H ${x + width * 0.88} M ${x + width * 0.18} ${y + height * 0.25} V ${y + height * 0.6}`;
  }
  if (primitive.kind === "display") {
    return [0.3, 0.5, 0.7]
      .map(
        (fraction, index) =>
          `M ${x + width * 0.16} ${y + height * fraction} H ${x + width * (0.8 - index * 0.13)}`,
      )
      .join(" ");
  }
  if (primitive.kind === "handle") {
    return `M ${x + width * 0.5} ${y + height * 0.2} V ${y + height * 0.8}`;
  }
  return "";
}
