import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { assertLabRead, assertLabWrite } from "../lib/lab-access.js";
import { resolveAuditLabIds } from "../lib/audit-scope.js";
import { writeAuditLogEntry } from "../lib/audit-log.js";
import {
  assignPublicReference,
  parsePublicReference,
  type ReferenceKind,
} from "../lib/public-references.js";
import { ValidationError } from "../lib/validation.js";

function subject(kind: ReferenceKind, id: string) {
  const table = kind === "device" ? "devices" : "portLinks";
  const row = db
    .prepare(`SELECT id, publicReference FROM ${table} WHERE id=?`)
    .get(id) as { id: string; publicReference: string | null } | undefined;
  const labIds = resolveAuditLabIds(
    db,
    kind === "device" ? "Device" : "PortLink",
    id,
  );
  return row && labIds?.length ? { ...row, labIds } : undefined;
}
function authorize(
  req: FastifyRequest,
  reply: FastifyReply,
  row: ReturnType<typeof subject>,
  write = false,
) {
  if (!row) {
    reply.status(404).send({ error: "Not found." });
    return false;
  }
  return row.labIds.every((id) =>
    (write ? assertLabWrite : assertLabRead)(req, reply, id),
  );
}
export const publicReferenceRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { reference: string } }>(
    "/:reference",
    async (req, reply) => {
      const reference = parsePublicReference(req.params.reference);
      const kind: ReferenceKind = reference.startsWith("rpd1")
        ? "device"
        : "cable";
      const table = kind === "device" ? "devices" : "portLinks";
      const found = db
        .prepare(`SELECT id FROM ${table} WHERE publicReference=?`)
        .get(reference) as { id: string } | undefined;
      const row = found && subject(kind, found.id);
      if (!authorize(req, reply, row)) return;
      const label =
        kind === "device"
          ? (
              db
                .prepare(
                  "SELECT COALESCE(displayName,hostname) AS name FROM devices WHERE id=?",
                )
                .get(row!.id) as { name: string }
            ).name
          : (
              db
                .prepare(
                  "SELECT COALESCE(label,id) AS name FROM portLinks WHERE id=?",
                )
                .get(row!.id) as { name: string }
            ).name;
      const endpoints =
        kind === "cable"
          ? db
              .prepare(
                `SELECT ports.id AS portId, ports.name AS portName, devices.id AS deviceId, devices.hostname, devices.labId
      FROM portLinks JOIN ports ON ports.id IN (portLinks.fromPortId,portLinks.toPortId)
      JOIN devices ON devices.id=ports.deviceId WHERE portLinks.id=? ORDER BY CASE WHEN ports.id=portLinks.fromPortId THEN 0 ELSE 1 END`,
              )
              .all(row!.id)
          : [];
      return {
        kind,
        id: row!.id,
        publicReference: reference,
        labIds: row!.labIds,
        label,
        endpoints,
      };
    },
  );
  app.post<{ Params: { kind: string; id: string } }>(
    "/:kind/:id",
    async (req, reply) => {
      if (req.params.kind !== "device" && req.params.kind !== "cable")
        throw new ValidationError("Invalid reference type.");
      const kind = req.params.kind;
      return db.transaction(() => {
        const row = subject(kind, req.params.id);
        if (!authorize(req, reply, row, true)) return { value: undefined };
        const { publicReference, assigned } = assignPublicReference(
          db,
          kind,
          row!.id,
        );
        if (assigned)
          writeAuditLogEntry({
            user: req.authUser!.username,
            action: "reference.assign",
            entityType: kind === "device" ? "Device" : "PortLink",
            entityId: row!.id,
            summary: `Assigned reference ${publicReference}`,
            labIds: row!.labIds,
          });
        return { value: { kind, id: row!.id, publicReference } };
      })().value;
    },
  );
};
