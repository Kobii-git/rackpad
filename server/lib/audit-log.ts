import { db } from "../db.js";
import { createId } from "./ids.js";
import { parseAuditLabIds, resolveAuditLabIds } from "./audit-scope.js";

export interface AuditLogInput {
  user: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  labIds?: string[] | null;
}

export function writeAuditLogEntry(input: AuditLogInput) {
  const id = createId("a");
  const ts = new Date().toISOString();
  const labIds = input.labIds === undefined ? resolveAuditLabIds(db, input.entityType, input.entityId) : parseAuditLabIds(input.labIds);
  db.prepare(
    `
      INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary, labIds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    ts,
    input.user,
    input.action,
    input.entityType,
    input.entityId,
    input.summary,
    labIds === null ? null : JSON.stringify(labIds),
  );
  return { id, ts, ...input, labIds };
}
