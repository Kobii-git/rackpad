import { optionalEnum, optionalString, ValidationError } from "./validation.js";

export function optionalHeaderColor(body: Record<string, unknown>) {
  const color = optionalString(body, "headerColor", { maxLength: 7 });
  if (color && !/^#[0-9a-f]{6}$/i.test(color))
    throw new ValidationError(
      "Header color must be a six-digit hexadecimal color.",
    );
  return color?.toLowerCase() ?? color;
}

export function optionalLabelPosition(body: Record<string, unknown>) {
  return optionalEnum(body, "labelPosition", [
    "upper-left",
    "upper-right",
  ] as const);
}
