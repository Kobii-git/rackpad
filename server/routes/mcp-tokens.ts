import type { FastifyPluginAsync } from "fastify";
import { writeAuditLogEntry } from "../lib/audit-log.js";
import { createMcpToken, listMcpTokens, revokeMcpToken } from "../lib/mcp-tokens.js";
import { asObject, optionalInteger, optionalStringArray, requiredEnum, requiredString, ValidationError } from "../lib/validation.js";

export const mcpTokenRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => listMcpTokens(req.authUser!.id));

  app.post("/", async (req, reply) => {
    const body = asObject(req.body);
    const labIds = optionalStringArray(body, "labIds", { maxItems: 100 });
    if (!labIds?.length) throw new ValidationError("Select at least one lab.");
    const created = createMcpToken({
      owner: req.authUser!,
      name: requiredString(body, "name", { maxLength: 120 }),
      capability: requiredEnum(body, "capability", ["read", "write"] as const),
      labIds,
      expiresInDays: optionalInteger(body, "expiresInDays", { min: 1, max: 30 }) ?? 30,
    });
    writeAuditLogEntry({
      user: req.authUser!.username,
      action: "mcp.token.create",
      entityType: "McpToken",
      entityId: created.id,
      summary: `Created ${created.capability} MCP token for ${created.labIds.length} lab(s).`,
    });
    return reply.status(201).send(created);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!revokeMcpToken(req.authUser!.id, req.params.id)) {
      return reply.status(404).send({ error: "Token not found." });
    }
    writeAuditLogEntry({
      user: req.authUser!.username,
      action: "mcp.token.revoke",
      entityType: "McpToken",
      entityId: req.params.id,
      summary: "Revoked MCP token.",
    });
    return reply.status(204).send();
  });
};
