import type {
  ArtworkReference,
  HardwareTemplateV1,
  PhysicalFacePrimitiveV1,
  RackFace,
} from "./types";

export function artworkReferenceKey(reference: ArtworkReference) {
  return JSON.stringify([reference.moduleId ?? null, reference.elementId]);
}

export function templateArtwork(template: HardwareTemplateV1, face: RackFace) {
  const items = [
    ...template[face].elements.map((element) => ({
      element,
      reference: { elementId: element.id } as ArtworkReference,
    })),
    ...template.modules
      .filter((module) => module.face === face)
      .flatMap((module) =>
        module.elements.map((element) => ({
          element,
          reference: { elementId: element.id, moduleId: module.id },
        })),
      ),
  ];
  const order = template[face].artworkOrder;
  if (!order) return items;
  const rank = new Map(
    order.map((reference, index) => [artworkReferenceKey(reference), index]),
  );
  return items.sort(
    (a, b) =>
      (rank.get(artworkReferenceKey(a.reference)) ?? order.length) -
      (rank.get(artworkReferenceKey(b.reference)) ?? order.length),
  );
}

/** Remove deleted references and append new artwork without changing surviving order. */
export function reconcileArtworkOrder(
  template: HardwareTemplateV1,
): HardwareTemplateV1 {
  for (const face of ["front", "rear"] as const) {
    if (!template[face].artworkOrder) continue;
    const references = templateArtwork(template, face).map(
      (item) => item.reference,
    );
    template = {
      ...template,
      [face]: { ...template[face], artworkOrder: references },
    };
  }
  return template;
}

export function reorderTemplateArtwork(
  template: HardwareTemplateV1,
  face: RackFace,
  reference: ArtworkReference,
  direction: "forward" | "backward" | "front" | "back",
) {
  const references = templateArtwork(template, face).map(
    (item) => item.reference,
  );
  const index = references.findIndex(
    (item) => artworkReferenceKey(item) === artworkReferenceKey(reference),
  );
  if (index < 0) return template;
  const target =
    direction === "front"
      ? references.length - 1
      : direction === "back"
        ? 0
        : Math.max(
            0,
            Math.min(
              references.length - 1,
              index + (direction === "forward" ? 1 : -1),
            ),
          );
  if (index === target) return template;
  const [selected] = references.splice(index, 1);
  references.splice(target, 0, selected);
  return {
    ...template,
    [face]: { ...template[face], artworkOrder: references },
  };
}

/** Resolved snapshots use base references because module artwork has already been flattened. */
export function orderedFaceElements(face: {
  elements: PhysicalFacePrimitiveV1[];
  artworkOrder?: ArtworkReference[];
}) {
  if (!face.artworkOrder) return face.elements;
  const rank = new Map(
    face.artworkOrder.map((reference, index) => [reference.elementId, index]),
  );
  return [...face.elements].sort(
    (a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size),
  );
}
