import { hostHeaderValidation, originValidation } from "@modelcontextprotocol/fastify";
import type { FastifyPluginAsync } from "fastify";
import { mcpNodeHandler } from "../lib/mcp-server.js";
import { CONTENT_SECURITY_POLICY } from "../security-headers.js";

function configuredHosts(name: string) {
  const hosts = (process.env[name] ?? "").split(/[\s,]+/).filter(Boolean).flatMap((value) => {
    try { return [value.includes("://") ? new URL(value).hostname : value.replace(/:\d+$/, "")]; }
    catch { return []; }
  });
  return [...new Set(["localhost", "127.0.0.1", "[::1]", ...hosts])];
}

export const mcpRoutes: FastifyPluginAsync = async (app) => {
  const checkHost = hostHeaderValidation(configuredHosts("TRUSTED_HOSTS"));
  const checkOrigin = originValidation(configuredHosts("TRUSTED_ORIGINS"));
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/",
    preHandler: [checkHost, checkOrigin],
    handler: async (req, reply) => {
      reply.raw.setHeader("Cache-Control", "no-store");
      reply.raw.setHeader("X-Content-Type-Options", "nosniff");
      reply.raw.setHeader("X-Frame-Options", "DENY");
      reply.raw.setHeader("Referrer-Policy", "no-referrer");
      reply.raw.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      reply.raw.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      reply.raw.setHeader("X-DNS-Prefetch-Control", "off");
      reply.raw.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
      reply.raw.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
      if (req.protocol === "https") reply.raw.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
      reply.hijack();
      await mcpNodeHandler(Object.assign(req.raw, {
        auth: { token: req.headers.authorization!.slice("Bearer ".length),
          clientId: req.mcpAuth!.id,
          scopes: req.mcpAuth!.capability === "write" ? ["inventory:read", "inventory:propose"] : ["inventory:read"] },
      }), reply.raw, req.body);
    },
  });
};
