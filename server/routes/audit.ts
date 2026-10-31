import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { canReadLab, canWriteLab } from "../lib/lab-access.js";
import { asObject, parseLimit, requiredString } from "../lib/validation.js";
import { parseAuditLabIds, resolveAuditLabIds } from "../lib/audit-scope.js";
import { writeAuditLogEntry } from "../lib/audit-log.js";

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { entityId?: string; entityType?: string; limit?: string };
  }>("/", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const admin = req.authUser.role === "admin";
    // Preserve the existing admin-only global-list boundary.
    if (!admin && (!req.query.entityId || !req.query.entityType)) return [];
    let sql = "SELECT * FROM auditLog WHERE 1=1";
    const params: unknown[] = [];
    if (req.query.entityId) {
      sql += " AND entityId = ?";
      params.push(req.query.entityId);
    }
    if (req.query.entityType) {
      sql += " AND entityType = ?";
      params.push(req.query.entityType);
    }
    sql += ` ORDER BY ts DESC LIMIT ${parseLimit(req.query.limit, 100, 500)}`;
    const rows = (
      db.prepare(sql).all(...params) as Array<Record<string, unknown>>
    ).map((row) => ({ ...row, labIds: parseAuditLabIds(row.labIds) }));
    if (admin) return rows;
    const allowed = (ids: string[] | null) =>
      Boolean(
        ids?.length &&
        ids.every((labId) =>
          canReadLab(req.authUser!, labId, req.labAccess ?? []),
        ),
      );
    const readable = rows.filter((row) => allowed(row.labIds));
    if (readable.length) return readable;
    const current = resolveAuditLabIds(
      db,
      req.query.entityType!,
      req.query.entityId!,
    );
    if (allowed(current)) return [];
    return reply
      .status(403)
      .send({ error: "You do not have access to this audit entry." });
  });

  app.post("/", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = asObject(req.body);
    const action = requiredString(body, "action", { maxLength: 120 });
    const entityType = requiredString(body, "entityType", { maxLength: 120 });
    const entityId = requiredString(body, "entityId", { maxLength: 120 });
    const summary = requiredString(body, "summary", { maxLength: 500 });
    // Scope supplied by a client is never used, even for administrator requests.
    const labIds = resolveAuditLabIds(db, entityType, entityId);
    if (
      req.authUser.role !== "admin" &&
      (!labIds?.length ||
        !labIds.every((labId) =>
          canWriteLab(req.authUser!, labId, req.labAccess ?? []),
        ))
    )
      return reply
        .status(403)
        .send({ error: "You do not have write access to this audit entity." });
    return reply
      .status(201)
      .send(
        writeAuditLogEntry({
          user: req.authUser.username,
          action,
          entityType,
          entityId,
          summary,
          labIds,
        }),
      );
  });
};
