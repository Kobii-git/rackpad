import {
  hardwareTemplateCopyId,
  hardwareTemplateCopyName,
  safeId,
} from "./hardware-template-builder";
import type { HardwareTemplateV1 } from "./types";

export const MAX_TEMPLATE_FILE_BYTES = 10 * 1024 * 1024;

const definitionFields = [
  "schemaVersion",
  "id",
  "name",
  "description",
  "category",
  "deviceTypes",
  "mountDefaults",
  "front",
  "rear",
  "portSlots",
  "moduleSlots",
  "modules",
  "portBlueprints",
  "driveBayBlueprints",
] as const;

function definition(value: Record<string, unknown>) {
  return Object.fromEntries(definitionFields.map((key) => [key, value[key]]));
}

export function exportHardwareTemplate(template: HardwareTemplateV1) {
  return {
    filename: `rackpad-template-${safeId(template.name).replace(/[.:]/g, "-")}.json`,
    content: JSON.stringify(definition({ ...template }), null, 2) + "\n",
  };
}

export class HardwareTemplateFileError extends Error {}

// The result stays untrusted until POST /hardware-templates validates it. Never
// install file contents in the editor or render its geometry before that check.
export function prepareHardwareTemplateImport(
  text: string,
  deviceType: string,
  templates: Pick<HardwareTemplateV1, "name">[],
): Record<string, unknown> {
  let source: unknown;
  try {
    source = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new HardwareTemplateFileError();
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new HardwareTemplateFileError();
  }
  const value = source as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.trim().length > 120
  ) {
    throw new HardwareTemplateFileError();
  }
  const name = value.name.trim();
  return {
    ...definition(value),
    id: hardwareTemplateCopyId("imported-template"),
    name: templates.some(
      (template) => template.name.toLowerCase() === name.toLowerCase(),
    )
      ? hardwareTemplateCopyName(name, templates)
      : name,
    deviceTypes: [deviceType],
  };
}
