// Derived stack artwork only. Keep this browser-shared module free of Node imports.
import {
  rotateFacePoint,
  type FaceRotation,
} from "./physical-face-appearance.js";

export type FaceArtworkGeometry =
  | {
      kind: "panel" | "handle" | "vent" | "bay" | "display" | "outlet";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | { kind: "screw" | "indicator"; x: number; y: number; radius: number };

export interface FaceArtworkProjection {
  geometry: FaceArtworkGeometry;
  matrix: [number, number, number, number, number, number];
}

export function projectFaceArtwork(
  geometry: FaceArtworkGeometry,
  face: { width: number; height: number; rotation?: FaceRotation },
  scaleX: number,
  scaleY: number,
  offsetY: number,
): FaceArtworkProjection {
  const origin = rotateFacePoint(face, 0, 0);
  const xAxis = rotateFacePoint(face, 1, 0);
  const yAxis = rotateFacePoint(face, 0, 1);
  return {
    geometry:
      "width" in geometry
        ? {
            kind: geometry.kind,
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
          }
        : {
            kind: geometry.kind,
            x: geometry.x,
            y: geometry.y,
            radius: geometry.radius,
          },
    matrix: [
      (xAxis.x - origin.x) * scaleX,
      (xAxis.y - origin.y) * scaleY,
      (yAxis.x - origin.x) * scaleX,
      (yAxis.y - origin.y) * scaleY,
      origin.x * scaleX,
      offsetY + origin.y * scaleY,
    ],
  };
}

/** Validate derived presentation data again at the rendering boundary. No SVG
 * strings, recursive projections, arbitrary primitives or non-finite matrices. */
export function readFaceArtworkProjection(
  value: unknown,
  kind: string,
): FaceArtworkProjection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const { geometry, matrix } = value as Record<string, unknown>;
  if (
    !geometry ||
    typeof geometry !== "object" ||
    Array.isArray(geometry) ||
    !Array.isArray(matrix) ||
    matrix.length !== 6
  )
    return;
  const source = geometry as Record<string, unknown>;
  const bounded = (n: unknown, min: number, max: number): n is number =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (
    source.kind !== kind ||
    !bounded(source.x, 0, 1000) ||
    !bounded(source.y, 0, 1000) ||
    !matrix.every((n) => bounded(n, -1_000_000, 1_000_000)) ||
    Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12
  )
    return;
  let normalized: FaceArtworkGeometry;
  if (["panel", "handle", "vent", "bay", "display", "outlet"].includes(kind)) {
    if (!bounded(source.width, 1, 1000) || !bounded(source.height, 1, 1000))
      return;
    normalized = {
      kind: kind as Extract<FaceArtworkGeometry, { width: number }>["kind"],
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height,
    };
  } else if (kind === "screw" || kind === "indicator") {
    if (!bounded(source.radius, 1, 100)) return;
    normalized = { kind, x: source.x, y: source.y, radius: source.radius };
  } else return;
  return {
    geometry: normalized,
    matrix: [...matrix] as FaceArtworkProjection["matrix"],
  };
}
