import {
  createRackStudioPlacementResolver,
  currentRackStudioPlacement,
  parseRackStudioPlacementState,
  type RackStudioDeviceRow,
} from "./rack-studio-placement-core.js";
import type Database from "better-sqlite3";
import { parseStackMember } from "./stack-data.js";
import { requiredString, ValidationError } from "./validation.js";

/** Uses the supplied snapshot connection; never the running application's database. */
export function validateStackIntegrity(database: Database.Database) {
  const settings = database
    .prepare("SELECT value FROM appSettings WHERE key = 'deviceTypes'")
    .get() as { value: string } | undefined;
  const parsed = settings
    ? (JSON.parse(settings.value) as {
        custom?: Array<{ id: string; parentType?: string }>;
      })
    : {};
  const parents = new Map(
    (parsed.custom ?? []).map((row) => [row.id, row.parentType]),
  );
  parents.set("switch_stack", "switch");
  function isStack(id: string) {
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      if (id === "switch_stack") return true;
      seen.add(id);
      id = parents.get(id) ?? "";
    }
    return false;
  }
  const devices = database.prepare("SELECT * FROM devices").all() as Array<
    Record<string, unknown>
  >;
  const members = database
    .prepare("SELECT * FROM deviceStackMembers ORDER BY deviceId, position")
    .all() as Array<Record<string, unknown>>;
  const macs = database
    .prepare("SELECT * FROM deviceStackMemberMacs")
    .all() as Array<Record<string, unknown>>;
  const fail = (message: string): never => {
    throw new ValidationError(message, 422, "BACKUP_INTEGRITY_INVALID");
  };
  for (const row of members) {
    requiredString(row, "id", { maxLength: 80 });
    requiredString(row, "deviceId", { maxLength: 80 });
    const owner = devices.find((device) => device.id === row.deviceId);
    if (!owner || !isStack(String(owner.deviceType)))
      fail("Stack member has an invalid logical device.");
    const addresses = macs.filter((mac) => mac.memberId === row.id);
    const normalized = parseStackMember({ ...row, macs: addresses });
    if (
      normalized.heightU !== row.heightU ||
      addresses.some(
        (mac, index) => normalized.macs[index].macAddress !== mac.macAddress,
      )
    )
      fail("Stack member data is not normalized.");
  }
  if (macs.some((mac) => !members.some((member) => member.id === mac.memberId)))
    fail("Stack MAC references a missing member.");
  const ports = database
    .prepare(
      "SELECT deviceId, stackMemberId FROM ports WHERE stackMemberId IS NOT NULL",
    )
    .all() as Array<{ deviceId: string; stackMemberId: string }>;
  for (const port of ports)
    if (
      !members.some(
        (member) =>
          member.id === port.stackMemberId && member.deviceId === port.deviceId,
      )
    )
      fail("Port stack member belongs to another device.");
  for (const device of devices.filter((device) =>
    isStack(String(device.deviceType)),
  )) {
    const rows = members.filter((row) => row.deviceId === device.id);
    if (rows.some((row, index) => row.position !== index))
      fail("Stack member ordering must be contiguous.");
    const height = rows.reduce((sum, row) => sum + Number(row.heightU), 0) || 1;
    if (device.heightU !== height)
      fail("Stack height does not match its members.");
    const resolveType = (id: string) => {
      const seen = new Set<string>();
      while (parents.get(id) && !seen.has(id)) {
        seen.add(id);
        id = parents.get(id)!;
      }
      return id;
    };
    validateStackGeometry(database, device as RackStudioDeviceRow, resolveType);
  }
}

export function validateStackGeometry(
  database: Database.Database,
  device: RackStudioDeviceRow,
  resolveType: (id: string) => string,
) {
  const fail = (message: string): never => {
    throw new ValidationError(message, 422, "STACK_PLACEMENT_INVALID");
  };
  if (
    device.rackMountKind != null &&
    !["direct", "rack-top", "shelf", "side", "loose"].includes(
      String(device.rackMountKind),
    )
  )
    fail("Invalid stack mount kind.");
  if (device.face != null && device.face !== "front" && device.face !== "rear")
    fail("Invalid stack rack face.");
  if (
    device.rackSide != null &&
    device.rackSide !== "left" &&
    device.rackSide !== "right"
  )
    fail("Invalid stack rack side.");
  if (
    device.shelfOrientation != null &&
    device.shelfOrientation !== 0 &&
    device.shelfOrientation !== 90
  )
    fail("Invalid stack shelf orientation.");
  if (
    ["rack-top", "side", "shelf"].includes(String(device.rackMountKind)) &&
    !device.rackId
  )
    fail("Stack mount requires a rack.");
  if (device.rackMountKind === "shelf" && device.placement !== "shelf")
    fail("Stack shelf placement is inconsistent.");
  if (device.rackMountKind === "side" && !device.rackSide)
    fail("Stack side placement requires a side.");
  if (device.rackMountKind === "rack-top" && device.startU != null)
    fail("Rack-top stack cannot occupy rack U positions.");
  const row = device as RackStudioDeviceRow;
  const current = parseRackStudioPlacementState(
    currentRackStudioPlacement(row),
  );
  const resolved = createRackStudioPlacementResolver(database, resolveType)(
    row,
    current,
  );
  if (current.roomId !== null && current.roomId !== resolved.roomId)
    fail("Stack room does not match physical placement.");

  if (
    device.rackId !== resolved.rackId ||
    (device.parentDeviceId ?? null) !== resolved.parentDeviceId
  )
    fail("Stack placement references do not match its parent.");
  if (device.face != null && device.face !== resolved.face)
    fail("Stack face does not match its placement.");
  if (device.rackMountKind === "loose" && device.rackId != null)
    fail("Loose stack cannot occupy a rack.");
}
