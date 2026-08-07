import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { writeAuditLogEntry } from "../lib/audit-log.js";
import { requiredDeviceType } from "../lib/device-types.js";
import { createId } from "../lib/ids.js";
import {
  appendLabFilter,
  assertGlobalAdmin,
  assertLabWrite,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from "../lib/lab-access.js";
import {
  assertTemplateCompatible,
  BUILT_IN_DRIVE_BAY_TEMPLATES,
  createDriveSlotsFromTemplate,
  DRIVE_FORM_FACTORS,
  DRIVE_INTERFACES,
  DRIVE_SLOT_FACES,
  DRIVE_SLOT_LAYOUTS,
  DRIVE_SLOT_TYPES,
  getDriveBayTemplate,
  insertDriveSlots,
  listDriveBayTemplates,
  normalizeDriveBayTemplateSections,
  STORAGE_POOL_STATUSES,
  STORAGE_POOL_TYPES,
} from "../lib/storage.js";
import {
  asObject,
  optionalEnum,
  optionalInteger,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requiredEnum,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

type LabRow = { id: string; labId: string };
type DeviceRow = LabRow & { deviceType: string; hostname: string };
type DriveRow = LabRow & {
  manufacturer: string | null;
  model: string | null;
  serial: string | null;
  capacityGb: number;
  interface: string;
  formFactor: string;
  notes: string | null;
};
type PoolRow = {
  id: string;
  deviceId: string;
  labId: string;
  name: string;
  poolType: string;
  usableCapacityGb: number;
  status: string;
  notes: string | null;
};

function getDevice(deviceId: string) {
  return db
    .prepare("SELECT id, labId, deviceType, hostname FROM devices WHERE id = ?")
    .get(deviceId) as DeviceRow | undefined;
}

function getDrive(driveId: string) {
  return db.prepare("SELECT * FROM storageDrives WHERE id = ?").get(driveId) as
    DriveRow | undefined;
}

function getPool(poolId: string) {
  return db
    .prepare(
      `
    SELECT storagePools.*, devices.labId
    FROM storagePools
    JOIN devices ON devices.id = storagePools.deviceId
    WHERE storagePools.id = ?
  `,
    )
    .get(poolId) as PoolRow | undefined;
}

function parseTemplateDeviceTypes(body: Record<string, unknown>) {
  const values = optionalStringArray(body, "deviceTypes", { maxItems: 64 });
  if (!values?.length) {
    throw new ValidationError(
      "deviceTypes must contain at least one device type.",
    );
  }
  return [
    ...new Set(values.map((deviceType) => requiredDeviceType({ deviceType }))),
  ];
}

function assertUniqueTemplateName(name: string, excludingId?: string) {
  const conflict = listDriveBayTemplates().find(
    (template) =>
      template.id !== excludingId &&
      template.name.toLowerCase() === name.toLowerCase(),
  );
  if (conflict)
    throw new ValidationError(
      "That drive-bay template name already exists.",
      409,
    );
}

function requiredCapacity(body: Record<string, unknown>, key: string) {
  const value = optionalNumber(body, key, { min: 0, max: 1024 * 1024 * 10 });
  if (value == null) throw new ValidationError(`${key} is required.`);
  return value;
}

function storageDriveLabel(drive: {
  id: string;
  manufacturer?: string | null;
  model?: string | null;
  serial?: string | null;
}) {
  return (
    [drive.manufacturer, drive.model].filter(Boolean).join(" ") ||
    drive.serial ||
    drive.id
  );
}

function resolveSlot(slotId: string, labId: string, driveId?: string) {
  const slot = db
    .prepare(
      `
    SELECT driveSlots.*, devices.labId, devices.hostname
    FROM driveSlots
    JOIN devices ON devices.id = driveSlots.deviceId
    WHERE driveSlots.id = ?
  `,
    )
    .get(slotId) as
    | (Record<string, unknown> & { labId: string; driveId?: string | null })
    | undefined;
  if (!slot)
    throw new ValidationError("Selected drive slot does not exist.", 404);
  if (slot.labId !== labId) {
    throw new ValidationError(
      "Selected drive slot must belong to the same lab.",
    );
  }
  if (slot.driveId && slot.driveId !== driveId) {
    throw new ValidationError("Selected drive slot is already occupied.", 409);
  }
  return slot;
}

function moveDriveToSlot(driveId: string, slotId: string | null, now: string) {
  db.prepare(
    "UPDATE driveSlots SET driveId = NULL, updatedAt = ? WHERE driveId = ?",
  ).run(now, driveId);
  if (slotId) {
    db.prepare(
      "UPDATE driveSlots SET driveId = ?, updatedAt = ? WHERE id = ?",
    ).run(driveId, now, slotId);
  }
}

function parseDriveResult<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    slotId: row.slotId ?? null,
    deviceId: row.deviceId ?? null,
    deviceHostname: row.deviceHostname ?? null,
    slotName: row.slotName ?? null,
    slotSectionName: row.slotSectionName ?? null,
    poolId: row.poolId ?? null,
    poolName: row.poolName ?? null,
  };
}

function listDrivesSql() {
  return `
    SELECT storageDrives.*,
           driveSlots.id AS slotId,
           driveSlots.deviceId AS deviceId,
           devices.hostname AS deviceHostname,
           driveSlots.name AS slotName,
           driveSlots.sectionName AS slotSectionName,
           storagePoolDrives.poolId AS poolId,
           storagePools.name AS poolName
    FROM storageDrives
    LEFT JOIN driveSlots ON driveSlots.driveId = storageDrives.id
    LEFT JOIN devices ON devices.id = driveSlots.deviceId
    LEFT JOIN storagePoolDrives ON storagePoolDrives.driveId = storageDrives.id
    LEFT JOIN storagePools ON storagePools.id = storagePoolDrives.poolId
    WHERE 1=1
  `;
}

function getDriveResult(driveId: string) {
  const row = db
    .prepare(`${listDrivesSql()} AND storageDrives.id = ?`)
    .get(driveId) as (DriveRow & Record<string, unknown>) | undefined;
  if (!row) throw new ValidationError("Storage drive not found.", 404);
  return parseDriveResult(row);
}

function normalizeDriveIds(body: Record<string, unknown>) {
  if (!("driveIds" in body)) return undefined;
  return [
    ...new Set(optionalStringArray(body, "driveIds", { maxItems: 500 }) ?? []),
  ];
}

function validatePoolMembers(input: {
  poolId?: string;
  labId: string;
  driveIds: string[];
}) {
  for (const driveId of input.driveIds) {
    const drive = db
      .prepare(
        `
      SELECT storageDrives.id, storageDrives.labId, driveSlots.id AS slotId,
             storagePoolDrives.poolId
      FROM storageDrives
      LEFT JOIN driveSlots ON driveSlots.driveId = storageDrives.id
      LEFT JOIN storagePoolDrives ON storagePoolDrives.driveId = storageDrives.id
      WHERE storageDrives.id = ?
    `,
      )
      .get(driveId) as
      | {
          id: string;
          labId: string;
          slotId: string | null;
          poolId: string | null;
        }
      | undefined;
    if (!drive) throw new ValidationError(`Drive ${driveId} does not exist.`);
    if (drive.labId !== input.labId) {
      throw new ValidationError(
        "Pool drives must belong to the same lab as the pool owner.",
      );
    }
    if (!drive.slotId && drive.poolId !== input.poolId) {
      throw new ValidationError(
        "New pool members must be installed in a drive slot.",
      );
    }
    if (drive.poolId && drive.poolId !== input.poolId) {
      throw new ValidationError(
        "A drive can belong to only one storage pool.",
        409,
      );
    }
  }
}

function replacePoolMembers(poolId: string, driveIds: string[], now: string) {
  db.prepare("DELETE FROM storagePoolDrives WHERE poolId = ?").run(poolId);
  const insert = db.prepare(
    "INSERT INTO storagePoolDrives (poolId, driveId, createdAt) VALUES (?, ?, ?)",
  );
  for (const driveId of driveIds) insert.run(poolId, driveId, now);
}

function listPoolsWithMembers(rows: PoolRow[]) {
  if (rows.length === 0) return [];
  const memberships = db
    .prepare(
      `
    SELECT poolId, driveId
    FROM storagePoolDrives
    WHERE poolId IN (${rows.map(() => "?").join(", ")})
    ORDER BY createdAt, driveId
  `,
    )
    .all(...rows.map((row) => row.id)) as Array<{
    poolId: string;
    driveId: string;
  }>;
  const byPool = new Map<string, string[]>();
  for (const membership of memberships) {
    const entries = byPool.get(membership.poolId) ?? [];
    entries.push(membership.driveId);
    byPool.set(membership.poolId, entries);
  }
  return rows.map((row) => ({ ...row, driveIds: byPool.get(row.id) ?? [] }));
}

export const storageRoutes: FastifyPluginAsync = async (app) => {
  app.get("/drive-bay-templates", async () => listDriveBayTemplates());

  app.post("/drive-bay-templates", async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return;
    const body = asObject(req.body);
    const id = optionalString(body, "id", { maxLength: 80 }) ?? createId("dbt");
    if (BUILT_IN_DRIVE_BAY_TEMPLATES.some((template) => template.id === id)) {
      throw new ValidationError("That drive-bay template ID is built in.", 409);
    }
    const name = requiredString(body, "name", { maxLength: 120 });
    assertUniqueTemplateName(name);
    const description = requiredString(body, "description", { maxLength: 500 });
    const deviceTypes = parseTemplateDeviceTypes(body);
    const sections = normalizeDriveBayTemplateSections(body.sections);
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `
        INSERT INTO driveBayTemplates
          (id, name, description, deviceTypes, sections, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        name,
        description,
        JSON.stringify(deviceTypes),
        JSON.stringify(sections),
        now,
        now,
      );
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "storage.template.create",
        entityType: "DriveBayTemplate",
        entityId: id,
        summary: `Added drive-bay template ${name}`,
      });
    })();
    return reply.status(201).send(getDriveBayTemplate(id));
  });

  app.patch<{ Params: { id: string } }>(
    "/drive-bay-templates/:id",
    async (req, reply) => {
      if (!assertGlobalAdmin(req, reply)) return;
      if (
        BUILT_IN_DRIVE_BAY_TEMPLATES.some(
          (template) => template.id === req.params.id,
        )
      ) {
        return reply
          .status(403)
          .send({ error: "Built-in drive-bay templates cannot be modified." });
      }
      const existing = db
        .prepare("SELECT * FROM driveBayTemplates WHERE id = ?")
        .get(req.params.id);
      if (!existing)
        return reply
          .status(404)
          .send({ error: "Drive-bay template not found." });
      const body = asObject(req.body);
      const updates: string[] = [];
      const values: unknown[] = [];
      const name = optionalString(body, "name", { maxLength: 120 });
      if (name !== undefined) {
        if (!name) throw new ValidationError("name cannot be empty.");
        assertUniqueTemplateName(name, req.params.id);
        updates.push("name = ?");
        values.push(name);
      }
      const description = optionalString(body, "description", {
        maxLength: 500,
      });
      if (description !== undefined) {
        if (!description)
          throw new ValidationError("description cannot be empty.");
        updates.push("description = ?");
        values.push(description);
      }
      if ("deviceTypes" in body) {
        updates.push("deviceTypes = ?");
        values.push(JSON.stringify(parseTemplateDeviceTypes(body)));
      }
      if ("sections" in body) {
        updates.push("sections = ?");
        values.push(
          JSON.stringify(normalizeDriveBayTemplateSections(body.sections)),
        );
      }
      if (updates.length === 0)
        throw new ValidationError("No valid fields to update.");
      updates.push("updatedAt = ?");
      values.push(new Date().toISOString(), req.params.id);
      const nextName = name ?? String((existing as { name: string }).name);
      db.transaction(() => {
        db.prepare(
          `UPDATE driveBayTemplates SET ${updates.join(", ")} WHERE id = ?`,
        ).run(...values);
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "storage.template.update",
          entityType: "DriveBayTemplate",
          entityId: req.params.id,
          summary: `Updated drive-bay template ${nextName}`,
        });
      })();
      return getDriveBayTemplate(req.params.id);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/drive-bay-templates/:id",
    async (req, reply) => {
      if (!assertGlobalAdmin(req, reply)) return;
      if (
        BUILT_IN_DRIVE_BAY_TEMPLATES.some(
          (template) => template.id === req.params.id,
        )
      ) {
        return reply
          .status(403)
          .send({ error: "Built-in drive-bay templates cannot be deleted." });
      }
      const existing = db
        .prepare("SELECT name FROM driveBayTemplates WHERE id = ?")
        .get(req.params.id) as { name: string } | undefined;
      if (!existing)
        return reply
          .status(404)
          .send({ error: "Drive-bay template not found." });
      db.transaction(() => {
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "storage.template.delete",
          entityType: "DriveBayTemplate",
          entityId: req.params.id,
          summary: `Deleted drive-bay template ${existing.name}`,
        });
        db.prepare("DELETE FROM driveBayTemplates WHERE id = ?").run(
          req.params.id,
        );
      })();
      return reply.status(204).send();
    },
  );

  app.get<{ Querystring: { labId?: string; deviceId?: string } }>(
    "/drive-slots",
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
      let sql = `
      SELECT driveSlots.*
      FROM driveSlots
      JOIN devices ON devices.id = driveSlots.deviceId
      WHERE 1=1
    `;
      const params: unknown[] = [];
      if (req.query.deviceId) {
        sql += " AND driveSlots.deviceId = ?";
        params.push(req.query.deviceId);
      }
      const filtered = appendLabFilter(
        sql,
        params,
        filter.labIds,
        "devices.labId",
      );
      return db
        .prepare(
          `${filtered.sql} ORDER BY driveSlots.deviceId, driveSlots.sectionOrder, driveSlots.position, driveSlots.id`,
        )
        .all(...filtered.params);
    },
  );

  app.post("/drive-slots/apply-template", async (req, reply) => {
    const body = asObject(req.body);
    const deviceId = requiredString(body, "deviceId", { maxLength: 80 });
    const templateId = requiredString(body, "templateId", { maxLength: 80 });
    const device = getDevice(deviceId);
    if (!device) return reply.status(404).send({ error: "Device not found." });
    if (!assertLabWrite(req, reply, device.labId)) return;
    const template = getDriveBayTemplate(templateId);
    if (!template)
      throw new ValidationError("Selected drive-bay template does not exist.");
    assertTemplateCompatible(template, device.deviceType);
    const count = db
      .prepare("SELECT COUNT(*) AS count FROM driveSlots WHERE deviceId = ?")
      .get(deviceId) as { count: number };
    if (count.count > 0) {
      return reply.status(409).send({
        error:
          "Drive-bay templates can only be applied to devices without slots.",
      });
    }
    const slots = createDriveSlotsFromTemplate(deviceId, templateId);
    db.transaction(() => {
      insertDriveSlots(slots);
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "storage.template.apply",
        entityType: "Device",
        entityId: deviceId,
        summary: `Applied a ${slots.length}-slot drive-bay template to ${device.hostname}`,
      });
    })();
    return reply.status(201).send(slots);
  });

  app.post("/drive-slots", async (req, reply) => {
    const body = asObject(req.body);
    const deviceId = requiredString(body, "deviceId", { maxLength: 80 });
    const device = getDevice(deviceId);
    if (!device) return reply.status(404).send({ error: "Device not found." });
    if (!assertLabWrite(req, reply, device.labId)) return;
    const name = requiredString(body, "name", { maxLength: 80 });
    const sectionName =
      optionalString(body, "sectionName", { maxLength: 80 }) ?? "Drive bays";
    const sectionOrder =
      optionalInteger(body, "sectionOrder", { min: 0, max: 100 }) ?? 0;
    const row = db
      .prepare(
        "SELECT MAX(position) AS maxPosition FROM driveSlots WHERE deviceId = ? AND sectionName = ?",
      )
      .get(deviceId, sectionName) as { maxPosition?: number | null };
    const position =
      optionalInteger(body, "position", { min: 1, max: 1000 }) ??
      (row.maxPosition ?? 0) + 1;
    const slotType =
      optionalEnum(body, "slotType", DRIVE_SLOT_TYPES) ?? "generic";
    const face = optionalEnum(body, "face", DRIVE_SLOT_FACES) ?? "front";
    const layout = optionalEnum(body, "layout", DRIVE_SLOT_LAYOUTS) ?? "grid";
    const columns =
      layout === "grid"
        ? (optionalInteger(body, "columns", { min: 1, max: 24 }) ?? 4)
        : null;
    const id = createId("ds");
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `
        INSERT INTO driveSlots
          (id, deviceId, name, sectionName, sectionOrder, position, slotType, face, layout, columns, driveId, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `,
      ).run(
        id,
        deviceId,
        name,
        sectionName,
        sectionOrder,
        position,
        slotType,
        face,
        layout,
        columns,
        now,
        now,
      );
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "storage.slot.create",
        entityType: "DriveSlot",
        entityId: id,
        summary: `Added drive slot ${name}`,
      });
    })();
    return reply
      .status(201)
      .send(db.prepare("SELECT * FROM driveSlots WHERE id = ?").get(id));
  });

  app.patch<{ Params: { id: string } }>(
    "/drive-slots/:id",
    async (req, reply) => {
      const existing = db
        .prepare(
          `
      SELECT driveSlots.*, devices.labId
      FROM driveSlots
      JOIN devices ON devices.id = driveSlots.deviceId
      WHERE driveSlots.id = ?
    `,
        )
        .get(req.params.id) as Record<string, unknown> | undefined;
      if (!assertLabWriteFromRow(req, reply, existing)) return;
      const body = asObject(req.body);
      const updates: string[] = [];
      const values: unknown[] = [];
      const strings = [
        ["name", 80],
        ["sectionName", 80],
      ] as const;
      for (const [key, maxLength] of strings) {
        const value = optionalString(body, key, { maxLength });
        if (value !== undefined) {
          if (!value) throw new ValidationError(`${key} cannot be empty.`);
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }
      const nextName =
        optionalString(body, "name", { maxLength: 80 }) ??
        String(existing!.name);
      const integers = [
        ["sectionOrder", 0, 100],
        ["position", 1, 1000],
      ] as const;
      for (const [key, min, max] of integers) {
        const value = optionalInteger(body, key, { min, max });
        if (value !== undefined) {
          if (value == null)
            throw new ValidationError(`${key} cannot be empty.`);
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }
      if ("slotType" in body) {
        updates.push("slotType = ?");
        values.push(requiredEnum(body, "slotType", DRIVE_SLOT_TYPES));
      }
      if ("face" in body) {
        updates.push("face = ?");
        values.push(requiredEnum(body, "face", DRIVE_SLOT_FACES));
      }
      if ("layout" in body) {
        updates.push("layout = ?");
        values.push(requiredEnum(body, "layout", DRIVE_SLOT_LAYOUTS));
      }
      if ("columns" in body) {
        updates.push("columns = ?");
        values.push(optionalInteger(body, "columns", { min: 1, max: 24 }));
      }
      if (updates.length === 0)
        throw new ValidationError("No valid fields to update.");
      updates.push("updatedAt = ?");
      values.push(new Date().toISOString(), req.params.id);
      db.transaction(() => {
        db.prepare(
          `UPDATE driveSlots SET ${updates.join(", ")} WHERE id = ?`,
        ).run(...values);
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "storage.slot.update",
          entityType: "DriveSlot",
          entityId: req.params.id,
          summary: `Updated drive slot ${nextName}`,
        });
      })();
      return db
        .prepare("SELECT * FROM driveSlots WHERE id = ?")
        .get(req.params.id);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/drive-slots/:id",
    async (req, reply) => {
      const slot = db
        .prepare(
          `
      SELECT driveSlots.*, devices.labId
      FROM driveSlots
      JOIN devices ON devices.id = driveSlots.deviceId
      WHERE driveSlots.id = ?
    `,
        )
        .get(req.params.id) as Record<string, unknown> | undefined;
      if (!assertLabWriteFromRow(req, reply, slot)) return;
      if (slot?.driveId) {
        return reply.status(409).send({
          error: "Remove the installed drive before deleting this slot.",
        });
      }
      db.transaction(() => {
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "storage.slot.delete",
          entityType: "DriveSlot",
          entityId: req.params.id,
          summary: `Deleted drive slot ${String(slot!.name)}`,
        });
        db.prepare("DELETE FROM driveSlots WHERE id = ?").run(req.params.id);
      })();
      return reply.status(204).send();
    },
  );

  app.get<{ Querystring: { labId?: string; deviceId?: string } }>(
    "/drives",
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
      let sql = listDrivesSql();
      const params: unknown[] = [];
      if (req.query.deviceId) {
        sql += " AND driveSlots.deviceId = ?";
        params.push(req.query.deviceId);
      }
      const filtered = appendLabFilter(
        sql,
        params,
        filter.labIds,
        "storageDrives.labId",
      );
      const rows = db
        .prepare(
          `${filtered.sql} ORDER BY storageDrives.manufacturer, storageDrives.model, storageDrives.serial, storageDrives.id`,
        )
        .all(...filtered.params) as Record<string, unknown>[];
      return rows.map(parseDriveResult);
    },
  );

  app.post("/drives", async (req, reply) => {
    const body = asObject(req.body);
    const labId = requiredString(body, "labId", { maxLength: 80 });
    if (!assertLabWrite(req, reply, labId)) return;
    const manufacturer = optionalString(body, "manufacturer", {
      maxLength: 120,
    });
    const model = optionalString(body, "model", { maxLength: 120 });
    const serial = optionalString(body, "serial", { maxLength: 160 });
    const capacityGb = requiredCapacity(body, "capacityGb");
    const driveInterface = requiredEnum(body, "interface", DRIVE_INTERFACES);
    const formFactor = requiredEnum(body, "formFactor", DRIVE_FORM_FACTORS);
    const notes = optionalString(body, "notes", { maxLength: 2000 });
    const slotId = optionalString(body, "slotId", { maxLength: 80 });
    if (slotId) resolveSlot(slotId, labId);
    const id = createId("drv");
    const now = new Date().toISOString();
    const created = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO storageDrives
          (id, labId, manufacturer, model, serial, capacityGb, interface, formFactor, notes, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        labId,
        manufacturer ?? null,
        model ?? null,
        serial ?? null,
        capacityGb,
        driveInterface,
        formFactor,
        notes ?? null,
        now,
        now,
      );
      moveDriveToSlot(id, slotId ?? null, now);
      const result = getDriveResult(id);
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "storage.drive.create",
        entityType: "StorageDrive",
        entityId: id,
        summary: `Added drive ${storageDriveLabel(result)}`,
      });
      return result;
    })();
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { id: string } }>("/drives/:id", async (req, reply) => {
    const existing = getDrive(req.params.id);
    if (!assertLabWriteFromRow(req, reply, existing)) return;
    const body = asObject(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const [key, maxLength] of [
      ["manufacturer", 120],
      ["model", 120],
      ["serial", 160],
      ["notes", 2000],
    ] as const) {
      const value = optionalString(body, key, { maxLength });
      if (value !== undefined) {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }
    if ("capacityGb" in body) {
      updates.push("capacityGb = ?");
      values.push(requiredCapacity(body, "capacityGb"));
    }
    if ("interface" in body) {
      updates.push("interface = ?");
      values.push(requiredEnum(body, "interface", DRIVE_INTERFACES));
    }
    if ("formFactor" in body) {
      updates.push("formFactor = ?");
      values.push(requiredEnum(body, "formFactor", DRIVE_FORM_FACTORS));
    }
    const slotId = optionalString(body, "slotId", { maxLength: 80 });
    if (slotId) resolveSlot(slotId, existing!.labId, req.params.id);
    if (updates.length === 0 && !("slotId" in body)) {
      throw new ValidationError("No valid fields to update.");
    }
    const now = new Date().toISOString();
    const updated = db.transaction(() => {
      if (updates.length > 0) {
        updates.push("updatedAt = ?");
        values.push(now, req.params.id);
        db.prepare(
          `UPDATE storageDrives SET ${updates.join(", ")} WHERE id = ?`,
        ).run(...values);
      }
      if ("slotId" in body) moveDriveToSlot(req.params.id, slotId ?? null, now);
      const result = getDriveResult(req.params.id);
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "storage.drive.update",
        entityType: "StorageDrive",
        entityId: req.params.id,
        summary: `Updated drive ${storageDriveLabel(result)}`,
      });
      return result;
    })();
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/drives/:id", async (req, reply) => {
    const existing = getDrive(req.params.id);
    if (!assertLabWriteFromRow(req, reply, existing)) return;
    const membership = db
      .prepare("SELECT poolId FROM storagePoolDrives WHERE driveId = ?")
      .get(req.params.id);
    if (membership) {
      return reply.status(409).send({
        error: "Remove this drive from its storage pool before deleting it.",
      });
    }
    db.transaction(() => {
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "storage.drive.delete",
        entityType: "StorageDrive",
        entityId: req.params.id,
        summary: `Deleted drive ${storageDriveLabel(existing!)}`,
      });
      db.prepare("DELETE FROM storageDrives WHERE id = ?").run(req.params.id);
    })();
    return reply.status(204).send();
  });

  app.get<{ Querystring: { labId?: string; deviceId?: string } }>(
    "/pools",
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
      let sql = `
      SELECT storagePools.*, devices.labId
      FROM storagePools
      JOIN devices ON devices.id = storagePools.deviceId
      WHERE 1=1
    `;
      const params: unknown[] = [];
      if (req.query.deviceId) {
        sql += " AND storagePools.deviceId = ?";
        params.push(req.query.deviceId);
      }
      const filtered = appendLabFilter(
        sql,
        params,
        filter.labIds,
        "devices.labId",
      );
      const rows = db
        .prepare(
          `${filtered.sql} ORDER BY devices.hostname, storagePools.name, storagePools.id`,
        )
        .all(...filtered.params) as PoolRow[];
      return listPoolsWithMembers(rows);
    },
  );

  app.post("/pools", async (req, reply) => {
    const body = asObject(req.body);
    const deviceId = requiredString(body, "deviceId", { maxLength: 80 });
    const device = getDevice(deviceId);
    if (!device) return reply.status(404).send({ error: "Device not found." });
    if (!assertLabWrite(req, reply, device.labId)) return;
    const name = requiredString(body, "name", { maxLength: 120 });
    const poolType = requiredEnum(body, "poolType", STORAGE_POOL_TYPES);
    const usableCapacityGb = requiredCapacity(body, "usableCapacityGb");
    const status = requiredEnum(body, "status", STORAGE_POOL_STATUSES);
    const notes = optionalString(body, "notes", { maxLength: 2000 });
    const driveIds = normalizeDriveIds(body) ?? [];
    validatePoolMembers({ labId: device.labId, driveIds });
    const id = createId("sp");
    const now = new Date().toISOString();
    const created = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO storagePools
          (id, deviceId, name, poolType, usableCapacityGb, status, notes, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        deviceId,
        name,
        poolType,
        usableCapacityGb,
        status,
        notes ?? null,
        now,
        now,
      );
      replacePoolMembers(id, driveIds, now);
      const result = listPoolsWithMembers([getPool(id)!])[0];
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "storage.pool.create",
        entityType: "StoragePool",
        entityId: id,
        summary: `Added storage pool ${name}`,
      });
      return result;
    })();
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { id: string } }>("/pools/:id", async (req, reply) => {
    const existing = getPool(req.params.id);
    if (!assertLabWriteFromRow(req, reply, existing)) return;
    const body = asObject(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];
    const name = optionalString(body, "name", { maxLength: 120 });
    if (name !== undefined) {
      if (!name) throw new ValidationError("name cannot be empty.");
      updates.push("name = ?");
      values.push(name);
    }
    if ("poolType" in body) {
      updates.push("poolType = ?");
      values.push(requiredEnum(body, "poolType", STORAGE_POOL_TYPES));
    }
    if ("usableCapacityGb" in body) {
      updates.push("usableCapacityGb = ?");
      values.push(requiredCapacity(body, "usableCapacityGb"));
    }
    if ("status" in body) {
      updates.push("status = ?");
      values.push(requiredEnum(body, "status", STORAGE_POOL_STATUSES));
    }
    const notes = optionalString(body, "notes", { maxLength: 2000 });
    if (notes !== undefined) {
      updates.push("notes = ?");
      values.push(notes);
    }
    const driveIds = normalizeDriveIds(body);
    if (driveIds !== undefined) {
      validatePoolMembers({
        poolId: req.params.id,
        labId: existing!.labId,
        driveIds,
      });
    }
    if (updates.length === 0 && driveIds === undefined) {
      throw new ValidationError("No valid fields to update.");
    }
    const now = new Date().toISOString();
    const updated = db.transaction(() => {
      if (updates.length > 0) {
        updates.push("updatedAt = ?");
        values.push(now, req.params.id);
        db.prepare(
          `UPDATE storagePools SET ${updates.join(", ")} WHERE id = ?`,
        ).run(...values);
      }
      if (driveIds !== undefined)
        replacePoolMembers(req.params.id, driveIds, now);
      const result = listPoolsWithMembers([getPool(req.params.id)!])[0];
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "storage.pool.update",
        entityType: "StoragePool",
        entityId: req.params.id,
        summary: `Updated storage pool ${name ?? existing!.name}`,
      });
      return result;
    })();
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/pools/:id", async (req, reply) => {
    const existing = getPool(req.params.id);
    if (!assertLabWriteFromRow(req, reply, existing)) return;
    db.transaction(() => {
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "storage.pool.delete",
        entityType: "StoragePool",
        entityId: req.params.id,
        summary: `Deleted storage pool ${existing!.name}`,
      });
      db.prepare("DELETE FROM storagePools WHERE id = ?").run(req.params.id);
    })();
    return reply.status(204).send();
  });
};
