import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { createId } from "../lib/ids.js";
import {
  asObject,
  optionalString,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

const MAX_MARKDOWN_LENGTH = 10 * 1024 * 1024;

export const documentationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>("/", async (req) => {
    if (req.query.labId) {
      return db
        .prepare(
          "SELECT * FROM documentationPages WHERE labId = ? ORDER BY updatedAt DESC, title, id",
        )
        .all(req.query.labId);
    }

    return db
      .prepare(
        "SELECT * FROM documentationPages ORDER BY updatedAt DESC, title, id",
      )
      .all();
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = db
      .prepare("SELECT * FROM documentationPages WHERE id = ?")
      .get(req.params.id);
    if (!row)
      return reply.status(404).send({ error: "Documentation not found" });
    return row;
  });

  app.post("/", async (req, reply) => {
    const body = asObject(req.body);
    const id = optionalString(body, "id", { maxLength: 80 }) ?? createId("doc");
    const labId = requiredString(body, "labId", { maxLength: 80 });
    const title = requiredString(body, "title", { maxLength: 160 });
    const content =
      optionalString(body, "content", {
        maxLength: MAX_MARKDOWN_LENGTH,
        allowEmpty: true,
      }) ?? "";

    const lab = db.prepare("SELECT id FROM labs WHERE id = ?").get(labId);
    if (!lab) throw new ValidationError("Selected lab does not exist.", 422);

    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO documentationPages (id, labId, title, content, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(id, labId, title, content, now, now);

    return reply
      .status(201)
      .send(
        db.prepare("SELECT * FROM documentationPages WHERE id = ?").get(id),
      );
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const existing = db
      .prepare("SELECT id FROM documentationPages WHERE id = ?")
      .get(req.params.id);
    if (!existing) {
      return reply.status(404).send({ error: "Documentation not found" });
    }

    const body = asObject(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];

    const title = optionalString(body, "title", { maxLength: 160 });
    const content = optionalString(body, "content", {
      maxLength: MAX_MARKDOWN_LENGTH,
      allowEmpty: true,
    });

    if (title !== undefined) {
      updates.push("title = ?");
      values.push(title);
    }
    if (content !== undefined) {
      updates.push("content = ?");
      values.push(content ?? "");
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: "No valid fields to update" });
    }

    updates.push("updatedAt = ?");
    values.push(new Date().toISOString(), req.params.id);

    db.prepare(
      `UPDATE documentationPages SET ${updates.join(", ")} WHERE id = ?`,
    ).run(...values);

    return db
      .prepare("SELECT * FROM documentationPages WHERE id = ?")
      .get(req.params.id);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = db
      .prepare("SELECT id FROM documentationPages WHERE id = ?")
      .get(req.params.id);
    if (!row) {
      return reply.status(404).send({ error: "Documentation not found" });
    }
    db.prepare("DELETE FROM documentationPages WHERE id = ?").run(
      req.params.id,
    );
    return reply.status(204).send();
  });
};
