import { getPublicUserById } from "../lib/auth.js";
import { fetchUserLabAccess } from "../lib/lab-access.js";
import { probeObservations } from "../lib/monitor-observations.js";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import {
  assertLabReadFromRow,
  assertLabWriteFromRow,
} from "../lib/lab-access.js";
import { createId } from "../lib/ids.js";
import { writeAuditLogEntry } from "../lib/audit-log.js";
import {
  asObject,
  optionalBoolean,
  optionalString,
  requiredInteger,
  requiredString,
  ValidationError,
} from "../lib/validation.js";
import {
  INTEGRATION_PROVIDER_INFO,
  type IntegrationProvider,
} from "../lib/integrations/types.js";
import {
  externalSourceIdentity,
  resetExternalMonitorResults,
  listExternalReadings,
} from "../lib/integrations/external-health.js";
import { invalidateExternalHealthWork } from "../lib/integrations/external-health-epoch.js";
import { refreshExternalHealth } from "../lib/integrations/external-health-polling.js";
import {
  parseMonitor,
  reconcileDeviceMonitorRollup,
} from "../lib/monitoring.js";

function connection(
  req: FastifyRequest,
  reply: FastifyReply,
  id: string,
  write = false,
) {
  const row = db
    .prepare("SELECT * FROM integrationConnections WHERE id=?")
    .get(id) as Record<string, unknown> | undefined;
  if (!(write ? assertLabWriteFromRow : assertLabReadFromRow)(req, reply, row))
    return;
  if (
    !INTEGRATION_PROVIDER_INFO[row!.provider as IntegrationProvider]
      ?.capabilities.health
  )
    throw new ValidationError(
      "This provider does not support external health.",
    );
  return row!;
}
function view(row: Record<string, unknown>) {
  let warnings: string[] = [];
  try { const summary = JSON.parse(String(row.lastSummary ?? "{}")) as {externalWarnings?:unknown}; if(Array.isArray(summary.externalWarnings)) warnings=summary.externalWarnings.filter(value=>typeof value === "string").slice(0,100); } catch { /* Legacy summary is optional. */ }
  return {
    warnings,
    sourceIdentity: externalSourceIdentity(row),
    pollingEnabled: Boolean(row.healthPollingEnabled),
    intervalSeconds: Number(row.healthIntervalSeconds),
    lastCheckedAt: row.healthLastCheckedAt,
    error: row.healthLastError,
    readings: listExternalReadings(String(row.id)),
    bindings: db
      .prepare(
        "SELECT * FROM integrationRecordBindings WHERE connectionId=? ORDER BY providerRecordId",
      )
      .all(row.id),
    monitors: db
      .prepare(
        `SELECT m.*,e.bindingId,e.readingKey,e.alertOnDegraded FROM externalMonitorMappings e JOIN deviceMonitors m ON m.id=e.monitorId JOIN integrationRecordBindings b ON b.id=e.bindingId WHERE b.connectionId=? ORDER BY m.id`,
      )
      .all(row.id).map((value) => { const monitor = value as Record<string, unknown>; return { ...parseMonitor(monitor), bindingId: monitor.bindingId, readingKey: monitor.readingKey, alertOnDegraded: Boolean(monitor.alertOnDegraded) }; }),
  };
}
function audit(
  req: FastifyRequest,
  row: Record<string, unknown>,
  action: string,
  summary: string,
) {
  writeAuditLogEntry({
    user: req.authUser!.username,
    action,
    entityType: "IntegrationConnection",
    entityId: String(row.id),
    summary,
    labIds: [String(row.labId)],
  });
}
export const externalHealthRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>("/:id/readings", async (req, reply) => {
    const row = connection(req, reply, req.params.id);
    if (row) return view(row);
  });
  app.post<{ Params: { id: string } }>("/:id/refresh", async (req, reply) => {
    const row = connection(req, reply, req.params.id, true);
    if (!row) return;
    await refreshExternalHealth(req.params.id);
    // Request metadata is a snapshot; reload actor and grants after the await.
    const actor = getPublicUserById(req.authUser!.id);
    if (!actor || actor.disabled) return reply.status(403).send({error:"Access changed."});
    req.authUser = actor;
    req.labAccess = fetchUserLabAccess(actor.id);
    const current = connection(req, reply, req.params.id, true);
    if (current) return view(current);
  });
  app.put<{ Params: { id: string } }>(
    "/:id/health-polling",
    async (req, reply) => {
      const row = connection(req, reply, req.params.id, true);
      if (!row) return;
      const body = asObject(req.body);
      const enabled = optionalBoolean(body, "enabled");
      if (enabled === undefined)
        throw new ValidationError("Enabled is required.");
      const interval = requiredInteger(body, "intervalSeconds", {
        min: 60,
        max: 3600,
      });
      db.transaction(() => {
        invalidateExternalHealthWork(req.params.id);
        db.prepare(
          "UPDATE integrationConnections SET healthPollingEnabled=?,healthIntervalSeconds=?,updatedAt=? WHERE id=?",
        ).run(
          enabled ? 1 : 0,
          interval,
          new Date().toISOString(),
          req.params.id,
        );
        audit(
          req,
          row,
          "integration.health-polling",
          "Updated external health polling settings",
        );
      })();
      return view(
        db
          .prepare("SELECT * FROM integrationConnections WHERE id=?")
          .get(req.params.id) as Record<string, unknown>,
      );
    },
  );
  app.post<{ Params: { id: string } }>("/:id/bindings", async (req, reply) => {
    const row = connection(req, reply, req.params.id, true);
    if (!row) return;
    const body = asObject(req.body),
      providerRecordId = requiredString(body, "providerRecordId", {
        maxLength: 200,
      }),
      deviceId = requiredString(body, "deviceId", { maxLength: 80 });
    const sourceIdentity = requiredString(body, "sourceIdentity", {
      maxLength: 64,
    });
    if (sourceIdentity !== externalSourceIdentity(row))
      throw new ValidationError(
        "Connection changed. Refresh before binding.",
        409,
      );
    const device = db
      .prepare("SELECT id,labId FROM devices WHERE id=?")
      .get(deviceId) as Record<string, unknown> | undefined;
    if (!assertLabWriteFromRow(req, reply, device)) return;
    if (device!.labId !== row.labId)
      throw new ValidationError(
        "Binding device must belong to the connection lab.",
        422,
      );
    if (
      !db
        .prepare(
          "SELECT 1 FROM integrationLatestReadings WHERE connectionId=? AND providerRecordId=?",
        )
        .get(req.params.id, providerRecordId)
    )
      throw new ValidationError(
        "Refresh and select a provider record before binding.",
        422,
      );
    return db.transaction(() => {
      const existing = db
        .prepare(
          "SELECT * FROM integrationRecordBindings WHERE connectionId=? AND providerRecordId=?",
        )
        .get(req.params.id, providerRecordId) as
        Record<string, unknown> | undefined;
      if (
        existing?.deviceId === deviceId &&
        existing.sourceIdentity === sourceIdentity
      )
        return view(row);
      if (existing && body.expectedDeviceId !== existing.deviceId)
        throw new ValidationError(
          "Binding changed. Refresh before rebinding.",
          409,
        );
      invalidateExternalHealthWork(req.params.id);
      if (existing)
        db.prepare(
          "UPDATE integrationRecordBindings SET deviceId=?,sourceIdentity=?,updatedAt=? WHERE id=?",
        ).run(deviceId, sourceIdentity, new Date().toISOString(), existing.id);
      else
        db.prepare(
          "INSERT INTO integrationRecordBindings(id,connectionId,providerRecordId,deviceId,sourceIdentity,updatedAt) VALUES(?,?,?,?,?,?)",
        ).run(
          createId("irb"),
          req.params.id,
          providerRecordId,
          deviceId,
          sourceIdentity,
          new Date().toISOString(),
        );
      audit(
        req,
        row,
        "integration.bind",
        "Explicitly bound provider record to local inventory",
      );
      return view(row);
    })();
  });
  app.delete<{ Params: { id: string; bindingId: string } }>(
    "/:id/bindings/:bindingId",
    async (req, reply) => {
      const row = connection(req, reply, req.params.id, true);
      if (!row) return;
      const body = asObject(req.body);
      const existing = db
        .prepare(
          "SELECT * FROM integrationRecordBindings WHERE id=? AND connectionId=?",
        )
        .get(req.params.bindingId, req.params.id) as
        Record<string, unknown> | undefined;
      if (!existing) throw new ValidationError("Not found.", 404);
      if (body.expectedDeviceId !== existing.deviceId)
        throw new ValidationError(
          "Binding changed. Refresh before unbinding.",
          409,
        );
      return db.transaction(() => {
        invalidateExternalHealthWork(req.params.id);
        db.prepare("DELETE FROM integrationRecordBindings WHERE id=?").run(
          req.params.bindingId,
        );
        audit(
          req,
          row,
          "integration.unbind",
          "Removed provider record binding; local inventory retained",
        );
        return view(row);
      })();
    },
  );
  app.post<{ Params: { id: string } }>(
    "/:id/external-monitors",
    async (req, reply) => {
      const row = connection(req, reply, req.params.id, true);
      if (!row) return;
      const body = asObject(req.body),
        bindingId = requiredString(body, "bindingId", { maxLength: 80 }),
        readingKey = requiredString(body, "readingKey", { maxLength: 160 });
      const binding = db
        .prepare(
          "SELECT * FROM integrationRecordBindings WHERE id=? AND connectionId=?",
        )
        .get(bindingId, req.params.id) as Record<string, unknown> | undefined;
      if (
        !binding ||
        binding.sourceIdentity !== externalSourceIdentity(row) ||
        !row.enabled
      )
        throw new ValidationError(
          "Bind this provider record before creating a monitor.",
          409,
        );
      const device = db
        .prepare("SELECT id,labId FROM devices WHERE id=?")
        .get(binding.deviceId) as Record<string, unknown> | undefined;
      if (!assertLabWriteFromRow(req, reply, device)) return;
      if (
        !db
          .prepare(
            "SELECT 1 FROM integrationLatestReadings WHERE connectionId=? AND providerRecordId=? AND readingKey=?",
          )
          .get(req.params.id, binding.providerRecordId, readingKey)
      )
        throw new ValidationError(
          "Reading not found. Refresh the provider.",
          422,
        );
      const enabled = optionalBoolean(body, "enabled") ?? false,
        alertOnDegraded = optionalBoolean(body, "alertOnDegraded") ?? false,
        name =
          optionalString(body, "name", { maxLength: 80 }) || "External health";
      return db.transaction(() => {
        if (
          db
            .prepare(
              "SELECT 1 FROM externalMonitorMappings WHERE bindingId=? AND readingKey=?",
            )
            .get(bindingId, readingKey)
        )
          throw new ValidationError(
            "This reading already has a mapped monitor.",
            409,
          );
        const id = createId("mon");
        const order = (
          db
            .prepare(
              "SELECT COALESCE(MAX(sortOrder),-1)+1 AS n FROM deviceMonitors WHERE deviceId=?",
            )
            .get(binding.deviceId) as { n: number }
        ).n;
        db.prepare(
          "INSERT INTO deviceMonitors(id,deviceId,name,type,enabled,intervalMs,sortOrder) VALUES(?,?,?,'external',?,?,?)",
        ).run(id, binding.deviceId, name, enabled ? 1 : 0, 60000, order);
        db.prepare(
          "INSERT INTO externalMonitorMappings(monitorId,bindingId,readingKey,alertOnDegraded) VALUES(?,?,?,?)",
        ).run(id, bindingId, readingKey, alertOnDegraded ? 1 : 0);
        audit(
          req,
          row,
          "monitor.external.create",
          "Created an explicitly mapped external monitor",
        );
        return view(row);
      })();
    },
  );
  app.patch<{ Params: { id: string; monitorId: string } }>(
    "/:id/external-monitors/:monitorId",
    async (req, reply) => {
      const row = connection(req, reply, req.params.id, true);
      if (!row) return;
      const mapping = db
        .prepare(
          `SELECT m.*,e.bindingId,e.alertOnDegraded,b.sourceIdentity FROM deviceMonitors m JOIN externalMonitorMappings e ON e.monitorId=m.id JOIN integrationRecordBindings b ON b.id=e.bindingId WHERE m.id=? AND b.connectionId=? AND m.deviceId=b.deviceId`,
        )
        .get(req.params.monitorId, req.params.id) as
        Record<string, unknown> | undefined;
      if (!mapping) throw new ValidationError("Mapped monitor not found.", 404);
      const body = asObject(req.body),
        enabled = optionalBoolean(body, "enabled"),
        degraded = optionalBoolean(body, "alertOnDegraded");
      if (
        enabled &&
        (!row.enabled || mapping.sourceIdentity !== externalSourceIdentity(row))
      )
        throw new ValidationError(
          "Rebind the current source before enabling this monitor.",
          409,
        );
      return db.transaction(() => {
        invalidateExternalHealthWork(req.params.id);
        db.prepare(
          "UPDATE deviceMonitors SET enabled=?,lastResult='unknown',lastCheckAt=NULL,pendingAlertKind=NULL,pendingAlertAt=NULL,lastAlertAttemptAt=NULL WHERE id=?",
        ).run(
          enabled === undefined ? Number(mapping.enabled) : enabled ? 1 : 0,
          req.params.monitorId,
        );
        if (degraded !== undefined)
          db.prepare(
            "UPDATE externalMonitorMappings SET alertOnDegraded=? WHERE monitorId=?",
          ).run(degraded ? 1 : 0, req.params.monitorId);
        probeObservations.delete(req.params.monitorId);
        resetExternalMonitorResults(undefined, true, req.params.monitorId);
        reconcileDeviceMonitorRollup(String(mapping.deviceId));
        audit(
          req,
          row,
          "monitor.external.update",
          "Updated external monitor activation or degraded-alert opt-in",
        );
        return view(row);
      })();
    },
  );
};
