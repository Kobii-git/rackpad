import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { requireAdmin, requireAuth } from "../lib/auth.js";
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
  loadIntegrationConnectionSecrets,
  normalizeIntegrationBaseUrl,
  parseIntegrationConnectionPublic,
  recordIntegrationConnectionStatus,
  updateIntegrationConnection,
} from "../lib/integrations/connections.js";
import { getIntegrationClient } from "../lib/integrations/index.js";
import type { IntegrationConnectionSecrets } from "../lib/integrations/types.js";
import {
  applyIntegrationNetworkPreview,
  buildIntegrationNetworkPreview,
} from "../lib/integrations/network-sync.js";
import {
  fetchProxmoxNodes,
  fetchProxmoxStagedInventory,
} from "../lib/integrations/providers/proxmox.js";
import { isValidCronExpression } from "../lib/integrations/cron.js";
import { runIntegrationAutoSync } from "../lib/integrations/auto-sync.js";
import {
  INTEGRATION_AUTH_KINDS,
  INTEGRATION_AUTO_SYNC_MODES,
  INTEGRATION_PROVIDER_INFO,
  INTEGRATION_PROVIDERS,
  type IntegrationAuthKind,
  type IntegrationProvider,
} from "../lib/integrations/types.js";
import {
  SNMP_SYNC_POLICIES,
  type SnmpSyncPolicy,
  type SnmpSyncPreview,
} from "../lib/snmp-profiles/types.js";
import {
  asObject,
  optionalBoolean,
  optionalEnum,
  optionalString,
  optionalStringArray,
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
  // API keys are a single secret; every other auth kind pairs the secret
  // with an identifier (username, token id, client id, or key id).
  const needsAuthId = authKind !== "api-key";
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
      scopeRefs:
        optionalStringArray(body, "scopeRefs", { maxItems: 100 }) ?? undefined,
      verifyTls: optionalBoolean(body, "verifyTls") ?? true,
      enabled: optionalBoolean(body, "enabled") ?? true,
      syncVlans: optionalBoolean(body, "syncVlans") ?? true,
      syncSubnets: optionalBoolean(body, "syncSubnets") ?? true,
      syncDhcp: optionalBoolean(body, "syncDhcp") ?? true,
    });

    return reply.status(201).send(created);
  });

  // One call behind the "Test & discover" button: proves the credentials
  // and returns the selectable scopes (sites, nodes, environments). Works
  // with inline credentials before a connection exists, or with a stored
  // connection id (optionally overriding the secret being retyped).
  app.post("/discover-scopes", async (req, reply) => {
    if (!requireAuth(req, reply)) return;

    const body = asObject(req.body);
    const connectionId = optionalString(body, "connectionId", {
      maxLength: 80,
    });

    let secrets: IntegrationConnectionSecrets;
    if (connectionId) {
      const existing = getIntegrationConnectionRow(connectionId);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabWrite(req, reply, String(existing.labId))) return;
      secrets = loadIntegrationConnectionSecrets(connectionId);
      const inlineSecret = optionalString(body, "authSecret", {
        maxLength: 500,
      });
      if (inlineSecret) secrets = { ...secrets, authSecret: inlineSecret };
      const inlineAuthId = optionalString(body, "authId", { maxLength: 200 });
      if (inlineAuthId !== undefined) {
        secrets = { ...secrets, authId: inlineAuthId };
      }
    } else {
      const labId = requiredString(body, "labId", { maxLength: 80 });
      if (!assertLabWrite(req, reply, labId)) return;
      const provider = requiredEnum(body, "provider", INTEGRATION_PROVIDERS);
      const authKind =
        optionalEnum(body, "authKind", INTEGRATION_AUTH_KINDS) ??
        INTEGRATION_PROVIDER_INFO[provider].defaultAuthKind;
      secrets = {
        id: "discover",
        labId,
        provider,
        name: "discover",
        baseUrl: normalizeIntegrationBaseUrl(
          requiredString(body, "baseUrl", { maxLength: 500 }),
        ),
        authKind,
        authId: optionalString(body, "authId", { maxLength: 200 }) ?? null,
        authSecret: requiredString(body, "authSecret", { maxLength: 500 }),
        siteRef: null,
        scopeRefs: [],
        verifyTls: optionalBoolean(body, "verifyTls") ?? true,
        enabled: true,
        syncVlans: true,
        syncSubnets: true,
        syncDhcp: true,
        autoSyncEnabled: false,
        autoSyncMode: "merge",
        autoSyncCron: null,
        autoSyncLabIds: [],
        autoSyncFailureCount: 0,
        autoSyncPausedUntil: null,
      };
    }

    const client = getIntegrationClient(secrets.provider);
    if (!client) {
      return reply.status(501).send({
        error: `The ${INTEGRATION_PROVIDER_INFO[secrets.provider].label} client is not available in this build.`,
      });
    }
    if (!secrets.authSecret) {
      return reply.status(400).send({
        error:
          "This connection has no stored secret. Enter the credential again first.",
      });
    }

    try {
      const result = await client.test(secrets);
      const scopes = client.listScopes ? await client.listScopes(secrets) : [];
      return {
        result,
        scopeKind: INTEGRATION_PROVIDER_INFO[secrets.provider].scopeKind,
        scopes,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Connection test failed.";
      return reply.status(502).send({ error: message });
    }
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

      const autoSyncEnabled = optionalBoolean(body, "autoSyncEnabled");
      const autoSyncMode = optionalEnum(
        body,
        "autoSyncMode",
        INTEGRATION_AUTO_SYNC_MODES,
      );
      const autoSyncCron =
        "autoSyncCron" in body
          ? optionalString(body, "autoSyncCron", { maxLength: 120 })
          : undefined;
      const autoSyncLabIds = optionalStringArray(body, "autoSyncLabIds", {
        maxItems: 50,
      });
      const touchesAutoSync =
        autoSyncEnabled != null ||
        autoSyncMode != null ||
        autoSyncCron !== undefined ||
        (autoSyncLabIds !== undefined && autoSyncLabIds !== null);

      if (touchesAutoSync) {
        // Auto-sync writes to labs without a per-run review, so configuring
        // it is an admin decision even though editors manage connections.
        if (!requireAdmin(req, reply)) return;
        if (autoSyncCron != null && !isValidCronExpression(autoSyncCron)) {
          return reply.status(400).send({
            error:
              "autoSyncCron is not a valid five-field cron expression (minute hour day-of-month month day-of-week).",
          });
        }
        if (autoSyncLabIds) {
          for (const labId of autoSyncLabIds) {
            const lab = db
              .prepare("SELECT id FROM labs WHERE id = ?")
              .get(labId);
            if (!lab) {
              return reply
                .status(422)
                .send({ error: `Target lab ${labId} does not exist.` });
            }
          }
        }
        const nextCron =
          autoSyncCron !== undefined
            ? autoSyncCron
            : ((existing.autoSyncCron as string | null) ?? null);
        const enabling = autoSyncEnabled ?? Boolean(existing.autoSyncEnabled);
        if (enabling && !nextCron) {
          return reply.status(400).send({
            error: "A schedule is required before enabling auto-sync.",
          });
        }
      }

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
        scopeRefs:
          optionalStringArray(body, "scopeRefs", { maxItems: 100 }) ??
          undefined,
        verifyTls: optionalBoolean(body, "verifyTls") ?? undefined,
        enabled: optionalBoolean(body, "enabled") ?? undefined,
        syncVlans: optionalBoolean(body, "syncVlans") ?? undefined,
        syncSubnets: optionalBoolean(body, "syncSubnets") ?? undefined,
        syncDhcp: optionalBoolean(body, "syncDhcp") ?? undefined,
        clearSecret: optionalBoolean(body, "clearSecret") ?? false,
        autoSyncEnabled: autoSyncEnabled ?? undefined,
        autoSyncMode: autoSyncMode ?? undefined,
        autoSyncCron: autoSyncCron !== undefined ? autoSyncCron : undefined,
        autoSyncLabIds: autoSyncLabIds ?? undefined,
      });

      return updated;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/connections/:id/auto-sync/run",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const existing = getIntegrationConnectionRow(req.params.id);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabWrite(req, reply, String(existing.labId))) return;
      if (!existing.enabled) {
        return reply.status(409).send({
          error:
            "This connection is disabled. Enable it before running auto-sync.",
        });
      }

      const result = await runIntegrationAutoSync(req.params.id);
      const connection = getIntegrationConnectionRow(req.params.id);
      return {
        result,
        connection: connection
          ? parseIntegrationConnectionPublic(connection)
          : null,
      };
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

  app.post<{ Params: { id: string } }>(
    "/connections/:id/test",
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;

      const existing = getIntegrationConnectionRow(req.params.id);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabWrite(req, reply, String(existing.labId))) return;

      const provider = String(existing.provider) as IntegrationProvider;
      const client = getIntegrationClient(provider);
      if (!client) {
        return reply.status(501).send({
          error: `The ${INTEGRATION_PROVIDER_INFO[provider].label} client is not available in this build.`,
        });
      }

      const connection = loadIntegrationConnectionSecrets(req.params.id);
      if (!connection.authSecret) {
        return reply.status(400).send({
          error:
            "This connection has no stored secret. Enter the credential again before testing.",
        });
      }

      try {
        const result = await client.test(connection);
        const updated = recordIntegrationConnectionStatus(req.params.id, {
          status: "ok",
          error: null,
          summary: {
            product: result.product,
            version: result.version,
            ...result.summary,
          },
        });
        return { connection: updated, result };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Connection test failed.";
        const updated = recordIntegrationConnectionStatus(req.params.id, {
          status: "error",
          error: message,
        });
        return reply.status(502).send({ error: message, connection: updated });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/connections/:id/inventory",
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;

      const existing = getIntegrationConnectionRow(req.params.id);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabWrite(req, reply, String(existing.labId))) return;
      if (!existing.enabled) {
        return reply.status(409).send({
          error:
            "This connection is disabled. Enable it before pulling inventory.",
        });
      }

      const provider = String(existing.provider) as IntegrationProvider;
      const client = getIntegrationClient(provider);
      if (!client) {
        return reply.status(501).send({
          error: `The ${INTEGRATION_PROVIDER_INFO[provider].label} client is not available in this build.`,
        });
      }

      const body = req.body == null ? {} : asObject(req.body);
      const policy =
        (optionalEnum(body, "policy", SNMP_SYNC_POLICIES) as
          SnmpSyncPolicy | null | undefined) ?? "merge";

      const connection = loadIntegrationConnectionSecrets(req.params.id);
      if (!connection.authSecret) {
        return reply.status(400).send({
          error:
            "This connection has no stored secret. Enter the credential again before pulling inventory.",
        });
      }

      try {
        const inventory = await client.fetchInventory(connection);
        const preview = buildIntegrationNetworkPreview({
          connection,
          collection: inventory.collection,
          policy,
        });
        const previousSummary =
          parseIntegrationConnectionPublic(existing).lastSummary ?? {};
        const updated = recordIntegrationConnectionStatus(req.params.id, {
          status: "ok",
          error: null,
          summary: {
            ...previousSummary,
            devices: inventory.devices.length,
            vlans: inventory.collection.vlans.length,
            subnets: inventory.collection.subnets.length,
            dhcpScopes: inventory.collection.dhcpScopes.length,
          },
        });
        return {
          connection: updated,
          preview,
          devices: inventory.devices,
          warnings: inventory.warnings,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Inventory pull failed.";
        const updated = recordIntegrationConnectionStatus(req.params.id, {
          status: "error",
          error: message,
        });
        return reply.status(502).send({ error: message, connection: updated });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/connections/:id/apply",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const existing = getIntegrationConnectionRow(req.params.id);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabWrite(req, reply, String(existing.labId))) return;

      const body = asObject(req.body);
      const preview = body.preview as SnmpSyncPreview | undefined;
      if (!preview || typeof preview !== "object") {
        return reply
          .status(400)
          .send({ error: "Preview payload is required." });
      }
      if (
        String(preview.deviceId) !== req.params.id ||
        String(preview.labId) !== String(existing.labId)
      ) {
        return reply
          .status(400)
          .send({ error: "Preview does not match this connection." });
      }

      const policy =
        (optionalEnum(body, "policy", SNMP_SYNC_POLICIES) as
          SnmpSyncPolicy | null | undefined) ?? preview.policy;
      if (policy === "mirror" && preview.policy !== "mirror") {
        return reply
          .status(400)
          .send({ error: "Mirror apply requires a mirror preview." });
      }

      const allowDeletes = optionalBoolean(body, "allowDeletes") ?? false;
      if (
        policy === "mirror" &&
        !allowDeletes &&
        (preview.summary.vlanDeletes > 0 || preview.summary.subnetDeletes > 0)
      ) {
        return reply.status(400).send({
          error:
            "Mirror preview includes deletes. Re-run apply with allowDeletes=true to confirm.",
        });
      }

      const result = applyIntegrationNetworkPreview({
        preview: { ...preview, policy },
        allowDeletes,
        actor: req.authUser!.username,
      });
      return result;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/connections/:id/proxmox/nodes",
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;

      const existing = getIntegrationConnectionRow(req.params.id);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabWrite(req, reply, String(existing.labId))) return;
      if (String(existing.provider) !== "proxmox") {
        return reply
          .status(400)
          .send({ error: "This endpoint requires a Proxmox VE connection." });
      }

      const connection = loadIntegrationConnectionSecrets(req.params.id);
      if (!connection.authSecret) {
        return reply.status(400).send({
          error:
            "This connection has no stored secret. Enter the credential again first.",
        });
      }

      try {
        return { nodes: await fetchProxmoxNodes(connection) };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Node listing failed.";
        recordIntegrationConnectionStatus(req.params.id, {
          status: "error",
          error: message,
        });
        return reply.status(502).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/connections/:id/proxmox/staged-inventory",
    async (req, reply) => {
      if (!requireAuth(req, reply)) return;

      const existing = getIntegrationConnectionRow(req.params.id);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabWrite(req, reply, String(existing.labId))) return;
      if (String(existing.provider) !== "proxmox") {
        return reply
          .status(400)
          .send({ error: "This endpoint requires a Proxmox VE connection." });
      }
      if (!existing.enabled) {
        return reply.status(409).send({
          error:
            "This connection is disabled. Enable it before pulling inventory.",
        });
      }

      const body = req.body == null ? {} : asObject(req.body);
      const node = optionalString(body, "node", { maxLength: 120 }) ?? null;

      const connection = loadIntegrationConnectionSecrets(req.params.id);
      if (!connection.authSecret) {
        return reply.status(400).send({
          error:
            "This connection has no stored secret. Enter the credential again first.",
        });
      }

      try {
        const payload = await fetchProxmoxStagedInventory(connection, node);
        const previousSummary =
          parseIntegrationConnectionPublic(existing).lastSummary ?? {};
        recordIntegrationConnectionStatus(req.params.id, {
          status: "ok",
          error: null,
          summary: {
            ...previousSummary,
            stagedNode: payload.summary.node,
            workloads: payload.summary.workloads,
          },
        });
        return payload;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Inventory staging failed.";
        recordIntegrationConnectionStatus(req.params.id, {
          status: "error",
          error: message,
        });
        return reply.status(502).send({ error: message });
      }
    },
  );
};
