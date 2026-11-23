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
  optionalNumber,
  optionalString,
  requiredInteger,
  ValidationError,
} from "../lib/validation.js";

function authorize(
  req: FastifyRequest,
  reply: FastifyReply,
  roomId: string,
  write = false,
) {
  const room = db.prepare("SELECT * FROM rooms WHERE id=?").get(roomId) as
    Record<string, unknown> | undefined;
  return (write ? assertLabWriteFromRow : assertLabReadFromRow)(
    req,
    reply,
    room,
  );
}
function read(roomId: string) {
  const plan = db
    .prepare("SELECT * FROM roomFloorplans WHERE roomId=?")
    .get(roomId) as
    | {
        roomId: string;
        backgroundImageId: string | null;
        revision: number;
        updatedAt: string;
      }
    | undefined;
  const background = plan?.backgroundImageId
    ? db
        .prepare("SELECT * FROM referenceImages WHERE id=?")
        .get(plan.backgroundImageId)
    : null;
  const markers = db
    .prepare(
      `SELECT m.*, COALESCE(m.label, d.displayName, d.hostname, r.name) AS name
    FROM roomFloorplanMarkers m LEFT JOIN devices d ON d.id=m.deviceId LEFT JOIN racks r ON r.id=m.rackId WHERE m.roomId=? ORDER BY m.id`,
    )
    .all(roomId);
  return {
    roomId,
    backgroundImageId: plan?.backgroundImageId ?? null,
    revision: plan?.revision ?? 0,
    updatedAt: plan?.updatedAt ?? null,
    background,
    markers,
  };
}
function expectRevision(roomId: string, body: Record<string, unknown>) {
  const revision = requiredInteger(body, "revision", {
    min: 0,
    max: 2147483647,
  });
  const current = db
    .prepare("SELECT revision FROM roomFloorplans WHERE roomId=?")
    .get(roomId) as { revision: number } | undefined;
  if (revision !== (current?.revision ?? 0))
    throw new ValidationError(
      "Floorplan changed. Reload before applying this edit.",
      409,
      "FLOORPLAN_CONFLICT",
    );
  db.prepare(
    "INSERT OR IGNORE INTO roomFloorplans(roomId,updatedAt) VALUES(?,?)",
  ).run(roomId, new Date().toISOString());
}
function audit(req: FastifyRequest, roomId: string, action: string) {
  writeAuditLogEntry({
    user: req.authUser!.username,
    action,
    entityType: "Room",
    entityId: roomId,
    summary: "Updated room floorplan",
  });
}
export const floorplanRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { roomId: string } }>("/:roomId", async (req, reply) => {
    if (!authorize(req, reply, req.params.roomId)) return;
    return read(req.params.roomId);
  });
  app.put<{ Params: { roomId: string } }>("/:roomId", async (req, reply) => {
    const roomId = req.params.roomId;
    if (!authorize(req, reply, roomId, true)) return;
    const body = asObject(req.body);
    if (!Object.hasOwn(body, "backgroundImageId"))
      throw new ValidationError("Select a floorplan background or null.");
    const backgroundImageId =
      optionalString(body, "backgroundImageId", { maxLength: 80 }) ?? null;
    const confirm = optionalBoolean(body, "confirmBackgroundChange") ?? false;
    return db.transaction(() => {
      expectRevision(roomId, body);
      const current = read(roomId);
      if (
        current.backgroundImageId &&
        backgroundImageId &&
        backgroundImageId !== current.backgroundImageId &&
        !confirm
      )
        throw new ValidationError(
          "Confirm replacing the floorplan background.",
          409,
          "FLOORPLAN_BACKGROUND_CONFIRMATION",
        );
      if (backgroundImageId) {
        const image = db
          .prepare(
            "SELECT 1 FROM referenceImages i JOIN rooms r ON r.id=i.entityId AND r.labId=i.labId WHERE i.id=? AND i.entityType='room' AND r.id=?",
          )
          .get(backgroundImageId, roomId);
        if (!image)
          throw new ValidationError(
            "Background must be a reference image of this room.",
            422,
          );
      }
      db.prepare(
        "UPDATE roomFloorplans SET backgroundImageId=? WHERE roomId=?",
      ).run(backgroundImageId, roomId);
      audit(req, roomId, "floorplan.background");
      return read(roomId);
    })();
  });
  app.post<{ Params: { roomId: string } }>(
    "/:roomId/markers",
    async (req, reply) => {
      const roomId = req.params.roomId;
      if (!authorize(req, reply, roomId, true)) return;
      const body = asObject(req.body);
      const deviceId =
        optionalString(body, "deviceId", { maxLength: 80 }) ?? null;
      const rackId = optionalString(body, "rackId", { maxLength: 80 }) ?? null;
      if ((deviceId === null) === (rackId === null))
        throw new ValidationError("Select one rack or device.");
      const x = optionalNumber(body, "x", { min: 0, max: 1 }) ?? 0.5,
        y = optionalNumber(body, "y", { min: 0, max: 1 }) ?? 0.5;
      const label = optionalString(body, "label", { maxLength: 120 }) ?? null;
      return db.transaction(() => {
        expectRevision(roomId, body);
        if (
          db
            .prepare(
              "SELECT 1 FROM roomFloorplanMarkers WHERE deviceId=? OR rackId=?",
            )
            .get(deviceId, rackId)
        )
          throw new ValidationError(
            "Inventory already has a floorplan marker.",
            409,
          );
        // Check ownership before inserting, so invalid IDs never reach an FK error.
        const owner = deviceId
          ? db
              .prepare(
                `SELECT d.labId, CASE WHEN d.rackId IS NULL THEN d.roomId ELSE r.roomId END AS roomId FROM devices d LEFT JOIN racks r ON r.id=d.rackId WHERE d.id=?`,
              )
              .get(deviceId)
          : db.prepare("SELECT labId,roomId FROM racks WHERE id=?").get(rackId);
        const room = db
          .prepare("SELECT labId FROM rooms WHERE id=?")
          .get(roomId) as { labId: string };
        if (
          !owner ||
          (owner as { roomId: string; labId: string }).roomId !== roomId ||
          (owner as { labId: string }).labId !== room.labId
        )
          throw new ValidationError(
            "Marker inventory must belong to this room and lab.",
            422,
          );
        db.prepare(
          "INSERT INTO roomFloorplanMarkers(id,roomId,deviceId,rackId,x,y,label,updatedAt) VALUES(?,?,?,?,?,?,?,?)",
        ).run(
          createId("fpm"),
          roomId,
          deviceId,
          rackId,
          x,
          y,
          label,
          new Date().toISOString(),
        );
        audit(req, roomId, "floorplan.marker.create");
        return read(roomId);
      })();
    },
  );
  app.patch<{ Params: { roomId: string; id: string } }>(
    "/:roomId/markers/:id",
    async (req, reply) => {
      const roomId = req.params.roomId;
      if (!authorize(req, reply, roomId, true)) return;
      const body = asObject(req.body);
      const marker = db
        .prepare("SELECT * FROM roomFloorplanMarkers WHERE roomId=? AND id=?")
        .get(roomId, req.params.id) as
        { x: number; y: number; label: string | null } | undefined;
      if (!marker) return reply.status(404).send({ error: "Not found." });
      const x = optionalNumber(body, "x", { min: 0, max: 1 }) ?? marker.x,
        y = optionalNumber(body, "y", { min: 0, max: 1 }) ?? marker.y;
      const label = optionalString(body, "label", { maxLength: 120 });
      return db.transaction(() => {
        expectRevision(roomId, body);
        if (
          x === marker.x &&
          y === marker.y &&
          (label === undefined ? marker.label : label) === marker.label
        )
          return read(roomId);
        db.prepare(
          "UPDATE roomFloorplanMarkers SET x=?,y=?,label=?,updatedAt=? WHERE id=? AND roomId=?",
        ).run(
          x,
          y,
          label === undefined ? marker.label : label,
          new Date().toISOString(),
          req.params.id,
          roomId,
        );
        audit(req, roomId, "floorplan.marker.update");
        return read(roomId);
      })();
    },
  );
  app.delete<{ Params: { roomId: string; id: string } }>(
    "/:roomId/markers/:id",
    async (req, reply) => {
      const roomId = req.params.roomId;
      if (!authorize(req, reply, roomId, true)) return;
      const body = asObject(req.body);
      return db.transaction(() => {
        expectRevision(roomId, body);
        const changed = db
          .prepare("DELETE FROM roomFloorplanMarkers WHERE id=? AND roomId=?")
          .run(req.params.id, roomId).changes;
        if (!changed) throw new ValidationError("Not found.", 404);
        audit(req, roomId, "floorplan.marker.delete");
        return read(roomId);
      })();
    },
  );
};
