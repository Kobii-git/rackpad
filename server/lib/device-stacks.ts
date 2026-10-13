import { legacyShelfGeometry } from "./legacy-shelf-geometry.js";
import { validateStackGeometry } from "./stack-integrity.js";
import { db } from "../db.js";
import { deviceTypeLineage, deviceTypeBase } from "./device-types.js";
import { createId } from "./ids.js";
import { type RackStudioDeviceRow } from "./rack-studio-placement.js";
import { ValidationError } from "./validation.js";
import {
  parseStackMember,
  type StackMember,
  type StackMemberMac,
} from "./stack-data.js";
export { parseStackMember } from "./stack-data.js";

export function isStackType(deviceType: string) {
  return deviceTypeLineage(deviceType).includes("switch_stack");
}
export function listStackMembers(deviceId: string): StackMember[] {
  const rows = db
    .prepare(
      "SELECT * FROM deviceStackMembers WHERE deviceId = ? ORDER BY position, id",
    )
    .all(deviceId) as Omit<StackMember, "macs">[];
  return rows.map((row) => ({
    ...row,
    macs: db
      .prepare(
        "SELECT label, macAddress FROM deviceStackMemberMacs WHERE memberId = ? ORDER BY label, macAddress",
      )
      .all(row.id) as StackMemberMac[],
  }));
}
export function stackHeight(deviceId: string) {
  return (
    db
      .prepare(
        "SELECT COALESCE(SUM(heightU), 1) AS height FROM deviceStackMembers WHERE deviceId = ?",
      )
      .get(deviceId) as { height: number }
  ).height;
}
export function assertStackDeviceEdit(
  deviceId: string,
  nextType: string,
  requestedHeight?: number | null,
) {
  const current = db
    .prepare("SELECT deviceType FROM devices WHERE id = ?")
    .get(deviceId) as { deviceType: string } | undefined;
  if (
    current &&
    current.deviceType !== nextType &&
    listStackMembers(deviceId).length
  )
    throw new ValidationError(
      "Remove stack members before changing the device type.",
      409,
    );
  if (
    isStackType(nextType) &&
    requestedHeight !== undefined &&
    requestedHeight !== stackHeight(deviceId)
  )
    throw new ValidationError("Stack height is derived from its members.", 409);
}
export function assertPortStackMember(
  deviceId: string,
  memberId: string | null | undefined,
) {
  if (
    memberId &&
    !db
      .prepare(
        "SELECT id FROM deviceStackMembers WHERE id = ? AND deviceId = ?",
      )
      .get(memberId, deviceId)
  )
    throw new ValidationError("Stack member must belong to the port device.");
}
export function validateStackPlacement(deviceId: string) {
  const device = db
    .prepare("SELECT * FROM devices WHERE id = ?")
    .get(deviceId) as RackStudioDeviceRow;
  if (!isStackType(device.deviceType)) return;
  if (device.heightU !== stackHeight(deviceId))
    throw new ValidationError("Stack height is derived from its members.", 409);
  validateStackGeometry(db, device, deviceTypeBase);
}
export function syncStackHeight(deviceId: string) {
  db.prepare("UPDATE devices SET heightU = ? WHERE id = ?").run(
    stackHeight(deviceId),
    deviceId,
  );
  const device = db
    .prepare("SELECT * FROM devices WHERE id = ?")
    .get(deviceId) as RackStudioDeviceRow;
  if (
    device.placement === "shelf" &&
    [device.shelfX, device.shelfY, device.shelfWidth, device.shelfHeight].every(
      (value) => value == null,
    )
  ) {
    for (let index = 0; index < 25; index++) {
      const geometry = legacyShelfGeometry(index, 25);
      db.prepare(
        "UPDATE devices SET shelfX=?, shelfY=?, shelfWidth=?, shelfHeight=?, shelfOrientation=0 WHERE id=?",
      ).run(geometry.x, geometry.y, geometry.width, geometry.height, deviceId);
      try {
        validateStackPlacement(deviceId);
        return;
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error;
      }
    }
    throw new ValidationError(
      "No free default shelf footprint. Place the stack using Rack Studio.",
    );
  }
  validateStackPlacement(deviceId);
}
export function saveStackMember(
  deviceId: string,
  body: Record<string, unknown>,
  existing?: StackMember,
) {
  const member = parseStackMember(body, existing);
  const id = existing?.id ?? createId("sm");
  const position = existing?.position ?? listStackMembers(deviceId).length;
  db.prepare(
    `INSERT INTO deviceStackMembers (id, deviceId, position, name, manufacturer, model, serial, heightU, status, notes)
    VALUES (@id, @deviceId, @position, @name, @manufacturer, @model, @serial, @heightU, @status, @notes)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, manufacturer=excluded.manufacturer, model=excluded.model, serial=excluded.serial, heightU=excluded.heightU, status=excluded.status, notes=excluded.notes`,
  ).run({ id, deviceId, position, ...member });
  db.prepare("DELETE FROM deviceStackMemberMacs WHERE memberId = ?").run(id);
  for (const mac of member.macs)
    db.prepare(
      "INSERT INTO deviceStackMemberMacs (memberId, label, macAddress) VALUES (?, ?, ?)",
    ).run(id, mac.label, mac.macAddress);
  syncStackHeight(deviceId);
  return listStackMembers(deviceId).find((row) => row.id === id)!;
}
export function reorderStackMembers(deviceId: string, ids: unknown) {
  const current = listStackMembers(deviceId);
  if (
    !Array.isArray(ids) ||
    ids.length !== current.length ||
    new Set(ids).size !== ids.length ||
    ids.some(
      (id) => typeof id !== "string" || !current.some((row) => row.id === id),
    )
  )
    throw new ValidationError(
      "memberIds must contain every member exactly once.",
    );
  // Move outside the live range first to keep the unique index valid throughout.
  db.prepare(
    "UPDATE deviceStackMembers SET position = position + ? WHERE deviceId = ?",
  ).run(current.length, deviceId);
  ids.forEach((id, position) =>
    db
      .prepare(
        "UPDATE deviceStackMembers SET position = ? WHERE id = ? AND deviceId = ?",
      )
      .run(position, id, deviceId),
  );
}

export function unmountStack(deviceId: string) {
  db.prepare(
    `UPDATE devices SET placement='room', rackMountKind='loose', rackId=NULL, parentDeviceId=NULL, startU=NULL, face=NULL, rackSlot='full', rackColumn=NULL, rackColumnSpan=NULL, shelfX=NULL, shelfY=NULL, shelfWidth=NULL, shelfHeight=NULL, shelfOrientation=0, rackSide=NULL WHERE id=?`,
  ).run(deviceId);
  validateStackPlacement(deviceId);
}
export function stackChildren(deviceId: string) {
  return (
    db
      .prepare("SELECT id, deviceType FROM devices WHERE parentDeviceId = ?")
      .all(deviceId) as Array<{ id: string; deviceType: string }>
  ).filter((row) => isStackType(row.deviceType));
}
export function validateStackChildren(deviceId: string) {
  for (const child of stackChildren(deviceId)) validateStackPlacement(child.id);
}
