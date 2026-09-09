import type {
  DevicePhysicalLayout,
  Port,
  RackFace,
} from "@/lib/types";
import type { VisualizerRackFaceMode } from "./types";

export const PHYSICAL_NODE_WIDTH = 360;
export const PHYSICAL_NODE_HEADER_HEIGHT = 52;
export const PHYSICAL_NODE_FOOTER_HEIGHT = 26;
export const PHYSICAL_NODE_PADDING_X = 10;
export const PHYSICAL_NODE_FACE_LABEL_HEIGHT = 16;
export const PHYSICAL_NODE_FACE_GAP = 8;

export interface PhysicalNodeFaceFrame {
  face: RackFace;
  labelTop: number;
  top: number;
  height: number;
}

export interface PhysicalNodePortAnchor {
  portId: string;
  face: RackFace;
  x: number;
  y: number;
  side: "left" | "right";
}

export interface PhysicalNodePresentation {
  width: number;
  height: number;
  faces: PhysicalNodeFaceFrame[];
  anchors: PhysicalNodePortAnchor[];
  unmappedPortIds: string[];
  fallbackAnchor: { x: number; y: number };
}

export type PhysicalHandlePosition = "left" | "right" | "top" | "bottom";

export function physicalHandlePlacement(
  x: number,
  y: number,
  position: PhysicalHandlePosition,
  size = 8,
) {
  return {
    left:
      position === "left"
        ? x
        : position === "right"
          ? x - size
          : x - size / 2,
    top:
      position === "top"
        ? y
        : position === "bottom"
          ? y - size
          : y - size / 2,
    width: size,
    height: size,
  };
}

export function physicalPortHandleId(
  direction: "source" | "target",
  portId: string,
) {
  return `${direction}-port-${portId}`;
}

export function buildPhysicalNodePresentation(input: {
  layout: DevicePhysicalLayout;
  requestedFaceMode: VisualizerRackFaceMode;
  visiblePorts: Array<Pick<Port, "id" | "face">>;
}): PhysicalNodePresentation {
  const { layout, requestedFaceMode, visiblePorts } = input;
  const slotById = new Map(
    layout.snapshot.portSlots.map((slot) => [slot.id, slot]),
  );
  const slotByPortId = new Map(
    layout.bindings
      .map((binding) => {
        const slot = slotById.get(binding.slotId);
        return slot ? ([binding.portId, slot] as const) : null;
      })
      .filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      ),
  );
  const visibleFaces = new Set<RackFace>(
    requestedFaceMode === "both"
      ? ["front", "rear"]
      : [requestedFaceMode],
  );

  for (const port of visiblePorts) {
    const face = slotByPortId.get(port.id)?.face ?? port.face;
    if (face === "front" || face === "rear") visibleFaces.add(face);
  }

  const orderedFaces = (["front", "rear"] as const).filter((face) =>
    visibleFaces.has(face),
  );
  const contentWidth =
    PHYSICAL_NODE_WIDTH - PHYSICAL_NODE_PADDING_X * 2;
  const frames: PhysicalNodeFaceFrame[] = [];
  let cursor = PHYSICAL_NODE_HEADER_HEIGHT;

  for (const face of orderedFaces) {
    const definition = layout.snapshot.faces[face];
    const labelTop = cursor;
    const top = labelTop + PHYSICAL_NODE_FACE_LABEL_HEIGHT;
    const height = contentWidth * (definition.height / definition.width);
    frames.push({ face, labelTop, top, height });
    cursor = top + height + PHYSICAL_NODE_FACE_GAP;
  }

  const height =
    cursor - PHYSICAL_NODE_FACE_GAP + PHYSICAL_NODE_FOOTER_HEIGHT;
  const frameByFace = new Map(frames.map((frame) => [frame.face, frame]));
  const anchors = layout.bindings.flatMap((binding) => {
    const slot = slotById.get(binding.slotId);
    if (!slot) return [];
    const frame = frameByFace.get(slot.face);
    if (!frame) return [];
    const definition = layout.snapshot.faces[slot.face];
    const slotCenterX = slot.x + slot.width / 2;
    const slotCenterY = slot.y + slot.height / 2;
    return [
      {
        portId: binding.portId,
        face: slot.face,
        x:
          PHYSICAL_NODE_PADDING_X +
          (slotCenterX / definition.width) * contentWidth,
        y: frame.top + (slotCenterY / definition.height) * frame.height,
        side: slotCenterX < definition.width / 2 ? "left" : "right",
      } satisfies PhysicalNodePortAnchor,
    ];
  });
  const boundPortIds = new Set(layout.bindings.map((binding) => binding.portId));
  const unmappedPortIds = Array.from(
    new Set([
      ...layout.unmappedPortIds,
      ...visiblePorts
        .map((port) => port.id)
        .filter((portId) => !boundPortIds.has(portId)),
    ]),
  );

  return {
    width: PHYSICAL_NODE_WIDTH,
    height,
    faces: frames,
    anchors,
    unmappedPortIds,
    fallbackAnchor: {
      x: PHYSICAL_NODE_WIDTH / 2,
      y: height - PHYSICAL_NODE_FOOTER_HEIGHT / 2,
    },
  };
}
