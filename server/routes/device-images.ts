import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
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

export const deviceImagesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { deviceId?: string; labId?: string } }>(
    "/",
    async (req) => {
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
      if (req.query.labId) {
        sql += " AND devices.labId = ?";
        params.push(req.query.labId);
      }

      sql += " ORDER BY deviceImages.createdAt DESC, deviceImages.id";
      return db.prepare(sql).all(...params);
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = db
      .prepare("SELECT * FROM deviceImages WHERE id = ?")
      .get(req.params.id);
    if (!row)
      return reply.status(404).send({ error: "Device image not found" });
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

    const device = db
      .prepare("SELECT id FROM devices WHERE id = ?")
      .get(deviceId);
    if (!device)
      throw new ValidationError("Selected device does not exist.", 422);

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
    const existing = db
      .prepare("SELECT id FROM deviceImages WHERE id = ?")
      .get(req.params.id);
    if (!existing) {
      return reply.status(404).send({ error: "Device image not found" });
    }

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
    const row = db
      .prepare("SELECT id FROM deviceImages WHERE id = ?")
      .get(req.params.id);
    if (!row)
      return reply.status(404).send({ error: "Device image not found" });
    db.prepare("DELETE FROM deviceImages WHERE id = ?").run(req.params.id);
    return reply.status(204).send();
  });
};
