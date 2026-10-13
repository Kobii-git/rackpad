import { db } from "../db.js";
import { deviceTypeBase } from "./device-types.js";
import { isStackType, assertStackDeviceEdit } from "./device-stacks.js";
import { ValidationError } from "./validation.js";
import {
  createRackStudioPlacementResolver,
  type RackStudioDeviceRow,
  type RackStudioPlacementState,
} from "./rack-studio-placement-core.js";
export * from "./rack-studio-placement-core.js";

const resolvePlacement = createRackStudioPlacementResolver(db, deviceTypeBase);
export function resolveRackStudioPlacement(
  device: RackStudioDeviceRow,
  requested: RackStudioPlacementState,
) {
  if (isStackType(device.deviceType)) {
    assertStackDeviceEdit(
      device.id,
      device.deviceType,
      requested.heightU ?? undefined,
    );
    return {
      ...resolvePlacement(device, requested),
      heightU: device.heightU ?? 1,
    };
  }
  if (requested.heightU !== null && requested.heightU > 20)
    throw new ValidationError("Height U must be at most 20.");
  return resolvePlacement(device, requested);
}
