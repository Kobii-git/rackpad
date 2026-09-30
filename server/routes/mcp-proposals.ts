import type { FastifyPluginAsync } from "fastify";
import { applyMcpProposal, getMcpProposal, listMcpProposals } from "../lib/mcp-proposals.js";

export const mcpProposalRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (req) => listMcpProposals(req.authUser!.id));
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const draft = getMcpProposal(req.authUser!.id, req.params.id);
    if (!draft) return reply.status(404).send({ error: "Proposal not found or expired." });
    return draft;
  });
  app.post<{ Params: { id: string } }>("/:id/apply", async (req) => {
    return { summary: applyMcpProposal(req.authUser!.id, req.params.id) };
  });
};
