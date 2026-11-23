import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { requireAdmin, requireAuth } from "../lib/auth.js";
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

type AuditFilters = { labId?: string; action?: string; search?: string };

function auditFilter(query: AuditFilters) {
  let sql = "1=1";
  const params: unknown[] = [];
  if (query.labId !== undefined) {
    sql +=
      " AND EXISTS (SELECT 1 FROM json_each(auditLog.labIds) WHERE value = ?)";
    params.push(requiredString(query, "labId", { maxLength: 120 }));
  }
  if (query.action !== undefined) {
    sql += " AND action = ?";
    params.push(requiredString(query, "action", { maxLength: 120 }));
  }
  if (query.search !== undefined) {
    sql +=
      " AND instr(audit_lower(summary || ' ' || action || ' ' || user || ' ' || entityType || ' ' || entityId || ' ' || ts), ?) > 0";
    params.push(
      requiredString(query, "search", { maxLength: 500 }).toLowerCase(),
    );
  }
  return { sql, params };
}

export const auditRoutes: FastifyPluginAsync = async (app) => {
  // Match the existing administrator-only history listing. Never expose actor
  // counts or action names through the entity-scoped non-admin read boundary.
  app.get<{ Querystring: AuditFilters }>("/summary", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const labId = requiredString(req.query, "labId", { maxLength: 120 });
    const matching = auditFilter({ ...req.query, labId });
    const scope = auditFilter({ labId });
    return db.transaction(() => {
      const counts = db
        .prepare(
          `SELECT
        COUNT(*) AS entries,
        COUNT(DISTINCT user) AS users,
        COALESCE(SUM(CASE WHEN action = 'device' OR substr(action, 1, 7) = 'device.' THEN 1 ELSE 0 END), 0) AS devices,
        COALESCE(SUM(CASE WHEN action = 'port' OR substr(action, 1, 5) = 'port.' THEN 1 ELSE 0 END), 0) AS ports
        FROM auditLog WHERE ${matching.sql}`,
        )
        .get(...matching.params) as {
        entries: number;
        users: number;
        devices: number;
        ports: number;
      };
      // Keep every lab action selectable even when the current search/action
      // has no matches. Other labs and unscoped legacy events stay excluded.
      const actions = db
        .prepare(
          `SELECT DISTINCT action FROM auditLog WHERE ${scope.sql} ORDER BY action`,
        )
        .all(...scope.params) as Array<{ action: string }>;
      return { ...counts, actions: actions.map((row) => row.action) };
    })();
  });

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
    const filter = auditFilter(req.query);
    let sql = `SELECT * FROM auditLog WHERE ${filter.sql}`;
    const params = filter.params;
    if (req.query.entityId) {
      sql += " AND entityId = ?";
      params.push(req.query.entityId);
    }
    if (req.query.entityType) {
      sql += " AND entityType = ?";
      params.push(req.query.entityType);
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
