import type {
  HardwareTemplateV1,
  PhysicalFacePrimitiveV1,
  PhysicalPortSlotV1,
  RackFace,
} from "./types";
import {
  generatePortBlock,
  nextTemplatePartId,
  templatePortBlocks,
  updateModulePosition,
} from "./hardware-template-builder";

export interface TemplateItem {
  kind: "element" | "port" | "position" | "block" | "module";
  id: string;
  face: RackFace;
  moduleId?: string;
}
export function templateItems(template: HardwareTemplateV1): TemplateItem[] {
  return [
    ...(["front", "rear"] as const).flatMap((face) =>
      template[face].elements.map((item) => ({
        kind: "element" as const,
        id: item.id,
        face,
      })),
    ),
    ...template.portSlots.map((item) => ({
      kind: "port" as const,
      id: item.id,
      face: item.face,
    })),
    ...template.moduleSlots.map((item) => ({
      kind: "position" as const,
      id: item.id,
      face: item.face,
    })),
    ...templatePortBlocks(template).map((item) => ({
      kind: "block" as const,
      id: item.id,
      face: item.face,
    })),
    ...template.modules.flatMap((module) => [
      { kind: "module" as const, id: module.id, face: module.face },
      ...module.elements.map((item) => ({
        kind: "element" as const,
        id: item.id,
        face: module.face,
        moduleId: module.id,
      })),
      ...module.portSlots.map((item) => ({
        kind: "port" as const,
        id: item.id,
        face: module.face,
        moduleId: module.id,
      })),
    ]),
  ];
}
export function templateItemValue(
  template: HardwareTemplateV1,
  item: TemplateItem,
) {
  const module = template.modules.find((entry) => entry.id === item.moduleId);
  if (item.kind === "element")
    return (module?.elements ?? template[item.face].elements).find(
      (entry) => entry.id === item.id,
    );
  if (item.kind === "port")
    return (module?.portSlots ?? template.portSlots).find(
      (entry) => entry.id === item.id,
    );
  if (item.kind === "position")
    return template.moduleSlots.find((entry) => entry.id === item.id);
  if (item.kind === "block")
    return templatePortBlocks(template).find((entry) => entry.id === item.id);
  return template.modules.find((entry) => entry.id === item.id);
}
function belongsToBlock(
  slot: PhysicalPortSlotV1,
  block: ReturnType<typeof templatePortBlocks>[number],
) {
  const base = block.id.replace(/:(front|rear)$/, "");
  return (
    slot.face === block.face &&
    (slot.groupId === block.id ||
      (!slot.groupId &&
        (slot.id.startsWith(`${block.id}-`) ||
          slot.id.startsWith(`${base}-`)) &&
        !block.excludedSlotIds?.includes(slot.id)))
  );
}
function assertGeometry(
  value:
    | PhysicalFacePrimitiveV1
    | PhysicalPortSlotV1
    | { x: number; y: number; width: number; height: number },
  template: HardwareTemplateV1,
  face: RackFace,
) {
  if (![value.x, value.y].every(Number.isFinite))
    throw new Error("Invalid geometry.");
  const radius = "radius" in value ? value.radius : 0;
  const width = "width" in value ? value.width : radius;
  const height = "height" in value ? value.height : radius;
  if (
    ![width, height].every(Number.isFinite) ||
    width < 0 ||
    height < 0 ||
    value.x < radius ||
    value.y < radius ||
    value.x + width > 1000 ||
    value.y + height > template[face].height
  )
    throw new Error("Item exceeds face bounds.");
  if ("radius" in value && (radius < 1 || radius > 100))
    throw new Error("Invalid radius.");
  if (
    "acceptedPortKinds" in value &&
    (width < 4 || height < 4 || width > 200 || height > 200)
  )
    throw new Error("Port size must be between 4 and 200.");
  if ("width" in value && (width < 1 || height < 1))
    throw new Error("Invalid size.");
}
export function updateTemplateItem(
  template: HardwareTemplateV1,
  item: TemplateItem,
  patch: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    radius?: number;
    color?: string;
  },
) {
  const current = templateItemValue(template, item);
  if (!current || !("x" in current)) return template;
  const next = { ...current, ...patch };
  if (
    patch.color !== undefined &&
    patch.color !== "" &&
    !/^#[0-9a-f]{6}$/i.test(patch.color)
  )
    throw new Error("Use a six-digit hexadecimal color.");
  if ("color" in next && !next.color) delete next.color;
  if (!("x" in next)) return template;
  assertGeometry(next, template, item.face);
  if (item.kind === "position") {
    const changed = updateModulePosition(
      template,
      next as HardwareTemplateV1["moduleSlots"][number],
    );
    for (const module of changed.modules.filter(
      (entry) => entry.slotId === item.id,
    ))
      for (const part of [...module.elements, ...module.portSlots])
        assertGeometry(part, changed, item.face);
    return changed;
  }
  const result = structuredClone(template);
  if (item.kind === "block") {
    const before = current as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    const after = next as typeof before;
    const scaleX = after.width / before.width;
    const scaleY = after.height / before.height;
    result.portSlots = result.portSlots.map((slot) => {
      if (
        !belongsToBlock(
          slot,
          current as ReturnType<typeof templatePortBlocks>[number],
        )
      )
        return slot;
      const changed = {
        ...slot,
        x: after.x + (slot.x - before.x) * scaleX,
        y: after.y + (slot.y - before.y) * scaleY,
        width: slot.width * scaleX,
        height: slot.height * scaleY,
        ...(patch.color !== undefined
          ? { color: patch.color || undefined }
          : {}),
      };
      assertGeometry(changed, result, item.face);
      return changed;
    });
    result.portBlueprints = result.portBlueprints.map((block) =>
      block.id === item.id && block.face === item.face
        ? { ...block, ...patch }
        : block,
    );
  } else {
    const module = result.modules.find((entry) => entry.id === item.moduleId);
    if (item.kind === "element") {
      const elements = module?.elements ?? result[item.face].elements;
      elements[elements.findIndex((entry) => entry.id === item.id)] =
        next as PhysicalFacePrimitiveV1;
    } else {
      const slots = module?.portSlots ?? result.portSlots;
      slots[slots.findIndex((entry) => entry.id === item.id)] =
        next as PhysicalPortSlotV1;
    }
  }
  return result;
}

export function transferTemplateItem(
  template: HardwareTemplateV1,
  item: TemplateItem,
  copy: boolean,
) {
  if (item.moduleId)
    throw new Error("Move module parts with their module position.");
  if (item.kind === "module") {
    const module = template.modules.find((entry) => entry.id === item.id);
    if (!module) return template;
    return transferTemplateItem(
      template,
      { kind: "position", id: module.slotId, face: module.face },
      copy,
    );
  }
  const destination: RackFace = item.face === "front" ? "rear" : "front";
  const ratio = template[destination].height / template[item.face].height;
  const result = structuredClone(template);
  const used = templateItems(template).map((entry) => entry.id);
  const fresh = (id: string) => {
    const next = nextTemplatePartId(`${id}-copy`, used);
    used.push(next);
    return next;
  };
  function transform<
    T extends
      | PhysicalFacePrimitiveV1
      | PhysicalPortSlotV1
      | HardwareTemplateV1["moduleSlots"][number],
  >(value: T): T {
    const next = {
      ...value,
      id: copy ? fresh(value.id) : value.id,
      y: value.y * ratio,
      ...("height" in value ? { height: value.height * ratio } : {}),
      ...("radius" in value
        ? { radius: value.radius * Math.min(1, ratio) }
        : {}),
      ...("face" in value ? { face: destination } : {}),
    };
    assertGeometry(next, result, destination);
    return next;
  }
  if (item.kind === "element") {
    const original = result[item.face].elements.find(
      (entry) => entry.id === item.id,
    );
    if (!original) return template;
    const next = transform(original);
    if (result[destination].elements.some((entry) => entry.id === next.id))
      throw new Error("Destination already contains this item ID.");
    result[destination].elements.push(next);
    if (!copy)
      result[item.face].elements = result[item.face].elements.filter(
        (entry) => entry.id !== item.id,
      );
  } else if (item.kind === "port") {
    const original = result.portSlots.find((entry) => entry.id === item.id);
    if (!original) return template;
    const next = transform(original);
    // A detached port must not be regenerated by its former block.
    delete next.groupId;
    if (!copy) {
      result.portSlots = result.portSlots.filter(
        (entry) => entry.id !== item.id,
      );
      const formerBlock = templatePortBlocks(result).find((block) =>
        belongsToBlock(original, block),
      );
      if (formerBlock)
        result.portBlueprints = result.portBlueprints.map((block) =>
          block.id === formerBlock.id && block.face === item.face
            ? {
                ...block,
                excludedSlotIds: [
                  ...(Array.isArray(block.excludedSlotIds)
                    ? block.excludedSlotIds
                    : []),
                  original.id,
                ],
              }
            : block,
        );
    }
    result.portSlots.push(next);
  } else if (item.kind === "position") {
    const original = result.moduleSlots.find((entry) => entry.id === item.id);
    if (!original) return template;
    const next = transform(original);
    const modules = result.modules
      .filter((entry) => entry.slotId === item.id)
      .map((module) => ({
        ...module,
        id: copy ? fresh(module.id) : module.id,
        slotId: next.id,
        face: destination,
        elements: module.elements.map(transform),
        portSlots: module.portSlots.map((slot) => ({
          ...transform(slot),
          groupId: undefined,
        })),
      }));
    if (!copy) {
      result.moduleSlots = result.moduleSlots.filter(
        (entry) => entry.id !== item.id,
      );
      result.modules = result.modules.filter(
        (entry) => entry.slotId !== item.id,
      );
    }
    result.moduleSlots.push(next);
    result.modules.push(...modules);
  } else {
    const original = templatePortBlocks(template).find(
      (entry) => entry.id === item.id && entry.face === item.face,
    );
    if (!original) return template;
    const next = {
      ...original,
      id: copy ? fresh(original.id) : original.id,
      face: destination,
      y: original.y * ratio,
      height: original.height * ratio,
    };
    assertGeometry(next, result, destination);
    if (
      templatePortBlocks(result).some(
        (block) => block.face === destination && block.id === next.id,
      )
    )
      throw new Error("Destination already contains this block ID.");
    const generated = generatePortBlock(original);
    const originals = result.portSlots.filter((slot) =>
      belongsToBlock(slot, original),
    );
    const slots = originals.map((slot) => {
      const index = generated.findIndex((entry) => entry.id === slot.id);
      const transformed = transform(slot);
      return {
        ...transformed,
        id:
          copy && index >= 0
            ? `${next.id}${slot.id.slice(original.id.length)}`
            : transformed.id,
        groupId: next.id,
      };
    });
    if (copy && original.excludedSlotIds)
      next.excludedSlotIds = original.excludedSlotIds.map((id) =>
        id.replace(`${original.id}-`, `${next.id}-`),
      );
    if (!copy) {
      result.portBlueprints = result.portBlueprints.filter(
        (entry) => entry.id !== item.id || entry.face !== item.face,
      );
      result.portSlots = result.portSlots.filter(
        (slot) => !belongsToBlock(slot, original),
      );
    }
    result.portBlueprints.push(next);
    result.portSlots.push(...slots);
  }
  return result;
}

export function updateModuleGrid(
  template: HardwareTemplateV1,
  moduleId: string,
  count: number,
  rows: number,
  columns: number,
) {
  const module = template.modules.find((entry) => entry.id === moduleId);
  if (!module || module.portSlots.length === 0) return template;
  if (
    ![count, rows, columns].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 16,
    ) ||
    rows * columns < count
  )
    throw new Error("Module grid cannot omit ports.");
  const position = template.moduleSlots.find(
    (entry) => entry.id === module.slotId,
  )!;
  const cellWidth = (position.width * 0.8) / columns;
  const cellHeight = (position.height * 0.5) / rows;
  const used = templateItems(template).map((entry) => entry.id);
  const portSlots = Array.from({ length: count }, (_, index) => {
    const existing = module.portSlots[index];
    const id = existing?.id ?? nextTemplatePartId(`${module.id}-ports`, used);
    used.push(id);
    const width = Math.max(4, Math.min(38, cellWidth - 2));
    const height = Math.max(4, Math.min(34, cellHeight - 2));
    if (width > cellWidth || height > cellHeight)
      throw new Error("Module is too small for this grid.");
    const slot = {
      ...(existing ?? { ...module.portSlots[0], label: String(index + 1) }),
      id,
      x:
        position.x +
        position.width * 0.1 +
        (index % columns) * cellWidth +
        (cellWidth - width) / 2,
      y:
        position.y +
        position.height * 0.3 +
        Math.floor(index / columns) * cellHeight +
        (cellHeight - height) / 2,
      width,
      height,
    };
    assertGeometry(slot, template, module.face);
    return slot;
  });
  return {
    ...template,
    modules: template.modules.map((entry) =>
      entry.id === moduleId
        ? { ...entry, portGrid: { rows, columns }, portSlots }
        : entry,
    ),
  };
}
