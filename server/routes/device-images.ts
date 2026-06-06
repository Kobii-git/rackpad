import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import {
  appendLabFilter,
  assertLabReadFromRow,
  assertLabWrite,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from "../lib/lab-access.js";
import {
  ensureImageDataUrl,
  MAX_IMAGE_DATA_URL_LENGTH,
} from "../lib/image-data-url.js";
import { createId } from "../lib/ids.js";
import {
  asObject,
  optionalString,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

function getDeviceLabRow(deviceId: string) {
  return db.prepare("SELECT id, labId FROM devices WHERE id = ?").get(deviceId) as
    | { id: string; labId: string }
    | undefined;
}

function getDeviceImageLabRow(imageId: string) {
  return db.prepare(`
    SELECT deviceImages.id, devices.labId
    FROM deviceImages
    JOIN devices ON devices.id = deviceImages.deviceId
    WHERE deviceImages.id = ?
  `).get(imageId) as { id: string; labId: string } | undefined;
}

export const deviceImagesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { deviceId?: string; labId?: string } }>(
    "/",
    async (req, reply) => {
      if (!req.authUser) {
        return reply.status(401).send({ error: "Authentication required." });
      }

      const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId);
      if (!filter.ok) {
        return reply.status(filter.status).send({ error: filter.error });
      }

      let sql = `
        SELECT deviceImages.*
        FROM deviceImages
        JOIN devices ON devices.id = deviceImages.deviceId
        WHERE 1=1
      `;
      const params: unknown[] = [];

      if (req.query.deviceId) {
        sql += " AND deviceImages.deviceId = ?";
        params.push(req.query.deviceId);
      }
      const filtered = appendLabFilter(sql, params, filter.labIds, "devices.labId");

      return db.prepare(`${filtered.sql} ORDER BY deviceImages.createdAt DESC, deviceImages.id`).all(...filtered.params);
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = db
      .prepare(`
        SELECT deviceImages.*, devices.labId
        FROM deviceImages
        JOIN devices ON devices.id = deviceImages.deviceId
        WHERE deviceImages.id = ?
      `)
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabReadFromRow(req, reply, row)) return;
    return row;
  });

  app.post("/", async (req, reply) => {
    const body = asObject(req.body);
    const id = optionalString(body, "id", { maxLength: 80 }) ?? createId("img");
    const deviceId = requiredString(body, "deviceId", { maxLength: 80 });
    const fileName = requiredString(body, "fileName", { maxLength: 255 });
    const mimeType = requiredString(body, "mimeType", { maxLength: 80 });
    const dataUrl = requiredString(body, "dataUrl", {
      maxLength: MAX_IMAGE_DATA_URL_LENGTH,
    });
    const label =
      optionalString(body, "label", { maxLength: 160 }) ??
      fileName.replace(/\.[^.]+$/, "");
    const notes = optionalString(body, "notes", { maxLength: 1000 });

    const device = getDeviceLabRow(deviceId);
    if (!device)
      throw new ValidationError("Selected device does not exist.", 422);
    if (!assertLabWrite(req, reply, device.labId)) return;

    ensureImageDataUrl(dataUrl, mimeType);

    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO deviceImages
        (id, deviceId, label, fileName, mimeType, dataUrl, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      deviceId,
      label,
      fileName,
      mimeType,
      dataUrl,
      notes ?? null,
      now,
      now,
    );

    return reply
      .status(201)
      .send(db.prepare("SELECT * FROM deviceImages WHERE id = ?").get(id));
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const existing = getDeviceImageLabRow(req.params.id);
    if (!assertLabWriteFromRow(req, reply, existing)) return;

    const body = asObject(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];

    const label = optionalString(body, "label", { maxLength: 160 });
    const notes = optionalString(body, "notes", { maxLength: 1000 });

    if (label !== undefined) {
      updates.push("label = ?");
      values.push(label);
    }
    if (notes !== undefined) {
      updates.push("notes = ?");
      values.push(notes);
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: "No valid fields to update" });
    }

    updates.push("updatedAt = ?");
    values.push(new Date().toISOString(), req.params.id);

    db.prepare(
      `UPDATE deviceImages SET ${updates.join(", ")} WHERE id = ?`,
    ).run(...values);

    return db
      .prepare("SELECT * FROM deviceImages WHERE id = ?")
      .get(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = getDeviceImageLabRow(req.params.id);
    if (!assertLabWriteFromRow(req, reply, row)) return;
    db.prepare("DELETE FROM deviceImages WHERE id = ?").run(req.params.id);
    return reply.status(204).send();
  });
};
