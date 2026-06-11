import { parse as parseYaml } from "yaml";
import { db } from "../db.js";
import type { PortTemplate, PortTemplateKind } from "./port-templates.js";
import { listPortTemplates } from "./port-templates.js";
import { ValidationError } from "./validation.js";

export interface NetBoxInterfaceEntry {
  name: string;
  type: string;
  section: "interface" | "console" | "power";
}

export interface ParsedNetBoxDeviceType {
  manufacturer: string;
  model: string;
  slug?: string;
  partNumber?: string;
  uHeight: number;
  interfaces: NetBoxInterfaceEntry[];
  sourceLabel: string;
}

export interface NetBoxPortTemplateDraft {
  name: string;
  description: string;
  deviceTypes: string[];
  ports: Array<{
    name: string;
    position: number;
    kind: PortTemplateKind;
    speed?: string;
    face: "front" | "rear";
    mode: "access";
    allowedVlanIds: [];
  }>;
}

export interface NetBoxImportPreview {
  parsed: ParsedNetBoxDeviceType;
  dedupeKey: string;
  existingTemplate: { id: string; name: string; builtIn?: boolean } | null;
  existingDevice: { id: string; hostname: string } | null;
  portTemplateDraft: NetBoxPortTemplateDraft;
  deviceDraft: NetBoxDeviceDraft;
}

export interface NetBoxDeviceDraft {
  suggestedHostname: string;
  manufacturer: string;
  model: string;
  heightU: number | null;
  placement: "room" | "wireless";
  deviceType: string;
  displayName: string;
  notes: string;
  portCount: number;
}

const NETBOX_DESCRIPTION_PREFIX = "netbox:";
const NETBOX_DEVICE_NOTES_PREFIX = "netbox-device:";

const INTERFACE_TYPE_MAP: Record<
  string,
  { kind: PortTemplateKind; speed?: string }
> = {
  "100base-tx": { kind: "rj45", speed: "100M" },
  "1000base-t": { kind: "rj45", speed: "1G" },
  "1000base-x-sfp": { kind: "sfp", speed: "1G" },
  "1000base-x-sfpdd": { kind: "sfp", speed: "1G" },
  "2.5gbase-t": { kind: "rj45", speed: "2.5G" },
  "5gbase-t": { kind: "rj45", speed: "5G" },
  "10gbase-t": { kind: "rj45", speed: "10G" },
  "10gbase-x-sfpp": { kind: "sfp_plus", speed: "10G" },
  "10gbase-x-xfp": { kind: "sfp_plus", speed: "10G" },
  "10gbase-x-xfpp": { kind: "sfp_plus", speed: "10G" },
  "25gbase-x-sfp28": { kind: "sfp", speed: "25G" },
  "40gbase-x-qsfpp": { kind: "qsfp", speed: "40G" },
  "100gbase-x-qsfp28": { kind: "qsfp", speed: "100G" },
  "100gbase-x-qsfpdd": { kind: "qsfp", speed: "100G" },
  virtual: { kind: "virtual" },
  lag: { kind: "virtual" },
  bridge: { kind: "virtual" },
  other: { kind: "rj45" },
};

function normalizeDedupePart(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function netboxDedupeKey(manufacturer: string, model: string) {
  return `${normalizeDedupePart(manufacturer)}::${normalizeDedupePart(model)}`;
}

export function parseNetboxDescriptionKey(description: string) {
  if (!description.startsWith(NETBOX_DESCRIPTION_PREFIX)) return null;
  const body = description.slice(NETBOX_DESCRIPTION_PREFIX.length);
  const separator = body.indexOf(" | ");
  const key = (separator >= 0 ? body.slice(0, separator) : body).trim();
  return key || null;
}

export function templateMatchesNetboxDedupe(
  template: Pick<PortTemplate, "name" | "description">,
  manufacturer: string,
  model: string,
) {
  const key = netboxDedupeKey(manufacturer, model);
  const descriptionKey = parseNetboxDescriptionKey(template.description);
  if (descriptionKey === key) return true;
  return (
    normalizeDedupePart(template.name) ===
    normalizeDedupePart(`${manufacturer} ${model}`)
  );
}

export function findExistingNetboxTemplate(
  manufacturer: string,
  model: string,
  templates: PortTemplate[] = listPortTemplates(),
) {
  return (
    templates.find((template) =>
      templateMatchesNetboxDedupe(template, manufacturer, model),
    ) ?? null
  );
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be a YAML mapping.`);
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (value === undefined || value === null || value === "") {
    throw new ValidationError(`${label} is required.`);
  }
  const text = String(value).trim();
  if (!text) {
    throw new ValidationError(`${label} is required.`);
  }
  return text;
}

function readOptionalString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function readUHeight(record: Record<string, unknown>) {
  const raw = record.u_height ?? record.uHeight;
  if (raw === undefined || raw === null || raw === "") {
    throw new ValidationError("u_height is required.");
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError("u_height must be zero or a positive number.");
  }
  return Math.round(value);
}

function readPortList(
  record: Record<string, unknown>,
  key: string,
  section: NetBoxInterfaceEntry["section"],
) {
  const raw = record[key];
  if (raw === undefined || raw === null) return [] as NetBoxInterfaceEntry[];
  if (!Array.isArray(raw)) {
    throw new ValidationError(`${key} must be a list when present.`);
  }

  return raw.map((entry, index) => {
    const item = asRecord(entry, `${key}[${index}]`);
    const name = readString(item, "name", `${key}[${index}].name`);
    const type = readOptionalString(item, "type") ?? "other";
    return { name, type, section };
  });
}

function mapInterfaceKind(
  type: string,
  section: NetBoxInterfaceEntry["section"],
) {
  if (section === "console") {
    return { kind: "console" as const, speed: undefined };
  }
  if (section === "power") {
    return { kind: "power" as const, speed: undefined };
  }

  const mapped = INTERFACE_TYPE_MAP[type.toLowerCase()];
  if (mapped) return mapped;

  const normalized = type.toLowerCase();
  if (normalized.includes("qsfp"))
    return { kind: "qsfp" as const, speed: "40G" };
  if (normalized.includes("sfpp") || normalized.includes("sfp+")) {
    return { kind: "sfp_plus" as const, speed: "10G" };
  }
  if (normalized.includes("sfp")) return { kind: "sfp" as const, speed: "1G" };
  if (normalized.includes("virtual")) return { kind: "virtual" as const };
  if (normalized.includes("console")) return { kind: "console" as const };
  if (normalized.includes("usb")) return { kind: "usb" as const };
  return { kind: "rj45" as const, speed: "1G" };
}

function inferDeviceTypes(parsed: ParsedNetBoxDeviceType): string[] {
  const dataInterfaces = parsed.interfaces.filter(
    (entry) => entry.section === "interface",
  ).length;
  const modelText = `${parsed.manufacturer} ${parsed.model}`.toLowerCase();
  const looksLikeAccessPoint =
    dataInterfaces <= 4 &&
    /\b(access[\s-]?point|wireless|wi-?fi|wlan|aironet|fortiap|uap|eap\d*|wap\d*|meraki\s+mr|aruba\s+ap|ruckus|omada|ecw\d*|u6[-\s]|u7[-\s])\b/.test(
      modelText,
    );

  if (/patch[\s-]?panel/.test(modelText)) return ["patch_panel"];
  if (looksLikeAccessPoint) return ["ap"];
  if (/pdu|ups|power\s+distribution/.test(modelText) && dataInterfaces === 0) {
    return ["pdu", "ups"];
  }
  if (/firewall/.test(modelText)) return ["firewall"];
  if (/router/.test(modelText)) return ["router"];
  if (
    /switch|catalyst|nexus|arista|procurve|fortigate|meraki|mx-|ex-|qfx|asr|isr/.test(
      modelText,
    )
  ) {
    return ["switch"];
  }
  if (dataInterfaces >= 8) return ["switch"];
  if (dataInterfaces >= 1) return ["server"];
  return ["server"];
}

function buildTemplateDescription(parsed: ParsedNetBoxDeviceType) {
  const key = netboxDedupeKey(parsed.manufacturer, parsed.model);
  const details = [
    `U-height: ${parsed.uHeight}`,
    `${parsed.interfaces.length} documented ports`,
    parsed.partNumber ? `Part: ${parsed.partNumber}` : null,
    parsed.slug ? `Slug: ${parsed.slug}` : null,
  ]
    .filter(Boolean)
    .join("; ");
  return `${NETBOX_DESCRIPTION_PREFIX}${key} | NetBox device type library import. ${details}`;
}

export function buildNetboxPortTemplateDraft(
  parsed: ParsedNetBoxDeviceType,
): NetBoxPortTemplateDraft {
  const ports = parsed.interfaces.map((entry, index) => {
    const mapped = mapInterfaceKind(entry.type, entry.section);
    return {
      name: entry.name,
      position: index + 1,
      kind: mapped.kind,
      speed: mapped.speed,
      face: entry.section === "power" ? ("rear" as const) : ("front" as const),
      mode: "access" as const,
      allowedVlanIds: [] as [],
    };
  });

  if (ports.length === 0) {
    throw new ValidationError(
      "NetBox device type must include at least one interface, console port, or power port.",
    );
  }

  return {
    name: `${parsed.manufacturer} ${parsed.model}`.slice(0, 120),
    description: buildTemplateDescription(parsed),
    deviceTypes: inferDeviceTypes(parsed),
    ports,
  };
}

export function parseNetBoxDeviceTypeYaml(
  yamlText: string,
): ParsedNetBoxDeviceType {
  const trimmed = yamlText.trim();
  if (!trimmed) {
    throw new ValidationError("YAML content is empty.");
  }

  let document: unknown;
  try {
    document = parseYaml(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid YAML.";
    throw new ValidationError(
      `Could not parse NetBox device type YAML: ${message}`,
    );
  }

  const record = asRecord(document, "device type");
  const manufacturer = readString(record, "manufacturer", "manufacturer");
  const model = readString(record, "model", "model");
  const uHeight = readUHeight(record);

  const interfaces = [
    ...readPortList(record, "interfaces", "interface"),
    ...readPortList(record, "console-ports", "console"),
    ...readPortList(record, "consoleports", "console"),
    ...readPortList(record, "power-ports", "power"),
    ...readPortList(record, "powerports", "power"),
  ];

  return {
    manufacturer,
    model,
    slug: readOptionalString(record, "slug"),
    partNumber: readOptionalString(record, "part_number"),
    uHeight,
    interfaces,
    sourceLabel: `${manufacturer} ${model}`,
  };
}

export function findExistingNetboxDevice(manufacturer: string, model: string) {
  const prefix = `${NETBOX_DEVICE_NOTES_PREFIX}${netboxDedupeKey(manufacturer, model)}`;
  const row = db
    .prepare("SELECT id, hostname FROM devices WHERE notes LIKE ? LIMIT 1")
    .get(`${prefix}%`) as { id: string; hostname: string } | undefined;
  return row ?? null;
}

function slugifyHostname(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "netbox-device"
  );
}

export function buildNetboxDeviceNotes(parsed: ParsedNetBoxDeviceType) {
  const key = netboxDedupeKey(parsed.manufacturer, parsed.model);
  return `${NETBOX_DEVICE_NOTES_PREFIX}${key} | NetBox device type library import.`;
}

export function buildNetboxDeviceDraft(
  parsed: ParsedNetBoxDeviceType,
): NetBoxDeviceDraft {
  const templateDraft = buildNetboxPortTemplateDraft(parsed);
  const deviceType = templateDraft.deviceTypes[0] ?? "server";
  return {
    suggestedHostname: slugifyHostname(parsed.slug ?? parsed.model),
    manufacturer: parsed.manufacturer,
    model: parsed.model,
    heightU: parsed.uHeight > 0 ? parsed.uHeight : null,
    placement: deviceType === "ap" ? "wireless" : "room",
    deviceType,
    displayName: `${parsed.manufacturer} ${parsed.model}`.slice(0, 120),
    notes: buildNetboxDeviceNotes(parsed),
    portCount: templateDraft.ports.length,
  };
}

export function previewNetboxDeviceTypeImport(
  yamlText: string,
  templates: PortTemplate[] = listPortTemplates(),
): NetBoxImportPreview {
  const parsed = parseNetBoxDeviceTypeYaml(yamlText);
  const dedupeKey = netboxDedupeKey(parsed.manufacturer, parsed.model);
  const existingTemplate = findExistingNetboxTemplate(
    parsed.manufacturer,
    parsed.model,
    templates,
  );
  const portTemplateDraft = buildNetboxPortTemplateDraft(parsed);

  return {
    parsed,
    dedupeKey,
    existingTemplate: existingTemplate
      ? {
          id: existingTemplate.id,
          name: existingTemplate.name,
          builtIn: existingTemplate.builtIn,
        }
      : null,
    existingDevice: findExistingNetboxDevice(parsed.manufacturer, parsed.model),
    portTemplateDraft,
    deviceDraft: buildNetboxDeviceDraft(parsed),
  };
}
