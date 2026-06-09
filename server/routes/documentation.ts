import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import {
  appendLabFilter,
  assertLabReadFromRow,
  assertLabWrite,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from "../lib/lab-access.js";
import { createId } from "../lib/ids.js";
import {
  asObject,
  optionalString,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

const MAX_MARKDOWN_LENGTH = 10 * 1024 * 1024;

export const documentationRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>("/", async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: "Authentication required." });
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId);
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error });
    }

    const { sql, params } = appendLabFilter("SELECT * FROM documentationPages", [], filter.labIds);
    return db.prepare(`${sql} ORDER BY updatedAt DESC, title, id`).all(...params);
  });

  app.get<{ Querystring: { deviceId?: string; pageId?: string } }>(
    "/links",
    async (req, reply) => {
      if (!req.authUser) {
        return reply.status(401).send({ error: "Authentication required." });
      }

      const filter = resolveLabIdsForList(
        req.authUser,
        req.labAccess ?? [],
        undefined,
      );
      if (!filter.ok) {
        return reply.status(filter.status).send({ error: filter.error });
      }

      if (req.query.deviceId) {
        if (filter.labIds === null) {
          return db
            .prepare(
              `
              SELECT documentationDeviceLinks.*
              FROM documentationDeviceLinks
              JOIN documentationPages ON documentationPages.id = documentationDeviceLinks.documentationPageId
              WHERE documentationDeviceLinks.deviceId = ?
              ORDER BY documentationDeviceLinks.createdAt DESC
            `,
            )
            .all(req.query.deviceId);
        }

        const labPlaceholders = filter.labIds.map(() => "?").join(", ");
        return db
          .prepare(
            `
            SELECT documentationDeviceLinks.*
            FROM documentationDeviceLinks
            JOIN documentationPages ON documentationPages.id = documentationDeviceLinks.documentationPageId
            JOIN devices ON devices.id = documentationDeviceLinks.deviceId
            WHERE documentationDeviceLinks.deviceId = ?
              AND documentationPages.labId IN (${labPlaceholders})
              AND devices.labId IN (${labPlaceholders})
            ORDER BY documentationDeviceLinks.createdAt DESC
          `,
          )
          .all(req.query.deviceId, ...filter.labIds, ...filter.labIds);
      }

      if (req.query.pageId) {
        const page = db
          .prepare("SELECT labId FROM documentationPages WHERE id = ?")
          .get(req.query.pageId) as { labId: string } | undefined;
        if (!page) {
          return reply.status(404).send({ error: "Documentation page not found." });
        }
        if (filter.labIds !== null && !filter.labIds.includes(page.labId)) {
          return reply.status(404).send({ error: "Documentation page not found." });
        }
        return db
          .prepare(
            `
            SELECT * FROM documentationDeviceLinks
            WHERE documentationPageId = ?
            ORDER BY createdAt DESC
          `,
          )
          .all(req.query.pageId);
      }

      return reply.status(400).send({ error: "deviceId or pageId is required." });
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = db
      .prepare("SELECT * FROM documentationPages WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabReadFromRow(req, reply, row)) return;
    return row;
  });

  app.post("/", async (req, reply) => {
    const body = asObject(req.body);
    const id = optionalString(body, "id", { maxLength: 80 }) ?? createId("doc");
    const labId = requiredString(body, "labId", { maxLength: 80 });
    if (!assertLabWrite(req, reply, labId)) return;
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
      .prepare("SELECT * FROM documentationPages WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabWriteFromRow(req, reply, existing)) return;

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
      .prepare("SELECT * FROM documentationPages WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabWriteFromRow(req, reply, row)) return;
    db.prepare("DELETE FROM documentationPages WHERE id = ?").run(
      req.params.id,
    );
    return reply.status(204).send();
  });

  app.post<{ Params: { pageId: string } }>(
    "/:pageId/device-links",
    async (req, reply) => {
      const page = db
        .prepare("SELECT * FROM documentationPages WHERE id = ?")
        .get(req.params.pageId) as Record<string, unknown> | undefined;
      if (!assertLabWriteFromRow(req, reply, page)) return;

      const body = asObject(req.body);
      const deviceId = requiredString(body, "deviceId", { maxLength: 80 });
      const device = db
        .prepare("SELECT id, labId FROM devices WHERE id = ?")
        .get(deviceId) as { id: string; labId: string } | undefined;
      if (!device || String(page!.labId) !== device.labId) {
        return reply.status(404).send({ error: "Device not found in this lab." });
      }

      const existing = db
        .prepare(
          "SELECT id FROM documentationDeviceLinks WHERE documentationPageId = ? AND deviceId = ?",
        )
        .get(req.params.pageId, deviceId) as { id: string } | undefined;
      if (existing) {
        return reply.status(409).send({ error: "Documentation is already linked to this device." });
      }

      const id = createId("doclink");
      const now = new Date().toISOString();
      db.prepare(
        `
        INSERT INTO documentationDeviceLinks (id, documentationPageId, deviceId, createdAt)
        VALUES (?, ?, ?, ?)
      `,
      ).run(id, req.params.pageId, deviceId, now);

      return reply.status(201).send(
        db.prepare("SELECT * FROM documentationDeviceLinks WHERE id = ?").get(id),
      );
    },
  );

  app.delete<{ Params: { pageId: string; deviceId: string } }>(
    "/:pageId/device-links/:deviceId",
    async (req, reply) => {
      const page = db
        .prepare("SELECT * FROM documentationPages WHERE id = ?")
        .get(req.params.pageId) as Record<string, unknown> | undefined;
      if (!assertLabWriteFromRow(req, reply, page)) return;

      const result = db
        .prepare(
          "DELETE FROM documentationDeviceLinks WHERE documentationPageId = ? AND deviceId = ?",
        )
        .run(req.params.pageId, req.params.deviceId);
      if (result.changes === 0) {
        return reply.status(404).send({ error: "Documentation link not found." });
      }
      return reply.status(204).send();
    },
  );
};
