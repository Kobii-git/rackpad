import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../lib/auth.js";
import {
  assertLabRead,
  assertLabWrite,
  resolveLabIdsForList,
} from "../lib/lab-access.js";
import { canEncryptSecrets } from "../lib/secret-crypto.js";
import {
  createIntegrationConnection,
  deleteIntegrationConnection,
  getIntegrationConnectionRow,
  listIntegrationConnections,
  updateIntegrationConnection,
} from "../lib/integrations/connections.js";
import {
  INTEGRATION_AUTH_KINDS,
  INTEGRATION_PROVIDER_INFO,
  INTEGRATION_PROVIDERS,
  type IntegrationAuthKind,
  type IntegrationProvider,
} from "../lib/integrations/types.js";
import {
  asObject,
  optionalBoolean,
  optionalEnum,
  optionalString,
  requiredEnum,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

const SECRET_KEY_REQUIRED_MESSAGE =
  "RACKPAD_SECRET_KEY must be configured before storing integration credentials.";

function validateConnectionAuth(
  provider: IntegrationProvider,
  authKind: IntegrationAuthKind,
  authId: string | null | undefined,
  partial = false,
) {
  const needsAuthId = !(provider === "unifi" && authKind === "api-key");
  if (!partial && needsAuthId && !authId?.trim()) {
    throw new ValidationError(
      `authId is required for ${INTEGRATION_PROVIDER_INFO[provider].label} connections.`,
    );
  }
}

export const integrationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/providers", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return INTEGRATION_PROVIDERS.map((id) => INTEGRATION_PROVIDER_INFO[id]);
  });

  app.get("/connections", async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const query = req.query as { labId?: string };
    const filter = resolveLabIdsForList(
      req.authUser,
      req.labAccess ?? [],
      query.labId,
    );
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error });
    }

    if (query.labId) {
      if (!assertLabRead(req, reply, query.labId)) return;
      return listIntegrationConnections(query.labId);
    }

    if (filter.labIds === null) {
      return listIntegrationConnections();
    }

    const allowed = new Set(filter.labIds);
    return listIntegrationConnections().filter((entry) =>
      allowed.has(entry.labId),
    );
  });

  app.post("/connections", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    if (!canEncryptSecrets()) {
      return reply.status(503).send({ error: SECRET_KEY_REQUIRED_MESSAGE });
    }

    const body = asObject(req.body);
    const labId = requiredString(body, "labId", { maxLength: 80 });
    if (!assertLabWrite(req, reply, labId)) return;

    const provider = requiredEnum(body, "provider", INTEGRATION_PROVIDERS);
    const authKind =
      optionalEnum(body, "authKind", INTEGRATION_AUTH_KINDS) ??
      INTEGRATION_PROVIDER_INFO[provider].defaultAuthKind;
    const authId = optionalString(body, "authId", { maxLength: 200 }) ?? null;
    const authSecret = requiredString(body, "authSecret", { maxLength: 500 });
    validateConnectionAuth(provider, authKind, authId);

    const created = createIntegrationConnection({
      labId,
      provider,
      name: requiredString(body, "name", { maxLength: 120 }),
      baseUrl: requiredString(body, "baseUrl", { maxLength: 500 }),
      authKind,
      authId,
      authSecret,
      siteRef: optionalString(body, "siteRef", { maxLength: 120 }) ?? null,
      verifyTls: optionalBoolean(body, "verifyTls") ?? true,
      enabled: optionalBoolean(body, "enabled") ?? true,
      syncVlans: optionalBoolean(body, "syncVlans") ?? true,
      syncSubnets: optionalBoolean(body, "syncSubnets") ?? true,
      syncDhcp: optionalBoolean(body, "syncDhcp") ?? true,
    });

    return reply.status(201).send(created);
  });

  app.patch<{ Params: { id: string } }>(
    "/connections/:id",
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;

      const existing = getIntegrationConnectionRow(req.params.id);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabWrite(req, reply, String(existing.labId))) return;

      const body = asObject(req.body);
      const authSecret = optionalString(body, "authSecret", { maxLength: 500 });
      if (authSecret != null && !canEncryptSecrets()) {
        return reply.status(503).send({ error: SECRET_KEY_REQUIRED_MESSAGE });
      }

      const provider = String(existing.provider) as IntegrationProvider;
      const authKind = optionalEnum(body, "authKind", INTEGRATION_AUTH_KINDS);
      validateConnectionAuth(
        provider,
        authKind ?? (String(existing.authKind) as IntegrationAuthKind),
        optionalString(body, "authId", { maxLength: 200 }) ??
          (existing.authId as string | null),
        true,
      );

      const updated = updateIntegrationConnection(req.params.id, {
        name: optionalString(body, "name", { maxLength: 120 }) ?? undefined,
        baseUrl:
          optionalString(body, "baseUrl", { maxLength: 500 }) ?? undefined,
        authKind: authKind ?? undefined,
        authId:
          "authId" in body
            ? optionalString(body, "authId", { maxLength: 200 })
            : undefined,
        authSecret: authSecret !== undefined ? authSecret : undefined,
        siteRef:
          "siteRef" in body
            ? optionalString(body, "siteRef", { maxLength: 120 })
            : undefined,
        verifyTls: optionalBoolean(body, "verifyTls") ?? undefined,
        enabled: optionalBoolean(body, "enabled") ?? undefined,
        syncVlans: optionalBoolean(body, "syncVlans") ?? undefined,
        syncSubnets: optionalBoolean(body, "syncSubnets") ?? undefined,
        syncDhcp: optionalBoolean(body, "syncDhcp") ?? undefined,
        clearSecret: optionalBoolean(body, "clearSecret") ?? false,
      });

      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/connections/:id",
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;

      const existing = getIntegrationConnectionRow(req.params.id);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabWrite(req, reply, String(existing.labId))) return;

      deleteIntegrationConnection(req.params.id);
      return reply.status(204).send();
    },
  );
};
