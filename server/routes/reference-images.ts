import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import {
  ensureImageDataUrl,
  MAX_IMAGE_DATA_URL_LENGTH,
} from "../lib/image-data-url.js";
import { createId } from "../lib/ids.js";
import {
  asObject,
  optionalEnum,
  optionalString,
  requiredEnum,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

const ENTITY_TYPES = ["rack", "room"] as const;
const RACK_FACES = ["front", "rear"] as const;

type EntityType = (typeof ENTITY_TYPES)[number];

function resolveImageTarget(entityType: EntityType, entityId: string) {
  const table = entityType === "rack" ? "racks" : "rooms";
  const target = db
    .prepare(`SELECT id, labId, name FROM ${table} WHERE id = ?`)
    .get(entityId) as
    | { id: string; labId: string; name: string }
    | undefined;

  if (!target) {
    throw new ValidationError(
      `Selected ${entityType === "rack" ? "rack" : "room"} does not exist.`,
      422,
    );
  }

  return target;
}

export const referenceImagesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      labId?: string;
      entityType?: EntityType;
      entityId?: string;
    };
  }>("/", async (req) => {
    let sql = "SELECT * FROM referenceImages WHERE 1=1";
    const params: unknown[] = [];

    if (req.query.labId) {
      sql += " AND labId = ?";
      params.push(req.query.labId);
    }
    if (req.query.entityType) {
      sql += " AND entityType = ?";
      params.push(req.query.entityType);
    }
    if (req.query.entityId) {
      sql += " AND entityId = ?";
      params.push(req.query.entityId);
    }

    sql += " ORDER BY entityType, entityId, face, createdAt DESC, id";
    return db.prepare(sql).all(...params);
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = db
      .prepare("SELECT * FROM referenceImages WHERE id = ?")
      .get(req.params.id);
    if (!row)
      return reply.status(404).send({ error: "Reference image not found" });
    return row;
  });

  app.post("/", async (req, reply) => {
    const body = asObject(req.body);
    const id = optionalString(body, "id", { maxLength: 80 }) ?? createId("img");
    const entityType = requiredEnum(body, "entityType", ENTITY_TYPES);
    const entityId = requiredString(body, "entityId", { maxLength: 80 });
    const fileName = requiredString(body, "fileName", { maxLength: 255 });
    const mimeType = requiredString(body, "mimeType", { maxLength: 80 });
    const dataUrl = requiredString(body, "dataUrl", {
      maxLength: MAX_IMAGE_DATA_URL_LENGTH,
    });
    const label =
      optionalString(body, "label", { maxLength: 160 }) ??
      fileName.replace(/\.[^.]+$/, "");
    const notes = optionalString(body, "notes", { maxLength: 1000 });
    const face =
      entityType === "rack"
        ? (optionalEnum(body, "face", RACK_FACES) ?? "front")
        : null;

    const target = resolveImageTarget(entityType, entityId);
    ensureImageDataUrl(dataUrl, mimeType);

    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO referenceImages
        (id, labId, entityType, entityId, label, fileName, mimeType, dataUrl, face, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      target.labId,
      entityType,
      entityId,
      label,
      fileName,
      mimeType,
      dataUrl,
      face,
      notes ?? null,
      now,
      now,
    );

    return reply
      .status(201)
      .send(db.prepare("SELECT * FROM referenceImages WHERE id = ?").get(id));
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const existing = db
      .prepare("SELECT entityType FROM referenceImages WHERE id = ?")
      .get(req.params.id) as { entityType: EntityType } | undefined;
    if (!existing) {
      return reply.status(404).send({ error: "Reference image not found" });
    }

    const body = asObject(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];

    const label = optionalString(body, "label", { maxLength: 160 });
    const notes = optionalString(body, "notes", { maxLength: 1000 });
    const face =
      existing.entityType === "rack"
        ? optionalEnum(body, "face", RACK_FACES)
        : undefined;

    if (label !== undefined) {
      updates.push("label = ?");
      values.push(label);
    }
    if (notes !== undefined) {
      updates.push("notes = ?");
      values.push(notes);
    }
    if (face !== undefined) {
      updates.push("face = ?");
      values.push(face);
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: "No valid fields to update" });
    }

    updates.push("updatedAt = ?");
    values.push(new Date().toISOString(), req.params.id);

    db.prepare(
      `UPDATE referenceImages SET ${updates.join(", ")} WHERE id = ?`,
    ).run(...values);

    return db
      .prepare("SELECT * FROM referenceImages WHERE id = ?")
      .get(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = db
      .prepare("SELECT id FROM referenceImages WHERE id = ?")
      .get(req.params.id);
    if (!row)
      return reply.status(404).send({ error: "Reference image not found" });
    db.prepare("DELETE FROM referenceImages WHERE id = ?").run(req.params.id);
    return reply.status(204).send();
  });
};
