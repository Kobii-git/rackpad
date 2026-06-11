import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { assertLabWrite } from "../lib/lab-access.js";
import {
  buildNetboxDeviceDraft,
  buildNetboxPortTemplateDraft,
  findExistingNetboxDevice,
  findExistingNetboxTemplate,
  parseNetBoxDeviceTypeYaml,
  previewNetboxDeviceTypeImport,
} from "../lib/netbox-device-type.js";
import { createId } from "../lib/ids.js";
import { listPortTemplates } from "../lib/port-templates.js";
import {
  asObject,
  optionalEnum,
  optionalString,
  requiredString,
} from "../lib/validation.js";

const NETBOX_IMPORT_MODES = ["template", "device"] as const;

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
    const mode = optionalEnum(body, "mode", NETBOX_IMPORT_MODES) ?? "template";
    const parsed = parseNetBoxDeviceTypeYaml(yaml);
    const draft = buildNetboxPortTemplateDraft(parsed);

    if (mode === "template") {
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
      return reply.status(201).send({ mode: "template", template: created });
    }

    const labId = requiredString(body, "labId", { maxLength: 80 });
    const hostname = requiredString(body, "hostname", { maxLength: 120 });
    if (!assertLabWrite(req, reply, labId)) return;

    const existingDevice = findExistingNetboxDevice(
      parsed.manufacturer,
      parsed.model,
    );
    if (existingDevice) {
      return reply.status(409).send({
        error: `A device already exists for ${parsed.manufacturer} ${parsed.model}.`,
        existingDevice,
      });
    }

    const hostnameTaken = db
      .prepare("SELECT id FROM devices WHERE labId = ? AND hostname = ?")
      .get(labId, hostname) as { id: string } | undefined;
    if (hostnameTaken) {
      return reply.status(409).send({
        error: `Hostname ${hostname} is already used in this lab.`,
      });
    }

    const deviceDraft = buildNetboxDeviceDraft(parsed);
    const deviceId = createId("d");
    const now = new Date().toISOString();

    const insertDevice = db.prepare(`
      INSERT INTO devices
        (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
         serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId,
         cpuCores, memoryGb, storageGb, specs, startU, heightU, face, tags, notes, lastSeen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const insertPort = db.prepare(`
      INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId, macAddress)
      VALUES (@id, @deviceId, @name, @position, @kind, @speed, @linkState, @mode, @vlanId, @allowedVlanIds, @description, @face, @virtualSwitchId, @macAddress)
    `);

    const createDevice = db.transaction(() => {
      insertDevice.run(
        deviceId,
        labId,
        null,
        hostname,
        deviceDraft.displayName,
        deviceDraft.deviceType,
        deviceDraft.manufacturer,
        deviceDraft.model,
        null,
        null,
        null,
        "unknown",
        deviceDraft.placement,
        null,
        "normal",
        null,
        null,
        null,
        null,
        null,
        null,
        deviceDraft.heightU,
        null,
        null,
        deviceDraft.notes,
        null,
      );

      for (const port of draft.ports) {
        insertPort.run({
          id: createId("p"),
          deviceId,
          name: port.name,
          position: port.position,
          kind: port.kind,
          speed: port.speed ?? null,
          linkState: "down",
          mode: port.mode ?? "access",
          vlanId: null,
          allowedVlanIds: null,
          description: null,
          face: port.face ?? "front",
          virtualSwitchId: null,
          macAddress: null,
        });
      }
    });

    createDevice();

    const device = db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(deviceId);
    const ports = db
      .prepare("SELECT * FROM ports WHERE deviceId = ? ORDER BY position, name")
      .all(deviceId);

    return reply.status(201).send({ mode: "device", device, ports });
  });

  app.post("/docker/preview", async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: "Authentication required." });
    }

    const body = asObject(req.body);
    const endpoint = requiredString(body, "endpoint", { maxLength: 500 });
    const token = optionalString(body, "token", { maxLength: 500 });
    const { fetchDockerContainersPreview } = await import(
      "../lib/docker-import.js"
    );
    const containers = await fetchDockerContainersPreview(endpoint, token ?? undefined);
    return { containers };
  });

  app.post("/docker/import", async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: "Authentication required." });
    }

    const body = asObject(req.body);
    const endpoint = requiredString(body, "endpoint", { maxLength: 500 });
    const token = optionalString(body, "token", { maxLength: 500 });
    const containerId = requiredString(body, "containerId", { maxLength: 120 });
    const labId = requiredString(body, "labId", { maxLength: 80 });
    const hostDeviceId = requiredString(body, "hostDeviceId", { maxLength: 80 });
    const hostnameOverride = optionalString(body, "hostname", { maxLength: 120 });

    if (!assertLabWrite(req, reply, labId)) return;

    const host = db
      .prepare("SELECT id, labId FROM devices WHERE id = ?")
      .get(hostDeviceId) as { id: string; labId: string } | undefined;
    if (!host || host.labId !== labId) {
      return reply.status(404).send({ error: "Host device not found in lab." });
    }

    const {
      fetchDockerContainersPreview,
      buildDockerContainerNotes,
      buildDockerContainerSpecs,
    } = await import("../lib/docker-import.js");
    const containers = await fetchDockerContainersPreview(endpoint, token ?? undefined);
    const container = containers.find((entry) => entry.id === containerId);
    if (!container) {
      return reply.status(404).send({ error: "Container not found in preview." });
    }

    const hostname = hostnameOverride ?? container.name.slice(0, 120);
    const existing = db
      .prepare("SELECT id FROM devices WHERE labId = ? AND hostname = ?")
      .get(labId, hostname) as { id: string } | undefined;
    if (existing) {
      return reply.status(409).send({
        error: `Hostname ${hostname} is already used in this lab.`,
      });
    }

    const deviceId = createId("d");
    db.prepare(
      `
      INSERT INTO devices
        (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
         serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId,
         cpuCores, memoryGb, storageGb, specs, startU, heightU, face, tags, notes, lastSeen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `,
    ).run(
      deviceId,
      labId,
      null,
      hostname,
      container.name,
      "container",
      null,
      null,
      null,
      null,
      null,
      container.state === "running" ? "online" : "offline",
      "virtual",
      hostDeviceId,
      "normal",
      null,
      null,
      null,
      null,
      buildDockerContainerSpecs(container),
      null,
      1,
      null,
      null,
      buildDockerContainerNotes(container, endpoint),
      new Date().toISOString(),
    );

    const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
    return reply.status(201).send(device);
  });
};
