import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { writeAuditLogEntry } from "../lib/audit-log.js";
import {
  getPhysicalHardwareTemplate,
  getPhysicalLayoutDevice,
  getPhysicalLayoutPorts,
  listPhysicalHardwareTemplates,
  parseDevicePhysicalLayoutRow,
  readDevicePhysicalLayout,
  type DevicePhysicalLayoutRow,
  type PhysicalLayoutDeviceRow,
} from "../lib/device-physical-layout.js";
import {
  deviceTypeMatches,
  requiredDeviceType,
} from "../lib/device-types.js";
import { createId } from "../lib/ids.js";
import {
  appendLabFilter,
  assertGlobalAdmin,
  assertLabReadFromRow,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from "../lib/lab-access.js";
import {
  buildAutoPhysicalLayout,
  isReservedHardwareTemplateId,
  portSetFingerprint,
  proposePhysicalPortBindings,
  resolveTemplateSnapshot,
  validateHardwareTemplateV1,
  validateResolvedPhysicalLayoutV1,
  type HardwareTemplateV1,
  type PhysicalLayoutStatus,
  type PortBindingV1,
  type ResolvedPhysicalLayoutV1,
} from "../lib/physical-layout.js";
import {
  asObject,
  optionalStringArray,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

type LayoutRow = DevicePhysicalLayoutRow;
type DeviceRow = PhysicalLayoutDeviceRow;

const getDevice = getPhysicalLayoutDevice;
const getDevicePorts = getPhysicalLayoutPorts;

function getLinkedPortIds(deviceId: string) {
  const rows = db
    .prepare(
      `
        SELECT links.fromPortId AS portId
        FROM portLinks links
        JOIN ports ON ports.id = links.fromPortId
        WHERE ports.deviceId = ?
        UNION
        SELECT links.toPortId AS portId
        FROM portLinks links
        JOIN ports ON ports.id = links.toPortId
        WHERE ports.deviceId = ?
      `,
    )
    .all(deviceId, deviceId) as Array<{ portId: string }>;
  return new Set(rows.map((row) => row.portId));
}

const parseLayoutRow = parseDevicePhysicalLayoutRow;

function assertTemplateDeviceTypes(template: HardwareTemplateV1) {
  for (const deviceType of template.deviceTypes) {
    requiredDeviceType({ deviceType });
  }
}

function assertTemplateSupportsDeviceType(
  template: HardwareTemplateV1,
  deviceType: string,
) {
  if (!deviceTypeMatches(deviceType, template.deviceTypes)) {
    throw new ValidationError(
      `Hardware template ${template.name} does not support device type ${deviceType}.`,
    );
  }
}

function assertTemplateDefaultAssignments(template: HardwareTemplateV1) {
  const assignedDeviceTypes = (
    db
      .prepare(
        "SELECT deviceType FROM hardwareTemplateDefaults WHERE templateId = ?",
      )
      .all(template.id) as Array<{ deviceType: string }>
  ).map((row) => row.deviceType);
  for (const deviceType of assignedDeviceTypes) {
    assertTemplateSupportsDeviceType(template, deviceType);
  }
}

function getHardwareTemplate(templateId: string) {
  return getPhysicalHardwareTemplate(templateId);
}

function proposedBindings(
  snapshot: ResolvedPhysicalLayoutV1,
  ports: Parameters<typeof proposePhysicalPortBindings>[1],
  requested?: PortBindingV1[],
) {
  return proposePhysicalPortBindings(snapshot, ports, requested);
}

function parseRequestedBindings(value: unknown): PortBindingV1[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 500) {
    throw new ValidationError(
      "bindings must be an array with at most 500 entries.",
    );
  }
  return value.map((entry) => {
    const binding = asObject(entry);
    return {
      portId: requiredString(binding, "portId", { maxLength: 120 }),
      slotId: requiredString(binding, "slotId", { maxLength: 120 }),
    };
  });
}

function buildPreview(device: DeviceRow, body: Record<string, unknown>) {
  const ports = getDevicePorts(device.id);
  const customSnapshot = body.customSnapshot;
  const moduleIds =
    optionalStringArray(body, "moduleIds", { maxItems: 64 }) ?? [];
  const templateId = customSnapshot
    ? "device-custom-v1"
    : requiredString(body, "templateId", { maxLength: 120 });
  let snapshot: ResolvedPhysicalLayoutV1;
  if (customSnapshot) {
    const validated = validateResolvedPhysicalLayoutV1(customSnapshot);
    snapshot = {
      ...validated,
      sourceTemplateId: "device-custom-v1",
    };
  } else {
    const template = getHardwareTemplate(templateId);
    if (!template)
      throw new ValidationError("Selected hardware template does not exist.");
    assertTemplateSupportsDeviceType(template, device.deviceType);
    const autoMode =
      template.id === "legacy-auto-v1"
        ? "legacy"
        : template.id === "generic-auto-v1"
          ? "generic"
          : null;
    if (autoMode && moduleIds.length > 0) {
      throw new ValidationError(
        "Compatibility layouts do not support hardware modules.",
      );
    }
    snapshot = autoMode
      ? buildAutoPhysicalLayout(device, ports, autoMode).snapshot
      : resolveTemplateSnapshot(template, device, moduleIds);
  }
  const current = readDevicePhysicalLayout(device, ports);
  const preserveBindings =
    body.preserveBindings === true || Boolean(customSnapshot);
  const requestedBindings = parseRequestedBindings(body.bindings);
  const preservedBindings = preserveBindings
    ? current.bindings.filter((binding) =>
        snapshot.portSlots.some((slot) => slot.id === binding.slotId),
      )
    : undefined;
  const mapping = proposedBindings(
    snapshot,
    ports,
    requestedBindings ?? preservedBindings,
  );
  const boundSlotIds = new Set(
    mapping.bindings.map((binding) => binding.slotId),
  );
  const nextPosition =
    (
      db
        .prepare("SELECT MAX(position) AS maxPosition FROM ports WHERE deviceId = ?")
        .get(device.id) as { maxPosition: number | null }
    ).maxPosition ?? 0;
  const portsToCreate = snapshot.portSlots
    .filter((slot) => !boundSlotIds.has(slot.id))
    .map((slot, index) => ({
      slotId: slot.id,
      name: slot.label ?? `Port ${nextPosition + index}`,
      position: nextPosition + index + 1,
      kind: slot.acceptedPortKinds[0] ?? slot.connector,
      face: slot.face,
    }));

  const previousSlotIds = new Set(
    current.snapshot.portSlots.map((slot) => slot.id),
  );
  const nextSlotIds = new Set(snapshot.portSlots.map((slot) => slot.id));
  const linkedPortIds = getLinkedPortIds(device.id);
  const linkedUnmappedPortIds = mapping.unmappedPortIds.filter((portId) =>
    linkedPortIds.has(portId),
  );

  return {
    deviceId: device.id,
    templateId,
    snapshot,
    bindings: mapping.bindings,
    unmappedPortIds: mapping.unmappedPortIds,
    conflicts: mapping.conflicts,
    linkedUnmappedPortIds,
    portsToCreate,
    portFingerprint: portSetFingerprint(ports),
    moduleIds: snapshot.moduleIds ?? [],
    preserveBindings,
    comparison: {
      preservedBindingCount: mapping.bindings.filter((binding) =>
        current.bindings.some(
          (existing) =>
            existing.portId === binding.portId &&
            existing.slotId === binding.slotId,
        ),
      ).length,
      addedSlotIds: [...nextSlotIds].filter(
        (slotId) => !previousSlotIds.has(slotId),
      ),
      removedSlotIds: [...previousSlotIds].filter(
        (slotId) => !nextSlotIds.has(slotId),
      ),
    },
  };
}

export const hardwareTemplatesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => {
    const defaults = db
      .prepare(
        "SELECT deviceType, templateId, updatedAt FROM hardwareTemplateDefaults ORDER BY deviceType",
      )
      .all();
    return { templates: listPhysicalHardwareTemplates(), defaults };
  });

  app.post("/", async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return;
    const template = validateHardwareTemplateV1(req.body);
    assertTemplateDeviceTypes(template);
    if (isReservedHardwareTemplateId(template.id)) {
      throw new ValidationError(
        "Built-in hardware template IDs are reserved.",
        409,
      );
    }
    const now = new Date().toISOString();
    const create = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO hardwareTemplates
            (id, name, description, category, deviceTypes, definition, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        template.id,
        template.name,
        template.description,
        template.category,
        JSON.stringify(template.deviceTypes),
        JSON.stringify(template),
        now,
        now,
      );
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "hardware-template.create",
        entityType: "HardwareTemplate",
        entityId: template.id,
        summary: `Created hardware template ${template.name}`,
      });
    });
    create();
    return reply.status(201).send(template);
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return;
    if (isReservedHardwareTemplateId(req.params.id)) {
      return reply
        .status(403)
        .send({ error: "Built-in hardware templates cannot be modified." });
    }
    const existing = db
      .prepare("SELECT id FROM hardwareTemplates WHERE id = ?")
      .get(req.params.id);
    if (!existing)
      return reply.status(404).send({ error: "Hardware template not found." });
    const template = validateHardwareTemplateV1({
      ...asObject(req.body),
      id: req.params.id,
    });
    assertTemplateDeviceTypes(template);
    assertTemplateDefaultAssignments(template);
    const now = new Date().toISOString();
    const update = db.transaction(() => {
      db.prepare(
        `
          UPDATE hardwareTemplates
          SET name = ?, description = ?, category = ?, deviceTypes = ?, definition = ?, updatedAt = ?
          WHERE id = ?
        `,
      ).run(
        template.name,
        template.description,
        template.category,
        JSON.stringify(template.deviceTypes),
        JSON.stringify(template),
        now,
        req.params.id,
      );
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "hardware-template.update",
        entityType: "HardwareTemplate",
        entityId: template.id,
        summary: `Updated hardware template ${template.name}`,
      });
    });
    update();
    return template;
  });

  app.post<{ Params: { id: string } }>("/:id/duplicate", async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return;
    const source = getHardwareTemplate(req.params.id);
    if (!source)
      return reply.status(404).send({ error: "Hardware template not found." });
    const body = asObject(req.body);
    const id = requiredString(body, "id", { maxLength: 120 });
    const name = requiredString(body, "name", { maxLength: 120 });
    const duplicate = validateHardwareTemplateV1({
      ...source,
      id,
      name,
      builtIn: undefined,
    });
    assertTemplateDeviceTypes(duplicate);
    if (isReservedHardwareTemplateId(duplicate.id)) {
      throw new ValidationError(
        "Built-in hardware template IDs are reserved.",
        409,
      );
    }
    const now = new Date().toISOString();
    const createDuplicate = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO hardwareTemplates
            (id, name, description, category, deviceTypes, definition, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        duplicate.id,
        duplicate.name,
        duplicate.description,
        duplicate.category,
        JSON.stringify(duplicate.deviceTypes),
        JSON.stringify(duplicate),
        now,
        now,
      );
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "hardware-template.duplicate",
        entityType: "HardwareTemplate",
        entityId: duplicate.id,
        summary: `Duplicated hardware template ${source.name} as ${duplicate.name}`,
      });
    });
    createDuplicate();
    return reply.status(201).send(duplicate);
  });

  app.put<{ Params: { deviceType: string } }>(
    "/defaults/:deviceType",
    async (req, reply) => {
      if (!assertGlobalAdmin(req, reply)) return;
      const body = asObject(req.body);
      const templateId = requiredString(body, "templateId", { maxLength: 120 });
      const template = getHardwareTemplate(templateId);
      if (!template) {
        throw new ValidationError("Selected hardware template does not exist.");
      }
      const deviceType = requiredDeviceType({
        deviceType: req.params.deviceType,
      });
      assertTemplateSupportsDeviceType(template, deviceType);
      const now = new Date().toISOString();
      const assignDefault = db.transaction(() => {
        db.prepare(
          `
          INSERT INTO hardwareTemplateDefaults (deviceType, templateId, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(deviceType) DO UPDATE SET templateId = excluded.templateId, updatedAt = excluded.updatedAt
        `,
        ).run(deviceType, templateId, now);
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "hardware-template.default.assign",
          entityType: "DeviceType",
          entityId: deviceType,
          summary: `Assigned hardware template ${template.name} as the default for ${deviceType}`,
        });
      });
      assignDefault();
      return { deviceType, templateId, updatedAt: now };
    },
  );

  app.delete<{ Params: { deviceType: string } }>(
    "/defaults/:deviceType",
    async (req, reply) => {
      if (!assertGlobalAdmin(req, reply)) return;
      const deviceType = requiredDeviceType({
        deviceType: req.params.deviceType,
      });
      const result = db
        .prepare("DELETE FROM hardwareTemplateDefaults WHERE deviceType = ?")
        .run(deviceType);
      if (result.changes > 0) {
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "hardware-template.default.remove",
          entityType: "DeviceType",
          entityId: deviceType,
          summary: `Removed the hardware template override for ${deviceType}`,
        });
      }
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return;
    if (isReservedHardwareTemplateId(req.params.id)) {
      return reply
        .status(403)
        .send({ error: "Built-in hardware templates cannot be deleted." });
    }
    const remove = db.transaction(() => {
      db.prepare(
        "DELETE FROM hardwareTemplateDefaults WHERE templateId = ?",
      ).run(req.params.id);
      const result = db
        .prepare("DELETE FROM hardwareTemplates WHERE id = ?")
        .run(req.params.id);
      if (result.changes > 0) {
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "hardware-template.delete",
          entityType: "HardwareTemplate",
          entityId: req.params.id,
          summary: `Deleted hardware template ${req.params.id}`,
        });
      }
      return result;
    });
    const result = remove();
    if (result.changes === 0)
      return reply.status(404).send({ error: "Hardware template not found." });
    return reply.status(204).send();
  });
};

export const physicalLayoutsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string; deviceId?: string } }>(
    "/",
    async (req, reply) => {
      if (!req.authUser)
        return reply.status(401).send({ error: "Authentication required." });
      const filter = resolveLabIdsForList(
        req.authUser,
        req.labAccess ?? [],
        req.query.labId,
      );
      if (!filter.ok)
        return reply.status(filter.status).send({ error: filter.error });
      let sql =
        "SELECT id, labId, deviceType, heightU, rackSlot, placement FROM devices WHERE 1=1";
      const params: unknown[] = [];
      if (req.query.deviceId) {
        sql += " AND id = ?";
        params.push(req.query.deviceId);
      }
      const filtered = appendLabFilter(sql, params, filter.labIds);
      const devices = db
        .prepare(`${filtered.sql} ORDER BY id`)
        .all(...filtered.params) as DeviceRow[];
      return devices.map((device) => {
        const ports = getDevicePorts(device.id);
        return readDevicePhysicalLayout(device, ports);
      });
    },
  );

  app.get<{ Params: { deviceId: string } }>(
    "/:deviceId",
    async (req, reply) => {
      const device = getDevice(req.params.deviceId);
      if (
        !assertLabReadFromRow(
          req,
          reply,
          device as unknown as Record<string, unknown> | undefined,
        )
      )
        return;
      const ports = getDevicePorts(device!.id);
      return readDevicePhysicalLayout(device!, ports);
    },
  );

  app.post("/bulk-preview", async (req, reply) => {
    const body = asObject(req.body);
    const deviceIds = optionalStringArray(body, "deviceIds", { maxItems: 200 });
    if (!deviceIds || deviceIds.length === 0) {
      throw new ValidationError("deviceIds must contain at least one device.");
    }
    const uniqueDeviceIds = [...new Set(deviceIds)];
    const devices = uniqueDeviceIds.map((deviceId) => getDevice(deviceId));
    for (const device of devices) {
      if (
        !assertLabWriteFromRow(
          req,
          reply,
          device as unknown as Record<string, unknown> | undefined,
        )
      ) {
        return;
      }
    }
    return {
      previews: devices.map((device) =>
        buildPreview(device!, { ...body, preserveBindings: true }),
      ),
    };
  });

  app.post("/bulk-apply", async (req, reply) => {
    const body = asObject(req.body);
    if (
      !Array.isArray(body.previews) ||
      body.previews.length === 0 ||
      body.previews.length > 200
    ) {
      throw new ValidationError(
        "previews must contain between 1 and 200 layout previews.",
      );
    }
    const requested = body.previews.map((entry) => asObject(entry));
    const deviceIds = requested.map((entry) =>
      requiredString(entry, "deviceId", { maxLength: 120 }),
    );
    if (new Set(deviceIds).size !== deviceIds.length) {
      throw new ValidationError(
        "Bulk physical layout previews cannot repeat a device.",
      );
    }
    const devices = deviceIds.map((deviceId) => getDevice(deviceId));
    for (const device of devices) {
      if (
        !assertLabWriteFromRow(
          req,
          reply,
          device as unknown as Record<string, unknown> | undefined,
        )
      ) {
        return;
      }
    }
    const previews = requested.map((entry, index) => {
      const device = devices[index]!;
      const expectedFingerprint = requiredString(entry, "portFingerprint", {
        maxLength: 128,
      });
      const currentFingerprint = portSetFingerprint(getDevicePorts(device.id));
      if (currentFingerprint !== expectedFingerprint) {
        throw new ValidationError(
          `The port set for device ${device.id} changed after preview.`,
          409,
          "PHYSICAL_LAYOUT_STALE_PREVIEW",
        );
      }
      const preview = buildPreview(device, {
        ...entry,
        preserveBindings: true,
      });
      if (preview.conflicts.length > 0) {
        throw new ValidationError(
          `Physical layout for device ${device.id} contains invalid port bindings.`,
          422,
          "PHYSICAL_LAYOUT_BINDING_INVALID",
          { conflicts: preview.conflicts },
        );
      }
      if (preview.linkedUnmappedPortIds.length > 0) {
        throw new ValidationError(
          `Physical layout for device ${device.id} would unmap a linked port.`,
          422,
          "PHYSICAL_LAYOUT_LINKED_PORT_UNMAPPED",
          { portIds: preview.linkedUnmappedPortIds },
        );
      }
      return preview;
    });
    const now = new Date().toISOString();
    const applyBulk = db.transaction(() => {
      const write = db.prepare(
        `
          INSERT INTO devicePhysicalLayouts
            (deviceId, sourceTemplateId, status, snapshot, bindings, portFingerprint, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(deviceId) DO UPDATE SET
            sourceTemplateId = excluded.sourceTemplateId,
            status = excluded.status,
            snapshot = excluded.snapshot,
            bindings = excluded.bindings,
            portFingerprint = excluded.portFingerprint,
            updatedAt = excluded.updatedAt
        `,
      );
      for (const preview of previews) {
        const sourceDefault =
          preview.templateId === "legacy-auto-v1" ||
          preview.templateId === "generic-auto-v1";
        const status: PhysicalLayoutStatus =
          preview.unmappedPortIds.length > 0
            ? "needs-mapping"
            : sourceDefault
              ? preview.templateId === "legacy-auto-v1"
                ? "legacy-default"
                : "generic-default"
              : "accurate";
        write.run(
          preview.deviceId,
          preview.templateId,
          status,
          JSON.stringify(preview.snapshot),
          JSON.stringify(preview.bindings),
          preview.portFingerprint,
          now,
          now,
        );
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "physical-layout.bulk.apply",
          entityType: "Device",
          entityId: preview.deviceId,
          summary: `Applied physical layout ${preview.templateId} in a bulk assignment`,
        });
      }
    });
    applyBulk();
    return {
      updated: previews.length,
      layouts: devices.map((device) => {
        const ports = getDevicePorts(device!.id);
        const row = db
          .prepare("SELECT * FROM devicePhysicalLayouts WHERE deviceId = ?")
          .get(device!.id) as LayoutRow;
        return parseLayoutRow(row, ports);
      }),
    };
  });

  app.post<{ Params: { deviceId: string } }>(
    "/:deviceId/preview",
    async (req, reply) => {
      const device = getDevice(req.params.deviceId);
      if (
        !assertLabWriteFromRow(
          req,
          reply,
          device as unknown as Record<string, unknown> | undefined,
        )
      )
        return;
      return buildPreview(device!, asObject(req.body));
    },
  );

  app.post<{ Params: { deviceId: string } }>(
    "/:deviceId/apply",
    async (req, reply) => {
      const device = getDevice(req.params.deviceId);
      if (
        !assertLabWriteFromRow(
          req,
          reply,
          device as unknown as Record<string, unknown> | undefined,
        )
      )
        return;
      const body = asObject(req.body);
      const expectedFingerprint = requiredString(body, "portFingerprint", {
        maxLength: 128,
      });
      const ports = getDevicePorts(device!.id);
      const currentFingerprint = portSetFingerprint(ports);
      if (currentFingerprint !== expectedFingerprint) {
        return reply.status(409).send({
          error:
            "The device port set changed after this layout preview. Preview the layout again.",
          code: "PHYSICAL_LAYOUT_STALE_PREVIEW",
        });
      }
      const preview = buildPreview(device!, body);
      if (preview.conflicts.length > 0) {
        throw new ValidationError(
          "Physical layout contains invalid port bindings.",
          422,
          "PHYSICAL_LAYOUT_BINDING_INVALID",
          {
            conflicts: preview.conflicts,
          },
        );
      }
      if (preview.linkedUnmappedPortIds.length > 0) {
        throw new ValidationError(
          "Physical layout would unmap an existing linked port.",
          422,
          "PHYSICAL_LAYOUT_LINKED_PORT_UNMAPPED",
          { portIds: preview.linkedUnmappedPortIds },
        );
      }
      const approvedPortSlotIds = new Set(
        optionalStringArray(body, "approvedPortSlotIds", { maxItems: 500 }) ??
          [],
      );
      const portProposalBySlotId = new Map(
        preview.portsToCreate.map((proposal) => [proposal.slotId, proposal]),
      );
      for (const slotId of approvedPortSlotIds) {
        if (!portProposalBySlotId.has(slotId)) {
          throw new ValidationError(
            `Approved physical port slot ${slotId} is not part of this preview.`,
          );
        }
      }
      const sourceDefault =
        preview.templateId === "legacy-auto-v1" ||
        preview.templateId === "generic-auto-v1";
      const finalBindings = [...preview.bindings];
      const createdPortIds: string[] = [];
      const status: PhysicalLayoutStatus =
        preview.unmappedPortIds.length > 0
          ? "needs-mapping"
          : sourceDefault
            ? preview.templateId === "legacy-auto-v1"
              ? "legacy-default"
              : "generic-default"
            : "accurate";
      const now = new Date().toISOString();
      const apply = db.transaction(() => {
        const insertPort = db.prepare(
          `
          INSERT INTO ports
            (id, deviceId, name, position, kind, linkState, mode, face, portRole)
          VALUES (?, ?, ?, ?, ?, 'down', 'access', ?, 'physical')
        `,
        );
        let nextCreatedPortPosition =
          (
            db
              .prepare(
                "SELECT MAX(position) AS maxPosition FROM ports WHERE deviceId = ?",
              )
              .get(device!.id) as { maxPosition: number | null }
          ).maxPosition ?? 0;
        for (const slotId of approvedPortSlotIds) {
          const proposal = portProposalBySlotId.get(slotId)!;
          const portId = createId("p");
          nextCreatedPortPosition += 1;
          insertPort.run(
            portId,
            device!.id,
            proposal.name,
            nextCreatedPortPosition,
            proposal.kind,
            proposal.face,
          );
          finalBindings.push({ portId, slotId });
          createdPortIds.push(portId);
        }
        const finalPorts = getDevicePorts(device!.id);
        const finalFingerprint = portSetFingerprint(finalPorts);
        db.prepare(
          `
          INSERT INTO devicePhysicalLayouts
            (deviceId, sourceTemplateId, status, snapshot, bindings, portFingerprint, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(deviceId) DO UPDATE SET
            sourceTemplateId = excluded.sourceTemplateId,
            status = excluded.status,
            snapshot = excluded.snapshot,
            bindings = excluded.bindings,
            portFingerprint = excluded.portFingerprint,
            updatedAt = excluded.updatedAt
        `,
        ).run(
          device!.id,
          preview.templateId,
          status,
          JSON.stringify(preview.snapshot),
          JSON.stringify(finalBindings),
          finalFingerprint,
          now,
          now,
        );
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "physical-layout.apply",
          entityType: "Device",
          entityId: device!.id,
          summary: `Applied physical layout ${preview.templateId} with ${finalBindings.length} port binding(s) and ${createdPortIds.length} approved new port(s)`,
        });
      });
      apply();
      const finalPorts = getDevicePorts(device!.id);
      const row = db
        .prepare("SELECT * FROM devicePhysicalLayouts WHERE deviceId = ?")
        .get(device!.id) as LayoutRow;
      return {
        ...parseLayoutRow(row, finalPorts),
        createdPortIds,
      };
    },
  );
};
