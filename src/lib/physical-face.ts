import type { FaceDefinitionV1 } from "./types";

interface FaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Round faces use SVG's centered "meet" fit, including inside stretched rack cells.
// Share those bounds with cabling and exports so ports stay on the artwork.
export function physicalFaceRect(
  face: FaceDefinitionV1,
  rect: FaceRect,
): FaceRect {
  if (face.shape !== "round") return rect;
  const size = Math.min(rect.width, rect.height);
  return {
    x: rect.x + (rect.width - size) / 2,
    y: rect.y + (rect.height - size) / 2,
    width: size,
    height: size,
  };
}
