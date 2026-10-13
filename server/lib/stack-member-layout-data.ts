import type Database from "better-sqlite3";
import {
  PHYSICAL_LAYOUT_STATUSES,
  isPhysicalLayoutPort,
  validateResolvedPhysicalLayoutV1,
  validatePortBindingsV1,
  type PhysicalLayoutPort,
  type PhysicalLayoutStatus,
  type PortBindingV1,
  type ResolvedPhysicalLayoutV1,
} from "./physical-layout.js";
import { requiredString, ValidationError } from "./validation.js";

export interface StackMemberLayout {
  memberId: string;
  sourceTemplateId: string;
  status: PhysicalLayoutStatus;
  snapshot: ResolvedPhysicalLayoutV1;
  bindings: PortBindingV1[];
  portFingerprint: string;
  createdAt: string;
  updatedAt: string;
}
export function parseStackMemberLayout(
  row: Record<string, unknown>,
  ports?: PhysicalLayoutPort[],
): StackMemberLayout {
  ports = ports?.filter(isPhysicalLayoutPort);
  const json = (value: unknown) =>
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  const snapshot = validateResolvedPhysicalLayoutV1(json(row.snapshot));
  const sourceTemplateId = requiredString(row, "sourceTemplateId", {
    maxLength: 120,
  });
  if (
    sourceTemplateId !== snapshot.sourceTemplateId ||
    !(PHYSICAL_LAYOUT_STATUSES as readonly unknown[]).includes(row.status)
  )
    throw new ValidationError("Invalid stack member layout source or status.");
  const bindings = validatePortBindingsV1(json(row.bindings), {
    ...(ports ? { portIds: new Set(ports.map((port) => port.id)) } : {}),
    slotIds: new Set(snapshot.portSlots.map((slot) => slot.id)),
  });
  if (ports)
    for (const binding of bindings) {
      const port = ports.find((port) => port.id === binding.portId)!;
      const slot = snapshot.portSlots.find(
        (slot) => slot.id === binding.slotId,
      )!;
      if (
        slot.face !== (port.face === "rear" ? "rear" : "front") ||
        !slot.acceptedPortKinds.includes(port.kind)
      )
        throw new ValidationError(
          "Stack member binding has an incompatible port.",
        );
    }
  return {
    memberId: requiredString(row, "memberId", { maxLength: 80 }),
    sourceTemplateId,
    status: row.status as PhysicalLayoutStatus,
    snapshot,
    bindings,
    portFingerprint: requiredString(row, "portFingerprint", { maxLength: 256 }),
    createdAt: requiredString(row, "createdAt", { maxLength: 80 }),
    updatedAt: requiredString(row, "updatedAt", { maxLength: 80 }),
  };
}
export function readStackMemberLayouts(
  database: Database.Database,
  deviceId: string,
): Map<string, StackMemberLayout> {
  const rows = database
    .prepare(
      "SELECT layouts.* FROM deviceStackMemberLayouts layouts JOIN deviceStackMembers members ON members.id=layouts.memberId WHERE members.deviceId=?",
    )
    .all(deviceId) as Record<string, unknown>[];
  return new Map(
    rows.map((row) => {
      const layout = parseStackMemberLayout(row);
      return [layout.memberId, layout];
    }),
  );
}
export function validateStackMemberLayouts(database: Database.Database) {
  if (
    !database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='deviceStackMemberLayouts'",
      )
      .get()
  )
    return;
  const rows = database
    .prepare("SELECT * FROM deviceStackMemberLayouts")
    .all() as Record<string, unknown>[];
  for (const row of rows) {
    const member = database
      .prepare("SELECT deviceId FROM deviceStackMembers WHERE id=?")
      .get(row.memberId) as { deviceId: string } | undefined;
    if (!member)
      throw new ValidationError("Stack layout references a missing member.");
    const ports = database
      .prepare("SELECT * FROM ports WHERE deviceId=? AND stackMemberId=?")
      .all(member.deviceId, row.memberId) as PhysicalLayoutPort[];
    parseStackMemberLayout(row, ports);
  }
}
