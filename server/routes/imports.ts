import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import {
  buildNetboxPortTemplateDraft,
  findExistingNetboxTemplate,
  parseNetBoxDeviceTypeYaml,
  previewNetboxDeviceTypeImport,
} from "../lib/netbox-device-type.js";
import { createId } from "../lib/ids.js";
import { listPortTemplates } from "../lib/port-templates.js";
import { asObject, requiredString } from "../lib/validation.js";

export const importsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/netbox-device-type/preview", async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: "Authentication required." });
    }

    const body = asObject(req.body);
    const yaml = requiredString(body, "yaml", { maxLength: 512_000 });
    return previewNetboxDeviceTypeImport(yaml);
  });

  app.post("/netbox-device-type/import", async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: "Authentication required." });
    }

    const body = asObject(req.body);
    const yaml = requiredString(body, "yaml", { maxLength: 512_000 });
    const parsed = parseNetBoxDeviceTypeYaml(yaml);
    const existing = findExistingNetboxTemplate(
      parsed.manufacturer,
      parsed.model,
      listPortTemplates(),
    );

    if (existing) {
      return reply.status(409).send({
        error: `A port template already exists for ${parsed.manufacturer} ${parsed.model}.`,
        existingTemplate: {
          id: existing.id,
          name: existing.name,
          builtIn: existing.builtIn ?? false,
        },
      });
    }

    const draft = buildNetboxPortTemplateDraft(parsed);
    const id = createId("pt");
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO portTemplates (id, name, description, deviceTypes, ports, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      draft.name,
      draft.description,
      JSON.stringify(draft.deviceTypes),
      JSON.stringify(draft.ports),
      now,
      now,
    );

    const created =
      listPortTemplates().find((template) => template.id === id) ?? null;
    return reply.status(201).send(created);
  });
};
