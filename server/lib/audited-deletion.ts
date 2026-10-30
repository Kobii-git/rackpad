import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { resolveAuditLabIds } from "./audit-scope.js";
import { writeAuditLogEntry } from "./audit-log.js";

/** Synchronous by design: no transaction is held across an await or response. */
export function withAuditedDeletion(
  req: FastifyRequest,
  reply: FastifyReply,
  subject: {
    entityType: string;
    entityId: string;
    action: string;
    summary?: string;
  },
  remove: () => boolean | FastifyReply | void,
) {
  const result = db.transaction(() => {
    const labIds = resolveAuditLabIds(db, subject.entityType, subject.entityId);
    const previousIds = new Set(
      (
        db
          .prepare(
            "SELECT id FROM auditLog WHERE entityType = ? AND entityId = ?",
          )
          .all(subject.entityType, subject.entityId) as Array<{ id: string }>
      ).map((row) => row.id),
    );
    const outcome = remove();
    if (outcome !== true) return { value: outcome };
    if (!req.authUser) throw new Error("Authenticated deletion required.");
    const written = (
      db
        .prepare(
          "SELECT id FROM auditLog WHERE entityType = ? AND entityId = ?",
        )
        .all(subject.entityType, subject.entityId) as Array<{ id: string }>
    ).filter((row) => !previousIds.has(row.id));
    if (written.length) {
      for (const row of written)
        db.prepare("UPDATE auditLog SET labIds = ? WHERE id = ?").run(
          labIds === null ? null : JSON.stringify(labIds),
          row.id,
        );
    } else if (labIds !== null) {
      writeAuditLogEntry({
        user: req.authUser.username,
        ...subject,
        summary:
          subject.summary ??
          `Deleted ${subject.entityType} ${subject.entityId}`,
        labIds,
      });
    }
    return { value: true as const };
  })();
  return typeof result.value === "boolean"
    ? reply.status(204).send()
    : result.value;
}
