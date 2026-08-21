import type { FastifyPluginAsync, FastifyReply } from "fastify";
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
import { isValidCronExpression } from "../lib/integrations/cron.js";
import {
  runIntegrationSyncSchedule,
  withIntegrationSyncLock,
} from "../lib/integrations/auto-sync.js";
import {
  createIntegrationSyncSchedule,
  deleteIntegrationSyncSchedule,
  getIntegrationSyncScheduleRow,
  listIntegrationSyncSchedules,
  parseIntegrationSyncSchedule,
  updateIntegrationSyncSchedule,
} from "../lib/integrations/schedules.js";
import {
  applyIntegrationDeviceSync,
  buildIntegrationDeviceSyncPlan,
  filterImportableDevicesForConnection,
  sanitizeImportableDevices,
  sanitizeVirtualSwitches,
  sanitizeWifiInventory,
} from "../lib/integrations/device-sync.js";
import type {
  IntegrationImportableDevice,
  IntegrationVirtualSwitchSpec,
  IntegrationWifiInventory,
} from "../lib/integrations/inventory.js";
import {
  consumeIntegrationPreviewToken,
  integrationPreviewConnectionRevision,
  issueIntegrationPreviewToken,
} from "../lib/integrations/preview-tokens.js";
import {
  INTEGRATION_AUTH_KINDS,
  INTEGRATION_AUTO_SYNC_MODES,
  INTEGRATION_PROVIDER_INFO,
  INTEGRATION_PROVIDERS,
  type IntegrationAuthKind,
  type IntegrationProvider,
} from "../lib/integrations/types.js";
import type { SnmpSyncPreview } from "../lib/snmp-profiles/types.js";
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

interface IntegrationDeviceSnapshot {
  importableDevices: IntegrationImportableDevice[];
  wifi: IntegrationWifiInventory | null;
  virtualSwitches: IntegrationVirtualSwitchSpec[];
}

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
      syncSwitches: optionalBoolean(body, "syncSwitches") ?? true,
      syncGateways: optionalBoolean(body, "syncGateways") ?? true,
      syncAccessPoints: optionalBoolean(body, "syncAccessPoints") ?? true,
      syncHosts: optionalBoolean(body, "syncHosts") ?? true,
      syncGuests: optionalBoolean(body, "syncGuests") ?? true,
      syncWifi: optionalBoolean(body, "syncWifi") ?? true,
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
        syncSwitches: true,
        syncGateways: true,
        syncAccessPoints: true,
        syncHosts: true,
        syncGuests: true,
        syncWifi: true,
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
        syncSwitches: optionalBoolean(body, "syncSwitches") ?? undefined,
        syncGateways: optionalBoolean(body, "syncGateways") ?? undefined,
        syncAccessPoints:
          optionalBoolean(body, "syncAccessPoints") ?? undefined,
        syncHosts: optionalBoolean(body, "syncHosts") ?? undefined,
        syncGuests: optionalBoolean(body, "syncGuests") ?? undefined,
        syncWifi: optionalBoolean(body, "syncWifi") ?? undefined,
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
      if (body.mode === "mirror" || body.policy === "mirror") {
        return reply.status(400).send({
          error:
            "Mirror mode is disabled until controller-owned records have durable provenance.",
        });
      }
      const mode =
        optionalEnum(body, "mode", INTEGRATION_AUTO_SYNC_MODES) ?? "merge";
      const policy = mode === "merge" ? "merge" : "mirror";

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
        const sanitizationWarnings: string[] = [];
        const importableDevices = filterImportableDevicesForConnection(
          connection,
          sanitizeImportableDevices(
            inventory.importableDevices ?? [],
            sanitizationWarnings,
          ),
        );
        const wifi = connection.syncWifi
          ? sanitizeWifiInventory(
              inventory.wifi ?? null,
              sanitizationWarnings,
            )
          : null;
        const virtualSwitches = sanitizeVirtualSwitches(
          inventory.virtualSwitches ?? [],
        );
        const deviceSync = buildIntegrationDeviceSyncPlan({
          labId: connection.labId,
          importableDevices,
          wifi,
          virtualSwitches,
        });
        const tokenScope = {
          actorId: req.authUser!.id,
          connectionId: req.params.id,
          labId: String(existing.labId),
          connectionRevision: integrationPreviewConnectionRevision(existing),
        };
        const networkToken = issueIntegrationPreviewToken(
          "network-preview",
          tokenScope,
          preview,
        );
        const deviceToken = issueIntegrationPreviewToken<IntegrationDeviceSnapshot>(
          "device-snapshot",
          tokenScope,
          { importableDevices, wifi, virtualSwitches },
        );
        return {
          connection: updated,
          preview,
          mode,
          networkPreviewToken: networkToken.token,
          networkPreviewExpiresAt: networkToken.expiresAt,
          deviceSnapshotToken: deviceToken.token,
          deviceSnapshotExpiresAt: deviceToken.expiresAt,
          devices: inventory.devices,
          deviceSync,
          importableDevices,
          virtualSwitches,
          wifi,
          warnings: [...inventory.warnings, ...sanitizationWarnings],
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
      if (!existing.enabled) {
        return reply.status(409).send({
          error: "This connection is disabled. Enable it before applying a preview.",
        });
      }

      const body = asObject(req.body);
      const token = requiredString(body, "previewToken", { maxLength: 200 });
      return withIntegrationSyncLock(req.params.id, () => {
        const preview = consumeIntegrationPreviewToken<SnmpSyncPreview>(
          token,
          "network-preview",
          {
            actorId: req.authUser!.id,
            connectionId: req.params.id,
            labId: String(existing.labId),
            connectionRevision: integrationPreviewConnectionRevision(existing),
          },
        );
        return applyIntegrationNetworkPreview({
          preview,
          allowDeletes: false,
          actor: req.authUser!.username,
        });
      });
    },
  );

  function scheduleConnection(
    scheduleRow: Record<string, unknown> | undefined,
  ) {
    if (!scheduleRow) return null;
    return getIntegrationConnectionRow(String(scheduleRow.connectionId));
  }

  function validateScheduleInput(
    reply: FastifyReply,
    cron: string | null | undefined,
    labIds: string[] | null | undefined,
  ) {
    if (cron != null && !isValidCronExpression(cron)) {
      reply.status(400).send({
        error:
          "cron is not a valid five-field cron expression (minute hour day-of-month month day-of-week).",
      });
      return false;
    }
    if (labIds) {
      for (const labId of labIds) {
        const lab = db.prepare("SELECT id FROM labs WHERE id = ?").get(labId);
        if (!lab) {
          reply
            .status(422)
            .send({ error: `Target lab ${labId} does not exist.` });
          return false;
        }
      }
    }
    return true;
  }

  app.get("/schedules", async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const query = req.query as { connectionId?: string };
    if (query.connectionId) {
      const connection = getIntegrationConnectionRow(query.connectionId);
      if (!connection) {
        return reply
          .status(404)
          .send({ error: "Integration connection not found." });
      }
      if (!assertLabRead(req, reply, String(connection.labId))) return;
      return listIntegrationSyncSchedules(query.connectionId);
    }
    // Filter to connections the caller can read.
    const readable = new Set(
      listIntegrationConnections()
        .filter((connection) =>
          req.authUser?.role === "admin"
            ? true
            : (req.labAccess ?? []).some(
                (entry) => entry.labId === connection.labId,
              ),
        )
        .map((connection) => connection.id),
    );
    return listIntegrationSyncSchedules().filter((schedule) =>
      readable.has(schedule.connectionId),
    );
  });

  // Multiple schedules per connection can use different cadences, safe modes,
  // and target labs.
  app.post("/schedules", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = asObject(req.body);
    const connectionId = requiredString(body, "connectionId", {
      maxLength: 80,
    });
    const connection = getIntegrationConnectionRow(connectionId);
    if (!connection) {
      return reply
        .status(404)
        .send({ error: "Integration connection not found." });
    }
    if (!assertLabWrite(req, reply, String(connection.labId))) return;

    const cron = requiredString(body, "cron", { maxLength: 120 });
    const labIds = optionalStringArray(body, "labIds", { maxItems: 50 }) ?? [];
    if (!validateScheduleInput(reply, cron, labIds)) return;

    const created = createIntegrationSyncSchedule({
      connectionId,
      name: requiredString(body, "name", { maxLength: 120 }),
      enabled: optionalBoolean(body, "enabled") ?? true,
      mode: optionalEnum(body, "mode", INTEGRATION_AUTO_SYNC_MODES) ?? "merge",
      cron,
      labIds,
    });
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { id: string } }>(
    "/schedules/:id",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const existing = getIntegrationSyncScheduleRow(req.params.id);
      const connection = scheduleConnection(existing);
      if (!existing || !connection) {
        return reply.status(404).send({ error: "Sync schedule not found." });
      }
      if (!assertLabWrite(req, reply, String(connection.labId))) return;

      const body = asObject(req.body);
      const cron = optionalString(body, "cron", { maxLength: 120 });
      const labIds = optionalStringArray(body, "labIds", { maxItems: 50 });
      if (!validateScheduleInput(reply, cron, labIds ?? undefined)) return;

      return updateIntegrationSyncSchedule(req.params.id, {
        name: optionalString(body, "name", { maxLength: 120 }) ?? undefined,
        enabled: optionalBoolean(body, "enabled") ?? undefined,
        mode:
          optionalEnum(body, "mode", INTEGRATION_AUTO_SYNC_MODES) ?? undefined,
        cron: cron ?? undefined,
        labIds: labIds ?? undefined,
      });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/schedules/:id",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const existing = getIntegrationSyncScheduleRow(req.params.id);
      const connection = scheduleConnection(existing);
      if (!existing || !connection) {
        return reply.status(404).send({ error: "Sync schedule not found." });
      }
      if (!assertLabWrite(req, reply, String(connection.labId))) return;
      deleteIntegrationSyncSchedule(req.params.id);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/schedules/:id/run",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const existing = getIntegrationSyncScheduleRow(req.params.id);
      const connection = scheduleConnection(existing);
      if (!existing || !connection) {
        return reply.status(404).send({ error: "Sync schedule not found." });
      }
      if (!assertLabWrite(req, reply, String(connection.labId))) return;
      if (!connection.enabled) {
        return reply.status(409).send({
          error:
            "This connection is disabled. Enable it before running auto-sync.",
        });
      }
      const result = await runIntegrationSyncSchedule(req.params.id);
      const schedule = getIntegrationSyncScheduleRow(req.params.id);
      return {
        result,
        schedule: schedule ? parseIntegrationSyncSchedule(schedule) : null,
      };
    },
  );

  // Imports the previewed controller devices (with their ports) and WiFi
  // inventory as real records. Merge-only: existing devices and SSIDs are
  // matched and never modified.
  app.post<{ Params: { id: string } }>(
    "/connections/:id/apply-devices",
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
          error: "This connection is disabled. Enable it before importing inventory.",
        });
      }

      const body = asObject(req.body);
      const token = requiredString(body, "snapshotToken", { maxLength: 200 });
      const selectedIds = optionalStringArray(
        body,
        "selectedProviderRecordIds",
        { maxItems: 1000 },
      );
      if (selectedIds === undefined) {
        throw new ValidationError("Selected Provider Record IDs is required.");
      }
      return withIntegrationSyncLock(req.params.id, () => {
        const snapshot =
          consumeIntegrationPreviewToken<IntegrationDeviceSnapshot>(
            token,
            "device-snapshot",
            {
              actorId: req.authUser!.id,
              connectionId: req.params.id,
              labId: String(existing.labId),
              connectionRevision:
                integrationPreviewConnectionRevision(existing),
            },
          );
        const selected = new Set(selectedIds ?? []);
        const available = new Set([
          ...snapshot.importableDevices.flatMap((device) =>
            device.providerRecordId ? [device.providerRecordId] : [],
          ),
          ...snapshot.virtualSwitches.flatMap((virtualSwitch) =>
            virtualSwitch.providerRecordId
              ? [virtualSwitch.providerRecordId]
              : [],
          ),
          ...(snapshot.wifi?.ssids.flatMap((ssid) =>
            ssid.providerRecordId ? [ssid.providerRecordId] : [],
          ) ?? []),
        ]);
        for (const selectedId of selected) {
          if (!available.has(selectedId)) {
            throw new ValidationError(
              "A selected provider record does not belong to this inventory snapshot.",
            );
          }
        }
        const importableDevices = snapshot.importableDevices.filter(
          (device) =>
            Boolean(
              device.providerRecordId && selected.has(device.providerRecordId),
            ),
        );
        const virtualSwitches = snapshot.virtualSwitches.filter(
          (virtualSwitch) =>
            Boolean(
              virtualSwitch.providerRecordId &&
                selected.has(virtualSwitch.providerRecordId),
            ),
        );
        const selectedSsids =
          snapshot.wifi?.ssids.filter((ssid) =>
            Boolean(ssid.providerRecordId && selected.has(ssid.providerRecordId)),
          ) ?? [];
        const wifi =
          snapshot.wifi &&
          (selectedSsids.length > 0 ||
            importableDevices.some((device) => device.deviceType === "ap"))
            ? { ...snapshot.wifi, ssids: selectedSsids }
            : null;
        if (
          importableDevices.length === 0 &&
          !wifi &&
          virtualSwitches.length === 0
        ) {
          throw new ValidationError("There is nothing to import.");
        }

        const provider = String(existing.provider) as IntegrationProvider;
        return applyIntegrationDeviceSync({
          labId: String(existing.labId),
          importableDevices,
          wifi,
          virtualSwitches,
          vendor: INTEGRATION_PROVIDER_INFO[provider].vendor,
          actor: req.authUser!.username,
        });
      });
    },
  );
};
