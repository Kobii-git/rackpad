import type { Device, DeviceType, DeviceTypeDefinition, PortTemplate } from "./types";

export const BUILT_IN_DEVICE_TYPES: DeviceTypeDefinition[] = [
  { id: "switch", label: "Switch", builtIn: true },
  { id: "router", label: "Router", builtIn: true },
  { id: "firewall", label: "Firewall", builtIn: true },
  { id: "server", label: "Server", builtIn: true },
  { id: "rack_shelf", label: "Rack shelf", builtIn: true },
  { id: "ap", label: "Access point", builtIn: true },
  { id: "endpoint", label: "Endpoint", builtIn: true },
  { id: "vm", label: "Virtual machine", builtIn: true },
  { id: "container", label: "Container", builtIn: true },
  { id: "patch_panel", label: "Patch panel", builtIn: true },
  { id: "brush_panel", label: "Brush panel", builtIn: true },
  { id: "blanking_panel", label: "Blanking panel", builtIn: true },
  { id: "storage", label: "Storage", builtIn: true },
  { id: "pdu", label: "PDU", builtIn: true },
  { id: "ups", label: "UPS", builtIn: true },
  { id: "kvm", label: "KVM", builtIn: true },
  { id: "other", label: "Other", builtIn: true },
];

const BUILT_IN_IDS = new Set(BUILT_IN_DEVICE_TYPES.map((type) => type.id));

export function normalizeDeviceTypeId(value: string) {
  let normalized = "";
  let pendingSeparator = false;

  const appendSeparator = () => {
    pendingSeparator = normalized.length > 0;
  };
  const appendCharacter = (character: string) => {
    if (pendingSeparator && normalized.length > 0) normalized += "_";
    normalized += character;
    pendingSeparator = false;
  };
  const appendWord = (word: string) => {
    appendSeparator();
    for (const character of word) appendCharacter(character);
    appendSeparator();
  };

  for (const character of value.trim().toLowerCase()) {
    const code = character.charCodeAt(0);
    const isAlphaNumeric =
      (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
    if (isAlphaNumeric) {
      appendCharacter(character);
    } else if (character === "&") {
      appendWord("and");
    } else if (character !== "'") {
      appendSeparator();
    }
    if (normalized.length >= 48) break;
  }

  return normalized.slice(0, 48);
}

export function defaultDeviceTypeLabel(type: DeviceType) {
  return type
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function deviceTypeLabel(
  type: DeviceType | null | undefined,
  definitions: DeviceTypeDefinition[] = BUILT_IN_DEVICE_TYPES,
) {
  if (!type) return "Other";
  return (
    definitions.find((entry) => entry.id === type)?.label ??
    defaultDeviceTypeLabel(type)
  );
}

export function deviceTypeBase(
  type: DeviceType | null | undefined,
  definitions: DeviceTypeDefinition[] = BUILT_IN_DEVICE_TYPES,
): DeviceType {
  if (!type) return "other";
  const byId = new Map(
    [...BUILT_IN_DEVICE_TYPES, ...definitions].map((entry) => [
      entry.id,
      entry,
    ]),
  );
  const seen = new Set<DeviceType>();
  let current = type;
  while (!seen.has(current)) {
    seen.add(current);
    const parent = byId.get(current)?.parentType;
    if (!parent || parent === current) return current;
    current = parent;
  }
  return type;
}

export function deviceTypeMatchesTemplate(
  deviceType: DeviceType,
  templateDeviceTypes: DeviceType[],
  definitions: DeviceTypeDefinition[] = BUILT_IN_DEVICE_TYPES,
) {
  if (templateDeviceTypes.includes(deviceType)) return true;
  const baseType = deviceTypeBase(deviceType, definitions);
  return baseType !== deviceType && templateDeviceTypes.includes(baseType);
}

export function mergeDeviceTypeDefinitions(
  definitions: DeviceTypeDefinition[],
  context: {
    devices?: Device[];
    portTemplates?: PortTemplate[];
  } = {},
) {
  const merged = new Map<string, DeviceTypeDefinition>();
  for (const definition of [...BUILT_IN_DEVICE_TYPES, ...definitions]) {
    merged.set(definition.id, definition);
  }

  for (const device of context.devices ?? []) {
    if (merged.has(device.deviceType)) continue;
    merged.set(device.deviceType, {
      id: device.deviceType,
      label: defaultDeviceTypeLabel(device.deviceType),
      builtIn: BUILT_IN_IDS.has(device.deviceType),
    });
  }

  for (const template of context.portTemplates ?? []) {
    for (const deviceType of template.deviceTypes) {
      if (merged.has(deviceType)) continue;
      merged.set(deviceType, {
        id: deviceType,
        label: defaultDeviceTypeLabel(deviceType),
        builtIn: BUILT_IN_IDS.has(deviceType),
      });
    }
  }

  return [...merged.values()].sort((a, b) => {
    if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  });
}
