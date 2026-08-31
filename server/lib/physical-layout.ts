import { createHash } from "node:crypto";
import { ValidationError } from "./validation.js";

export const PHYSICAL_LAYOUT_STATUSES = [
  "accurate",
  "legacy-default",
  "generic-default",
  "needs-mapping",
  "invalid",
] as const;

export type PhysicalLayoutStatus = (typeof PHYSICAL_LAYOUT_STATUSES)[number];
export type PhysicalFace = "front" | "rear";

export interface PhysicalPortSlotV1 {
  id: string;
  face: PhysicalFace;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  connector: string;
  acceptedPortKinds: string[];
  groupId?: string;
  label?: string;
}

export type FacePrimitiveV1 =
  | {
      kind: "panel" | "handle" | "vent" | "bay" | "display" | "outlet";
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      tone?: "dark" | "mid" | "light" | "accent";
    }
  | {
      kind: "screw" | "indicator";
      id: string;
      x: number;
      y: number;
      radius: number;
      tone?: "dark" | "mid" | "light" | "accent";
    }
  | {
      kind: "label";
      id: string;
      x: number;
      y: number;
      text: string;
      align?: "start" | "middle" | "end";
    };

export interface FaceDefinitionV1 {
  schemaVersion: 1;
  width: 1000;
  height: number;
  elements: FacePrimitiveV1[];
}

export interface ResolvedPhysicalLayoutV1 {
  schemaVersion: 1;
  sourceTemplateId: string;
  category: string;
  mount: {
    kind: "direct" | "shelf" | "side" | "loose";
    heightU: number;
    column: number;
    columnSpan: number;
  };
  faces: Record<PhysicalFace, FaceDefinitionV1>;
  portSlots: PhysicalPortSlotV1[];
  moduleIds?: string[];
}

export interface PortBindingV1 {
  portId: string;
  slotId: string;
}

export interface HardwareTemplateV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  category: string;
  deviceTypes: string[];
  mountDefaults: {
    kind: "direct" | "shelf" | "side" | "loose";
    heightU: number;
    columnSpan: number;
  };
  front: FaceDefinitionV1;
  rear: FaceDefinitionV1;
  portSlots: PhysicalPortSlotV1[];
  moduleSlots: Array<{
    id: string;
    face: PhysicalFace;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  modules: HardwareModuleV1[];
  portBlueprints: Array<Record<string, unknown>>;
  driveBayBlueprints: Array<Record<string, unknown>>;
  builtIn?: boolean;
}

export interface HardwareModuleV1 {
  id: string;
  name: string;
  slotId: string;
  face: PhysicalFace;
  elements: FacePrimitiveV1[];
  portSlots: PhysicalPortSlotV1[];
}

export interface PhysicalLayoutPort {
  id: string;
  name: string;
  position: number;
  kind: string;
  face: string | null;
  portRole?: string | null;
}

export interface PhysicalLayoutDevice {
  id: string;
  deviceType: string;
  heightU: number | null;
  rackSlot?: string | null;
  placement?: string | null;
}

export interface ReconciledPhysicalLayoutBindings {
  bindings: PortBindingV1[];
  status: PhysicalLayoutStatus;
  portFingerprint: string;
  unmappedPortIds: string[];
}

export function isPhysicalLayoutPort(port: PhysicalLayoutPort) {
  return (
    port.portRole !== "aggregate" &&
    port.kind !== "virtual" &&
    port.kind !== "wifi"
  );
}

export function proposePhysicalPortBindings(
  snapshot: ResolvedPhysicalLayoutV1,
  ports: PhysicalLayoutPort[],
  requested: PortBindingV1[] = [],
) {
  const physicalPorts = ports.filter(isPhysicalLayoutPort);
  const portById = new Map(physicalPorts.map((port) => [port.id, port]));
  const slotById = new Map(snapshot.portSlots.map((slot) => [slot.id, slot]));
  const usedPorts = new Set<string>();
  const usedSlots = new Set<string>();
  const bindings: PortBindingV1[] = [];
  const conflicts: string[] = [];

  for (const binding of requested) {
    const port = portById.get(binding.portId);
    const slot = slotById.get(binding.slotId);
    if (!port || !slot) {
      conflicts.push(
        `Binding ${binding.portId} → ${binding.slotId} references a missing port or slot.`,
      );
      continue;
    }
    if (usedPorts.has(port.id) || usedSlots.has(slot.id)) {
      conflicts.push(
        `Binding ${binding.portId} → ${binding.slotId} duplicates a port or slot.`,
      );
      continue;
    }
    const face = port.face === "rear" ? "rear" : "front";
    if (slot.face !== face || !slot.acceptedPortKinds.includes(port.kind)) {
      conflicts.push(
        `Port ${port.name} is not compatible with slot ${slot.label ?? slot.id}.`,
      );
      continue;
    }
    usedPorts.add(port.id);
    usedSlots.add(slot.id);
    bindings.push(binding);
  }

  for (const port of physicalPorts) {
    if (usedPorts.has(port.id)) continue;
    const face = port.face === "rear" ? "rear" : "front";
    const slot = snapshot.portSlots.find(
      (candidate) =>
        !usedSlots.has(candidate.id) &&
        candidate.face === face &&
        candidate.acceptedPortKinds.includes(port.kind),
    );
    if (!slot) continue;
    usedPorts.add(port.id);
    usedSlots.add(slot.id);
    bindings.push({ portId: port.id, slotId: slot.id });
  }

  return {
    bindings,
    conflicts,
    unmappedPortIds: physicalPorts
      .filter((port) => !usedPorts.has(port.id))
      .map((port) => port.id),
  };
}

export function reconcilePhysicalLayoutBindings(input: {
  snapshot: ResolvedPhysicalLayoutV1;
  bindings: PortBindingV1[];
  status: PhysicalLayoutStatus;
  sourceTemplateId: string | null;
  ports: PhysicalLayoutPort[];
}): ReconciledPhysicalLayoutBindings {
  const physicalPorts = input.ports.filter(isPhysicalLayoutPort);
  const portById = new Map(physicalPorts.map((port) => [port.id, port]));
  const slotById = new Map(
    input.snapshot.portSlots.map((slot) => [slot.id, slot]),
  );
  const usedPorts = new Set<string>();
  const usedSlots = new Set<string>();
  const preservedBindings = input.bindings.filter((binding) => {
    const port = portById.get(binding.portId);
    const slot = slotById.get(binding.slotId);
    if (!port || !slot) return false;
    if (usedPorts.has(port.id) || usedSlots.has(slot.id)) return false;
    const face = port.face === "rear" ? "rear" : "front";
    if (slot.face !== face || !slot.acceptedPortKinds.includes(port.kind)) {
      return false;
    }
    usedPorts.add(port.id);
    usedSlots.add(slot.id);
    return true;
  });
  const boundPortIds = new Set(
    preservedBindings.map((binding) => binding.portId),
  );
  const unmappedPortIds = physicalPorts
    .filter((port) => !boundPortIds.has(port.id))
    .map((port) => port.id);
  const status: PhysicalLayoutStatus =
    input.status === "invalid"
      ? "invalid"
      : unmappedPortIds.length > 0
        ? "needs-mapping"
        : input.sourceTemplateId === "legacy-auto-v1"
          ? "legacy-default"
          : input.sourceTemplateId === "generic-auto-v1"
            ? "generic-default"
            : "accurate";

  return {
    bindings: preservedBindings,
    status,
    portFingerprint: portSetFingerprint(physicalPorts),
    unmappedPortIds,
  };
}

const FACE_HEIGHT = 300;
const MAX_ELEMENTS = 500;
const MAX_PORT_SLOTS = 500;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/;
const SAFE_TEXT = /^[^<>]{0,160}$/;
const PROHIBITED_TEMPLATE_KEY =
  /(?:svg|path|url|href|script|style|css|html|src)/i;
const PROHIBITED_TEMPLATE_VALUE = /(?:<|>|javascript:|data:|https?:\/\/)/i;

function finiteInRange(value: unknown, label: string, min = 0, max = 1000) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new ValidationError(
      `${label} must be a finite number between ${min} and ${max}.`,
    );
  }
  return value;
}

function integerInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
) {
  const number = finiteInRange(value, label, min, max);
  if (!Number.isInteger(number)) {
    throw new ValidationError(`${label} must be an integer.`);
  }
  return number;
}

function validateId(value: unknown, label: string) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new ValidationError(`${label} must be a safe identifier.`);
  }
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function validateDeclarativeRecord(
  value: unknown,
  label: string,
  depth = 0,
): Record<string, unknown> {
  if (depth > 4) {
    throw new ValidationError(`${label} is nested too deeply.`);
  }
  const record = asRecord(value, label);
  const entries = Object.entries(record);
  if (entries.length > 64) {
    throw new ValidationError(`${label} contains too many fields.`);
  }
  return Object.fromEntries(
    entries.map(([key, entry]) => {
      if (!SAFE_ID.test(key) || PROHIBITED_TEMPLATE_KEY.test(key)) {
        throw new ValidationError(
          `${label}.${key} is not an allowed declarative field.`,
        );
      }
      if (typeof entry === "string") {
        if (entry.length > 500 || PROHIBITED_TEMPLATE_VALUE.test(entry)) {
          throw new ValidationError(
            `${label}.${key} contains unsupported markup or a URL.`,
          );
        }
        return [key, entry];
      }
      if (
        entry === null ||
        typeof entry === "boolean" ||
        (typeof entry === "number" && Number.isFinite(entry))
      ) {
        return [key, entry];
      }
      if (Array.isArray(entry)) {
        if (entry.length > 128) {
          throw new ValidationError(`${label}.${key} contains too many items.`);
        }
        return [
          key,
          entry.map((item, index) => {
            if (item && typeof item === "object" && !Array.isArray(item)) {
              return validateDeclarativeRecord(
                item,
                `${label}.${key}[${index}]`,
                depth + 1,
              );
            }
            if (
              typeof item === "string" &&
              (item.length > 500 || PROHIBITED_TEMPLATE_VALUE.test(item))
            ) {
              throw new ValidationError(
                `${label}.${key}[${index}] contains unsupported markup or a URL.`,
              );
            }
            if (
              item !== null &&
              typeof item !== "string" &&
              typeof item !== "boolean" &&
              !(typeof item === "number" && Number.isFinite(item))
            ) {
              throw new ValidationError(
                `${label}.${key}[${index}] is invalid.`,
              );
            }
            return item;
          }),
        ];
      }
      return [
        key,
        validateDeclarativeRecord(entry, `${label}.${key}`, depth + 1),
      ];
    }),
  );
}

function validateFace(value: unknown, label: string): FaceDefinitionV1 {
  const face = asRecord(value, label);
  if (face.schemaVersion !== 1 || face.width !== 1000) {
    throw new ValidationError(
      `${label} must use FaceDefinitionV1 on a 1000-unit canvas.`,
    );
  }
  const height = finiteInRange(face.height, `${label}.height`, 80, 1000);
  if (!Array.isArray(face.elements) || face.elements.length > MAX_ELEMENTS) {
    throw new ValidationError(
      `${label}.elements must contain at most ${MAX_ELEMENTS} primitives.`,
    );
  }

  const ids = new Set<string>();
  const elements = face.elements.map((entry, index) => {
    const primitive = asRecord(entry, `${label}.elements[${index}]`);
    const id = validateId(primitive.id, `${label}.elements[${index}].id`);
    if (ids.has(id))
      throw new ValidationError(
        `${label} contains duplicate primitive ID ${id}.`,
      );
    ids.add(id);
    const kind = String(primitive.kind ?? "");
    const x = finiteInRange(primitive.x, `${label}.${id}.x`);
    const y = finiteInRange(primitive.y, `${label}.${id}.y`, 0, height);

    if (kind === "screw" || kind === "indicator") {
      if (
        primitive.tone !== undefined &&
        !["dark", "mid", "light", "accent"].includes(String(primitive.tone))
      ) {
        throw new ValidationError(`${label}.${id}.tone is invalid.`);
      }
      return {
        kind: kind as "screw" | "indicator",
        id,
        x,
        y,
        radius: finiteInRange(
          primitive.radius,
          `${label}.${id}.radius`,
          1,
          100,
        ),
        ...(primitive.tone
          ? {
              tone: primitive.tone as FacePrimitiveV1 extends { tone?: infer T }
                ? T
                : never,
            }
          : {}),
      } as FacePrimitiveV1;
    }
    if (kind === "label") {
      if (
        typeof primitive.text !== "string" ||
        !SAFE_TEXT.test(primitive.text)
      ) {
        throw new ValidationError(
          `${label}.${id}.text contains unsupported markup or is too long.`,
        );
      }
      if (
        primitive.align !== undefined &&
        !["start", "middle", "end"].includes(String(primitive.align))
      ) {
        throw new ValidationError(`${label}.${id}.align is invalid.`);
      }
      return {
        kind: "label" as const,
        id,
        x,
        y,
        text: primitive.text,
        ...(primitive.align
          ? { align: primitive.align as "start" | "middle" | "end" }
          : {}),
      };
    }
    if (
      !["panel", "handle", "vent", "bay", "display", "outlet"].includes(kind)
    ) {
      throw new ValidationError(
        `${label}.${id}.kind is not an allowed Rackpad primitive.`,
      );
    }
    if (
      primitive.tone !== undefined &&
      !["dark", "mid", "light", "accent"].includes(String(primitive.tone))
    ) {
      throw new ValidationError(`${label}.${id}.tone is invalid.`);
    }
    const width = finiteInRange(
      primitive.width,
      `${label}.${id}.width`,
      1,
      1000,
    );
    const primitiveHeight = finiteInRange(
      primitive.height,
      `${label}.${id}.height`,
      1,
      height,
    );
    if (x + width > 1000 || y + primitiveHeight > height) {
      throw new ValidationError(`${label}.${id} exceeds the face bounds.`);
    }
    return {
      kind,
      id,
      x,
      y,
      width,
      height: primitiveHeight,
      ...(primitive.tone
        ? { tone: primitive.tone as "dark" | "mid" | "light" | "accent" }
        : {}),
    } as FacePrimitiveV1;
  });

  return { schemaVersion: 1, width: 1000, height, elements };
}

function validatePortSlot(value: unknown, index: number): PhysicalPortSlotV1 {
  const slot = asRecord(value, `portSlots[${index}]`);
  const face = slot.face;
  if (face !== "front" && face !== "rear") {
    throw new ValidationError(
      `portSlots[${index}].face must be front or rear.`,
    );
  }
  if (
    !Array.isArray(slot.acceptedPortKinds) ||
    slot.acceptedPortKinds.length === 0 ||
    slot.acceptedPortKinds.length > 32
  ) {
    throw new ValidationError(
      `portSlots[${index}].acceptedPortKinds must contain between 1 and 32 entries.`,
    );
  }
  const rotation = slot.rotation ?? 0;
  if (![0, 90, 180, 270].includes(Number(rotation))) {
    throw new ValidationError(`portSlots[${index}].rotation is invalid.`);
  }
  return {
    id: validateId(slot.id, `portSlots[${index}].id`),
    face,
    x: finiteInRange(slot.x, `portSlots[${index}].x`),
    y: finiteInRange(slot.y, `portSlots[${index}].y`),
    width: finiteInRange(slot.width, `portSlots[${index}].width`, 4, 200),
    height: finiteInRange(slot.height, `portSlots[${index}].height`, 4, 200),
    rotation: Number(rotation) as 0 | 90 | 180 | 270,
    connector: validateId(slot.connector, `portSlots[${index}].connector`),
    acceptedPortKinds: slot.acceptedPortKinds.map((kind, kindIndex) =>
      validateId(kind, `portSlots[${index}].acceptedPortKinds[${kindIndex}]`),
    ),
    ...(slot.groupId
      ? { groupId: validateId(slot.groupId, `portSlots[${index}].groupId`) }
      : {}),
    ...(slot.label
      ? {
          label:
            typeof slot.label === "string" && SAFE_TEXT.test(slot.label)
              ? slot.label
              : (() => {
                  throw new ValidationError(
                    `portSlots[${index}].label is invalid.`,
                  );
                })(),
        }
      : {}),
  };
}

export function validateHardwareTemplateV1(value: unknown): HardwareTemplateV1 {
  const template = asRecord(value, "template");
  if (template.schemaVersion !== 1) {
    throw new ValidationError("Hardware template schemaVersion must be 1.");
  }
  if (
    !Array.isArray(template.deviceTypes) ||
    template.deviceTypes.length > 64
  ) {
    throw new ValidationError(
      "deviceTypes must be an array with at most 64 entries.",
    );
  }
  if (
    !Array.isArray(template.portSlots) ||
    template.portSlots.length > MAX_PORT_SLOTS
  ) {
    throw new ValidationError(
      `portSlots must contain at most ${MAX_PORT_SLOTS} slots.`,
    );
  }
  const portSlots = template.portSlots.map(validatePortSlot);
  const slotIds = new Set<string>();
  for (const slot of portSlots) {
    if (slotIds.has(slot.id))
      throw new ValidationError(`Duplicate physical port slot ID ${slot.id}.`);
    slotIds.add(slot.id);
  }
  const mount = asRecord(template.mountDefaults, "mountDefaults");
  const kind = mount.kind;
  if (!["direct", "shelf", "side", "loose"].includes(String(kind))) {
    throw new ValidationError("mountDefaults.kind is invalid.");
  }
  const moduleSlots = Array.isArray(template.moduleSlots)
    ? template.moduleSlots
    : [];
  const modules = Array.isArray(template.modules) ? template.modules : [];
  const portBlueprints = Array.isArray(template.portBlueprints)
    ? template.portBlueprints
    : [];
  const driveBayBlueprints = Array.isArray(template.driveBayBlueprints)
    ? template.driveBayBlueprints
    : [];
  if (
    moduleSlots.length > 64 ||
    modules.length > 128 ||
    portBlueprints.length > 128 ||
    driveBayBlueprints.length > 128
  ) {
    throw new ValidationError(
      "Hardware template exceeds the supported module or blueprint limits.",
    );
  }
  const name = String(template.name ?? "").trim();
  const description = String(template.description ?? "").trim();
  if (!name || name.length > 120) {
    throw new ValidationError(
      "Hardware template name is required and must be at most 120 characters.",
    );
  }
  if (description.length > 500 || PROHIBITED_TEMPLATE_VALUE.test(description)) {
    throw new ValidationError("Hardware template description is invalid.");
  }
  const front = validateFace(template.front, "front");
  const rear = validateFace(template.rear, "rear");
  for (const slot of portSlots) {
    const face = slot.face === "front" ? front : rear;
    if (
      slot.x + slot.width > face.width ||
      slot.y + slot.height > face.height
    ) {
      throw new ValidationError(
        `Physical port slot ${slot.id} exceeds the ${slot.face} face bounds.`,
      );
    }
  }
  const moduleSlotIds = new Set<string>();

  const validatedModuleSlots = moduleSlots.map((entry, index) => {
    const moduleSlot = asRecord(entry, `moduleSlots[${index}]`);
    const face = moduleSlot.face;
    if (face !== "front" && face !== "rear") {
      throw new ValidationError(`moduleSlots[${index}].face is invalid.`);
    }
    const physicalFace: PhysicalFace = face;
    const id = validateId(moduleSlot.id, `moduleSlots[${index}].id`);
    if (moduleSlotIds.has(id)) {
      throw new ValidationError(`Duplicate module slot ID ${id}.`);
    }
    moduleSlotIds.add(id);
    const result = {
      id,
      face: physicalFace,
      x: finiteInRange(moduleSlot.x, `moduleSlots[${index}].x`),
      y: finiteInRange(moduleSlot.y, `moduleSlots[${index}].y`),
      width: finiteInRange(
        moduleSlot.width,
        `moduleSlots[${index}].width`,
        1,
        1000,
      ),
      height: finiteInRange(
        moduleSlot.height,
        `moduleSlots[${index}].height`,
        1,
        1000,
      ),
    };
    const faceDefinition = physicalFace === "front" ? front : rear;
    if (
      result.x + result.width > faceDefinition.width ||
      result.y + result.height > faceDefinition.height
    ) {
      throw new ValidationError(
        `Module slot ${result.id} exceeds the ${physicalFace} face bounds.`,
      );
    }
    return result;
  });
  const moduleSlotById = new Map(
    validatedModuleSlots.map((slot) => [slot.id, slot]),
  );
  const moduleIds = new Set<string>();
  const validatedModules = modules.map((entry, index): HardwareModuleV1 => {
    const module = asRecord(entry, `modules[${index}]`);
    const id = validateId(module.id, `modules[${index}].id`);
    if (moduleIds.has(id)) {
      throw new ValidationError(`Duplicate hardware module ID ${id}.`);
    }
    moduleIds.add(id);
    const slotId = validateId(module.slotId, `modules[${index}].slotId`);
    const moduleSlot = moduleSlotById.get(slotId);
    if (!moduleSlot) {
      throw new ValidationError(
        `Hardware module ${id} references missing module slot ${slotId}.`,
      );
    }
    if (module.face !== "front" && module.face !== "rear") {
      throw new ValidationError(`modules[${index}].face is invalid.`);
    }
    if (module.face !== moduleSlot.face) {
      throw new ValidationError(
        `Hardware module ${id} must use the same face as module slot ${slotId}.`,
      );
    }
    if (
      !Array.isArray(module.elements) ||
      module.elements.length > MAX_ELEMENTS
    ) {
      throw new ValidationError(
        `Hardware module ${id} contains too many primitives.`,
      );
    }
    if (
      !Array.isArray(module.portSlots) ||
      module.portSlots.length > MAX_PORT_SLOTS
    ) {
      throw new ValidationError(
        `Hardware module ${id} contains too many port slots.`,
      );
    }
    const faceDefinition = module.face === "front" ? front : rear;
    const elements = validateFace(
      {
        schemaVersion: 1,
        width: 1000,
        height: faceDefinition.height,
        elements: module.elements,
      },
      `modules[${index}]`,
    ).elements;
    const modulePortIds = new Set<string>();
    const modulePortSlots = module.portSlots.map((slot, slotIndex) => {
      const validated = validatePortSlot(slot, slotIndex);
      if (validated.face !== module.face) {
        throw new ValidationError(
          `Hardware module ${id} contains a port on another face.`,
        );
      }
      if (modulePortIds.has(validated.id) || slotIds.has(validated.id)) {
        throw new ValidationError(
          `Duplicate physical port slot ID ${validated.id}.`,
        );
      }
      modulePortIds.add(validated.id);
      const definition = module.face === "front" ? front : rear;
      if (
        validated.x + validated.width > definition.width ||
        validated.y + validated.height > definition.height
      ) {
        throw new ValidationError(
          `Hardware module port ${validated.id} exceeds the face bounds.`,
        );
      }
      return validated;
    });
    return {
      id,
      name:
        typeof module.name === "string" &&
        module.name.trim().length > 0 &&
        module.name.trim().length <= 120 &&
        SAFE_TEXT.test(module.name)
          ? module.name.trim()
          : (() => {
              throw new ValidationError(
                `Hardware module ${id} name is invalid.`,
              );
            })(),
      slotId,
      face: module.face,
      elements,
      portSlots: modulePortSlots,
    };
  });

  return {
    schemaVersion: 1,
    id: validateId(template.id, "id"),
    name,
    description,
    category: validateId(template.category, "category"),
    deviceTypes: [
      ...new Set(
        template.deviceTypes.map((entry, index) =>
          validateId(entry, `deviceTypes[${index}]`),
        ),
      ),
    ],
    mountDefaults: {
      kind: kind as HardwareTemplateV1["mountDefaults"]["kind"],
      heightU: integerInRange(mount.heightU, "mountDefaults.heightU", 1, 100),
      columnSpan: integerInRange(
        mount.columnSpan,
        "mountDefaults.columnSpan",
        1,
        12,
      ),
    },
    front,
    rear,
    portSlots,
    moduleSlots: validatedModuleSlots,
    modules: validatedModules,
    portBlueprints: portBlueprints.map((entry, index) =>
      validateDeclarativeRecord(entry, `portBlueprints[${index}]`),
    ),
    driveBayBlueprints: driveBayBlueprints.map((entry, index) =>
      validateDeclarativeRecord(entry, `driveBayBlueprints[${index}]`),
    ),
  };
}

export function validateResolvedPhysicalLayoutV1(
  value: unknown,
): ResolvedPhysicalLayoutV1 {
  const layout = asRecord(value, "physical layout");
  if (layout.schemaVersion !== 1) {
    throw new ValidationError("Physical layout schemaVersion must be 1.");
  }
  const mount = asRecord(layout.mount, "physical layout mount");
  if (!["direct", "shelf", "side", "loose"].includes(String(mount.kind))) {
    throw new ValidationError("Physical layout mount kind is invalid.");
  }
  const faces = asRecord(layout.faces, "physical layout faces");
  if (
    !Array.isArray(layout.portSlots) ||
    layout.portSlots.length > MAX_PORT_SLOTS
  ) {
    throw new ValidationError(
      `Physical layout must contain at most ${MAX_PORT_SLOTS} port slots.`,
    );
  }
  const portSlots = layout.portSlots.map(validatePortSlot);
  const slotIds = new Set<string>();
  for (const slot of portSlots) {
    if (slotIds.has(slot.id)) {
      throw new ValidationError(`Duplicate physical port slot ID ${slot.id}.`);
    }
    slotIds.add(slot.id);
  }
  const front = validateFace(faces.front, "physical layout front");
  const rear = validateFace(faces.rear, "physical layout rear");
  for (const slot of portSlots) {
    const face = slot.face === "front" ? front : rear;
    if (
      slot.x + slot.width > face.width ||
      slot.y + slot.height > face.height
    ) {
      throw new ValidationError(
        `Physical port slot ${slot.id} exceeds the ${slot.face} face bounds.`,
      );
    }
  }
  const column = integerInRange(
    mount.column,
    "physical layout mount.column",
    0,
    11,
  );
  const columnSpan = integerInRange(
    mount.columnSpan,
    "physical layout mount.columnSpan",
    1,
    12,
  );
  if (column + columnSpan > 12) {
    throw new ValidationError(
      "Physical layout mount exceeds the 12-column rack grid.",
    );
  }
  return {
    schemaVersion: 1,
    sourceTemplateId: validateId(
      layout.sourceTemplateId,
      "physical layout sourceTemplateId",
    ),
    category: validateId(layout.category, "physical layout category"),
    mount: {
      kind: mount.kind as ResolvedPhysicalLayoutV1["mount"]["kind"],
      heightU: integerInRange(
        mount.heightU,
        "physical layout mount.heightU",
        1,
        100,
      ),
      column,
      columnSpan,
    },
    faces: {
      front,
      rear,
    },
    portSlots,
    ...(layout.moduleIds !== undefined
      ? {
          moduleIds: (() => {
            if (
              !Array.isArray(layout.moduleIds) ||
              layout.moduleIds.length > 64
            ) {
              throw new ValidationError(
                "Physical layout moduleIds must contain at most 64 entries.",
              );
            }
            return [
              ...new Set(
                layout.moduleIds.map((id, index) =>
                  validateId(id, `physical layout moduleIds[${index}]`),
                ),
              ),
            ];
          })(),
        }
      : {}),
  };
}

export function validatePortBindingsV1(
  value: unknown,
  options: { portIds?: Set<string>; slotIds?: Set<string> } = {},
) {
  if (!Array.isArray(value) || value.length > MAX_PORT_SLOTS) {
    throw new ValidationError(
      `Physical layout bindings must contain at most ${MAX_PORT_SLOTS} entries.`,
    );
  }
  const portIds = new Set<string>();
  const slotIds = new Set<string>();
  return value.map((entry, index): PortBindingV1 => {
    const binding = asRecord(entry, `bindings[${index}]`);
    const portId = validateId(binding.portId, `bindings[${index}].portId`);
    const slotId = validateId(binding.slotId, `bindings[${index}].slotId`);
    if (portIds.has(portId) || slotIds.has(slotId)) {
      throw new ValidationError(
        "Physical layout bindings cannot reuse a port or slot.",
      );
    }
    if (options.portIds && !options.portIds.has(portId)) {
      throw new ValidationError(
        `Physical layout binding references missing port ${portId}.`,
      );
    }
    if (options.slotIds && !options.slotIds.has(slotId)) {
      throw new ValidationError(
        `Physical layout binding references missing slot ${slotId}.`,
      );
    }
    portIds.add(portId);
    slotIds.add(slotId);
    return { portId, slotId };
  });
}

function connectorDimensions(kind: string) {
  if (kind === "power") return { width: 44, height: 54 };
  if (kind === "usb") return { width: 38, height: 18 };
  if (kind === "console") return { width: 42, height: 24 };
  if (kind === "qsfp") return { width: 42, height: 28 };
  if (
    kind === "sfp" ||
    kind === "sfp_plus" ||
    kind === "fiber" ||
    kind === "sff"
  ) {
    return { width: 34, height: 25 };
  }
  return { width: 38, height: 34 };
}

function faceElements(
  face: PhysicalFace,
  deviceType: string,
): FacePrimitiveV1[] {
  return [
    {
      kind: "panel",
      id: `${face}-panel`,
      x: 18,
      y: 18,
      width: 964,
      height: 264,
      tone: "mid",
    },
    {
      kind: "handle",
      id: `${face}-handle-left`,
      x: 28,
      y: 62,
      width: 34,
      height: 176,
      tone: "dark",
    },
    {
      kind: "handle",
      id: `${face}-handle-right`,
      x: 938,
      y: 62,
      width: 34,
      height: 176,
      tone: "dark",
    },
    {
      kind: "vent",
      id: `${face}-vent`,
      x: 92,
      y: 54,
      width: 816,
      height: 192,
      tone: "dark",
    },
    {
      kind: "screw",
      id: `${face}-screw-tl`,
      x: 45,
      y: 42,
      radius: 8,
      tone: "light",
    },
    {
      kind: "screw",
      id: `${face}-screw-tr`,
      x: 955,
      y: 42,
      radius: 8,
      tone: "light",
    },
    {
      kind: "screw",
      id: `${face}-screw-bl`,
      x: 45,
      y: 258,
      radius: 8,
      tone: "light",
    },
    {
      kind: "screw",
      id: `${face}-screw-br`,
      x: 955,
      y: 258,
      radius: 8,
      tone: "light",
    },
    {
      kind: "label",
      id: `${face}-label`,
      x: 94,
      y: 42,
      text: `${deviceType} · ${face}`,
      align: "start",
    },
    {
      kind: "indicator",
      id: `${face}-indicator`,
      x: 900,
      y: 39,
      radius: 7,
      tone: "accent",
    },
  ];
}

function buildFaceSlots(face: PhysicalFace, ports: PhysicalLayoutPort[]) {
  if (ports.length === 0) return [];
  const columns = Math.min(
    24,
    Math.max(1, Math.ceil(Math.sqrt(ports.length * 4))),
  );
  const rows = Math.ceil(ports.length / columns);
  const availableWidth = 780;
  const availableHeight = 154;
  const cellWidth = availableWidth / columns;
  const cellHeight = availableHeight / Math.max(1, rows);

  return ports.map((port, index): PhysicalPortSlotV1 => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const dimensions = connectorDimensions(port.kind);
    const width = Math.min(dimensions.width, Math.max(10, cellWidth - 6));
    const height = Math.min(dimensions.height, Math.max(10, cellHeight - 6));
    return {
      id: `slot:${port.id}`,
      face,
      x: 110 + column * cellWidth + (cellWidth - width) / 2,
      y: 82 + row * cellHeight + (cellHeight - height) / 2,
      width,
      height,
      rotation: 0,
      connector: port.kind,
      acceptedPortKinds: [port.kind],
      groupId: `${face}-auto`,
      label: port.name.replace(/[<>]/g, "").slice(0, 160),
    };
  });
}

export function portSetFingerprint(ports: PhysicalLayoutPort[]) {
  const canonical = [...ports]
    .filter(isPhysicalLayoutPort)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((port) => [
      port.id,
      port.position,
      port.kind,
      port.face ?? "front",
      port.portRole ?? "physical",
    ]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function buildAutoPhysicalLayout(
  device: PhysicalLayoutDevice,
  ports: PhysicalLayoutPort[],
  mode: "legacy" | "generic",
): {
  snapshot: ResolvedPhysicalLayoutV1;
  bindings: PortBindingV1[];
  status: PhysicalLayoutStatus;
} {
  const physicalPorts = ports.filter(isPhysicalLayoutPort);
  const frontPorts = physicalPorts
    .filter((port) => port.face !== "rear")
    .sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id),
    );
  const rearPorts = physicalPorts
    .filter((port) => port.face === "rear")
    .sort(
      (left, right) =>
        left.position - right.position || left.id.localeCompare(right.id),
    );
  const portSlots = [
    ...buildFaceSlots("front", frontPorts),
    ...buildFaceSlots("rear", rearPorts),
  ];
  const rackSlot = device.rackSlot ?? "full";
  const column = rackSlot === "right" ? 6 : 0;
  const columnSpan = rackSlot === "full" ? 12 : 6;
  const sourceTemplateId =
    mode === "legacy" ? "legacy-auto-v1" : "generic-auto-v1";

  return {
    status: mode === "legacy" ? "legacy-default" : "generic-default",
    snapshot: {
      schemaVersion: 1,
      sourceTemplateId,
      category: device.deviceType,
      mount: {
        kind:
          device.placement === "shelf"
            ? "shelf"
            : device.placement === "rack"
              ? "direct"
              : "loose",
        heightU: Math.max(1, device.heightU ?? 1),
        column,
        columnSpan,
      },
      faces: {
        front: {
          schemaVersion: 1,
          width: 1000,
          height: FACE_HEIGHT,
          elements: faceElements("front", device.deviceType),
        },
        rear: {
          schemaVersion: 1,
          width: 1000,
          height: FACE_HEIGHT,
          elements: faceElements("rear", device.deviceType),
        },
      },
      portSlots,
    },
    bindings: portSlots.map((slot) => ({
      portId: slot.id.slice("slot:".length),
      slotId: slot.id,
    })),
  };
}

export function resolveTemplateSnapshot(
  template: HardwareTemplateV1,
  device: PhysicalLayoutDevice,
  requestedModuleIds: string[] = [],
): ResolvedPhysicalLayoutV1 {
  const moduleById = new Map(
    template.modules.map((module) => [module.id, module]),
  );
  const selectedModules = requestedModuleIds.map((moduleId) => {
    const module = moduleById.get(moduleId);
    if (!module) {
      throw new ValidationError(
        `Hardware module ${moduleId} does not exist in this template.`,
      );
    }
    return module;
  });
  const usedModuleSlots = new Set<string>();
  for (const module of selectedModules) {
    if (usedModuleSlots.has(module.slotId)) {
      throw new ValidationError(
        `Only one hardware module may be installed in slot ${module.slotId}.`,
      );
    }
    usedModuleSlots.add(module.slotId);
  }
  const resolvedPortSlots = [
    ...template.portSlots,
    ...selectedModules.flatMap((module) => module.portSlots),
  ];
  const resolvedSlotIds = new Set<string>();
  for (const slot of resolvedPortSlots) {
    if (resolvedSlotIds.has(slot.id)) {
      throw new ValidationError(
        `Selected hardware modules produce duplicate port slot ${slot.id}.`,
      );
    }
    resolvedSlotIds.add(slot.id);
  }
  for (const face of ["front", "rear"] as const) {
    const elements = [
      ...template[face].elements,
      ...selectedModules
        .filter((module) => module.face === face)
        .flatMap((module) => module.elements),
    ];
    if (elements.length > MAX_ELEMENTS) {
      throw new ValidationError(
        `Selected hardware modules exceed the ${face} primitive limit.`,
      );
    }
    const ids = new Set<string>();
    for (const element of elements) {
      if (ids.has(element.id)) {
        throw new ValidationError(
          `Selected hardware modules produce duplicate primitive ${element.id}.`,
        );
      }
      ids.add(element.id);
    }
  }
  return {
    schemaVersion: 1,
    sourceTemplateId: template.id,
    category: template.category,
    mount: {
      kind: template.mountDefaults.kind,
      heightU: Math.max(1, device.heightU ?? template.mountDefaults.heightU),
      column: device.rackSlot === "right" ? 6 : 0,
      columnSpan:
        device.rackSlot === "full" || !device.rackSlot
          ? template.mountDefaults.columnSpan
          : Math.min(6, template.mountDefaults.columnSpan),
    },
    faces: {
      front: {
        ...template.front,
        elements: [
          ...template.front.elements,
          ...selectedModules
            .filter((module) => module.face === "front")
            .flatMap((module) => module.elements),
        ],
      },
      rear: {
        ...template.rear,
        elements: [
          ...template.rear.elements,
          ...selectedModules
            .filter((module) => module.face === "rear")
            .flatMap((module) => module.elements),
        ],
      },
    },
    portSlots: resolvedPortSlots,
    moduleIds: selectedModules.map((module) => module.id),
  };
}

export const BUILT_IN_HARDWARE_TEMPLATES: HardwareTemplateV1[] = [
  {
    schemaVersion: 1,
    id: "generic-auto-v1",
    name: "Rackpad generic auto layout",
    description:
      "A deterministic Rackpad-authored compatibility layout generated from a device's real ports.",
    category: "generic",
    deviceTypes: [],
    mountDefaults: { kind: "direct", heightU: 1, columnSpan: 12 },
    front: {
      schemaVersion: 1,
      width: 1000,
      height: FACE_HEIGHT,
      elements: faceElements("front", "generic"),
    },
    rear: {
      schemaVersion: 1,
      width: 1000,
      height: FACE_HEIGHT,
      elements: faceElements("rear", "generic"),
    },
    portSlots: [],
    moduleSlots: [],
    modules: [],
    portBlueprints: [],
    driveBayBlueprints: [],
    builtIn: true,
  },
  {
    schemaVersion: 1,
    id: "legacy-auto-v1",
    name: "Rackpad legacy compatibility layout",
    description:
      "The versioned layout assigned to devices that existed before physical layouts were introduced.",
    category: "generic",
    deviceTypes: [],
    mountDefaults: { kind: "direct", heightU: 1, columnSpan: 12 },
    front: {
      schemaVersion: 1,
      width: 1000,
      height: FACE_HEIGHT,
      elements: faceElements("front", "legacy"),
    },
    rear: {
      schemaVersion: 1,
      width: 1000,
      height: FACE_HEIGHT,
      elements: faceElements("rear", "legacy"),
    },
    portSlots: [],
    moduleSlots: [],
    modules: [],
    portBlueprints: [],
    driveBayBlueprints: [],
    builtIn: true,
  },
];

export const RESERVED_HARDWARE_TEMPLATE_IDS = new Set(
  [
    ...BUILT_IN_HARDWARE_TEMPLATES.map((template) => template.id),
    "device-custom-v1",
  ],
);

export function isReservedHardwareTemplateId(templateId: string) {
  return RESERVED_HARDWARE_TEMPLATE_IDS.has(templateId);
}
