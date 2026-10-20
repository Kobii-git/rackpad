import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod/v4";
import { db } from "../db.js";
import { assertMcpLab, lookupMcpToken, type McpTokenAccess } from "./mcp-tokens.js";
import { createMcpProposal, mcpProposalSchema } from "./mcp-proposals.js";
import { ValidationError } from "./validation.js";

const page = z.object({ cursor: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(50) });
const labPage = page.extend({ labId: z.string().min(1).max(80) });

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function toolError(error: unknown) {
  const message = error instanceof ValidationError ? error.message : "MCP tool failed.";
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function listPage(sql: string, params: unknown[], cursor: number, limit: number) {
  const rows = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, limit + 1, cursor);
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit), nextCursor: hasMore ? cursor + limit : null };
}

function registerReadTools(server: McpServer, access: McpTokenAccess) {
  server.registerTool("list_labs", {
    description: "List labs granted to this MCP token, with bounded pagination.",
    inputSchema: page,
    annotations: { readOnlyHint: true },
  }, async ({ cursor, limit }) => {
    const ids = access.labIds;
    const placeholders = ids.map(() => "?").join(",");
    return result(listPage(`SELECT id, name, description, location FROM labs WHERE id IN (${placeholders}) ORDER BY name, id`, ids, cursor, limit));
  });

  for (const [name, sql] of [
    ["list_rooms", "SELECT id, labId, name, description, location FROM rooms WHERE labId = ? ORDER BY name, id"],
    ["list_racks", "SELECT id, labId, roomId, name, totalU, description, location FROM racks WHERE labId = ? ORDER BY name, id"],
    ["list_devices", "SELECT id, labId, rackId, roomId, hostname, displayName, deviceType, manufacturer, model, status, placement, startU, heightU, face, rackMountKind, rackColumn, rackColumnSpan FROM devices WHERE labId = ? ORDER BY hostname, id"],
    ["list_ports", "SELECT ports.id, ports.deviceId, ports.name, ports.position, ports.kind, ports.speed, ports.face, ports.linkState FROM ports JOIN devices ON devices.id = ports.deviceId WHERE devices.labId = ? ORDER BY ports.deviceId, ports.position, ports.id"],
  ] as const) {
    server.registerTool(name, {
      description: `List ${name.slice(5)} within one granted lab, with bounded pagination.`,
      inputSchema: labPage,
      annotations: { readOnlyHint: true },
    }, async ({ labId, cursor, limit }) => {
      try {
        assertMcpLab(access, labId);
        return result(listPage(sql, [labId], cursor, limit));
      } catch (error) { return toolError(error); }
    });
  }

  server.registerTool("list_connections", {
    description: "List connections touching one granted lab when both endpoints remain accessible, with bounded pagination.",
    inputSchema: labPage,
    annotations: { readOnlyHint: true },
  }, async ({ labId, cursor, limit }) => {
    try {
      assertMcpLab(access, labId);
      const placeholders = access.labIds.map(() => "?").join(",");
      const sql = `SELECT portLinks.id, portLinks.fromPortId, portLinks.toPortId,
        portLinks.cableType, portLinks.cableLength, portLinks.label
        FROM portLinks
        JOIN ports AS sourcePort ON sourcePort.id = portLinks.fromPortId
        JOIN devices AS sourceDevice ON sourceDevice.id = sourcePort.deviceId
        JOIN ports AS targetPort ON targetPort.id = portLinks.toPortId
        JOIN devices AS targetDevice ON targetDevice.id = targetPort.deviceId
        WHERE (sourceDevice.labId = ? OR targetDevice.labId = ?)
          AND sourceDevice.labId IN (${placeholders})
          AND targetDevice.labId IN (${placeholders})
        ORDER BY portLinks.id`;
      return result(listPage(sql, [labId, labId, ...access.labIds, ...access.labIds], cursor, limit));
    } catch (error) { return toolError(error); }
  });
}

const handler = createMcpHandler((context) => {
  const access = context.authInfo?.token ? lookupMcpToken(context.authInfo.token) : null;
  if (!access) throw new Error("MCP token is invalid or expired.");
  const server = new McpServer({ name: "rackpad-inventory", version: "1.0.0" });
  registerReadTools(server, access);
  if (access.capability === "write") {
    server.registerTool("propose_inventory", {
      description: "Preview a bounded, create-only batch in one lab. A person must review and apply it in Rackpad.",
      inputSchema: mcpProposalSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    }, async (batch) => {
      try {
        assertMcpLab(access, batch.labId, true);
        return result(createMcpProposal(access.owner.id, batch));
      } catch (error) { return toolError(error); }
    });
  }
  return server;
}, { legacy: "reject" });

export const mcpNodeHandler = toNodeHandler(handler);
