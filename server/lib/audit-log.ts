import { db } from "../db.js";
import { createId } from "./ids.js";

export interface AuditLogInput {
  user: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
}

export function writeAuditLogEntry(input: AuditLogInput) {
  const id = createId("a");
  const ts = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    ts,
    input.user,
    input.action,
    input.entityType,
    input.entityId,
    input.summary,
  );
  return { id, ts, ...input };
}
