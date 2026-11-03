import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { canReadLab, canWriteLab } from "../lib/lab-access.js";
import {
  asObject,
  parseLimit,
  requiredString,
  ValidationError,
} from "../lib/validation.js";
import { parseAuditLabIds, resolveAuditLabIds } from "../lib/audit-scope.js";
import { writeAuditLogEntry } from "../lib/audit-log.js";

// SQLite's built-in lower() folds ASCII only. Match the existing browser search
// for translated summaries and actor names as well as English action names.
db.function("audit_lower", { deterministic: true }, (value: unknown) =>
  typeof value === "string" ? value.toLowerCase() : null,
);

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      entityId?: string;
      entityType?: string;
      limit?: string;
      labId?: string;
      action?: string;
      search?: string;
      beforeTs?: string;
      beforeId?: string;
    };
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
    if (req.query.labId !== undefined) {
      const labId = requiredString(req.query, "labId", { maxLength: 120 });
      sql +=
        " AND EXISTS (SELECT 1 FROM json_each(auditLog.labIds) WHERE value = ?)";
      params.push(labId);
    }
    if (req.query.action !== undefined) {
      sql += " AND action = ?";
      params.push(requiredString(req.query, "action", { maxLength: 120 }));
    }
    if (req.query.search !== undefined) {
      sql +=
        " AND instr(audit_lower(summary || ' ' || action || ' ' || user || ' ' || entityType || ' ' || entityId || ' ' || ts), ?) > 0";
      params.push(
        requiredString(req.query, "search", { maxLength: 500 }).toLowerCase(),
      );
    }
    if (
      (req.query.beforeTs !== undefined) !==
      (req.query.beforeId !== undefined)
    ) {
      throw new ValidationError(
        "beforeTs and beforeId must be supplied together.",
      );
    }
    if (req.query.beforeTs !== undefined) {
      const ts = requiredString(req.query, "beforeTs", { maxLength: 80 });
      const id = requiredString(req.query, "beforeId", { maxLength: 120 });
      sql += " AND (ts < ? OR (ts = ? AND id < ?))";
      params.push(ts, ts, id);
    }
    sql += ` ORDER BY ts DESC, id DESC LIMIT ${parseLimit(req.query.limit, 100, 500)}`;
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
