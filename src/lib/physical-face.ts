import type { FaceDefinitionV1 } from "./types";
import type { CSSProperties } from "react";
import { FACE_SKIN_COLORS } from "../../server/lib/physical-face-appearance";
export { FACE_SKINS, FACE_SKIN_COLORS, faceGeometry, faceUnitPoint, faceInputDelta, unrotateFacePoint } from "../../server/lib/physical-face-appearance";

export function physicalFaceSkinStyle(face: FaceDefinitionV1): CSSProperties {
  const colors = face.skin ? FACE_SKIN_COLORS[face.skin] : undefined;
  return colors ? {
    "--color-bg": colors.background,
    "--color-surface": colors.surface,
    "--color-line-strong": colors.border,
    "--color-fg-subtle": colors.text,
  } as CSSProperties : {};
}

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
