// Shared with the browser. Keep this module free of Node and server imports.
export const FACE_SKINS = ["graphite", "silver", "ivory"] as const;
export type FaceSkin = (typeof FACE_SKINS)[number];
export type FaceRotation = 0 | 90 | 180 | 270;
interface FaceGeometry {
  width: number;
  height: number;
  rotation?: FaceRotation;
  skin?: FaceSkin;
}

export const FACE_SKIN_COLORS = {
  graphite: {
    background: "#151b23",
    surface: "#303a46",
    border: "#667788",
    text: "#e2e8f0",
  },
  silver: {
    background: "#aab4bf",
    surface: "#d5dce3",
    border: "#66717e",
    text: "#18212c",
  },
  ivory: {
    background: "#d8d3c6",
    surface: "#f0eadc",
    border: "#827b6d",
    text: "#302d27",
  },
} as const;

export function faceGeometry(face: FaceGeometry) {
  switch (face.rotation) {
    case 90:
      return {
        width: face.height,
        height: face.width,
        transform: `translate(${face.height} 0) rotate(90)`,
      };
    case 180:
      return {
        width: face.width,
        height: face.height,
        transform: `translate(${face.width} ${face.height}) rotate(180)`,
      };
    case 270:
      return {
        width: face.height,
        height: face.width,
        transform: `translate(0 ${face.width}) rotate(270)`,
      };
    default:
      return { width: face.width, height: face.height, transform: undefined };
  }
}

export function rotateFacePoint(face: FaceGeometry, x: number, y: number) {
  switch (face.rotation) {
    case 90:
      return { x: face.height - y, y: x };
    case 180:
      return { x: face.width - x, y: face.height - y };
    case 270:
      return { x: y, y: face.width - x };
    default:
      return { x, y };
  }
}

export function unrotateFacePoint(face: FaceGeometry, x: number, y: number) {
  switch (face.rotation) {
    case 90:
      return { x: y, y: face.height - x };
    case 180:
      return { x: face.width - x, y: face.height - y };
    case 270:
      return { x: face.width - y, y: x };
    default:
      return { x, y };
  }
}

export function faceUnitPoint(face: FaceGeometry, x: number, y: number) {
  const point = rotateFacePoint(face, x, y);
  const geometry = faceGeometry(face);
  return { x: point.x / geometry.width, y: point.y / geometry.height };
}

export function faceInputDelta(face: FaceGeometry, x: number, y: number) {
  const start = unrotateFacePoint(face, 0, 0);
  const end = unrotateFacePoint(face, x, y);
  return [end.x - start.x, end.y - start.y] as const;
}
