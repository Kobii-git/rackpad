import type { FastifyPluginAsync } from "fastify";
import { db, parseRow } from "../db.js";
import { requiredDeviceType } from "../lib/device-types.js";
import {
  applyWifiDiscoveryPlacementToDevice,
  upsertWifiClientAssociation,
} from "../lib/discovery-placement.js";
import {
  appendLabFilter,
  assertLabReadFromRow,
  assertLabWrite,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from "../lib/lab-access.js";
import { createId } from "../lib/ids.js";
import {
  createPortsFromTemplate,
  getPortTemplate,
} from "../lib/port-templates.js";
import { validateRackPlacement } from "../lib/rack-placement.js";
import {
  asObject,
  ensureIpv4,
  ensureIsoDate,
  optionalEnum,
  optionalInteger,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requiredEnum,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

const DEVICE_STATUSES = [
  "online",
  "offline",
  "warning",
  "unknown",
  "maintenance",
] as const;
const DEVICE_PLACEMENTS = [
  "rack",
  "room",
  "wireless",
  "virtual",
  "shelf",
] as const;
const DEVICE_FACES = ["front", "rear"] as const;
const DEVICE_RACK_SLOTS = ["full", "left", "right"] as const;
const DEVICE_NETWORK_MODES = ["normal", "host-shared"] as const;
const JSON_COLS = ["tags"] as const;

function parseDevice(row: Record<string, unknown>) {
  return parseRow(row, [...JSON_COLS]);
}

function derivePlacement(input: {
  deviceType: string;
  placement?: (typeof DEVICE_PLACEMENTS)[number] | null;
  rackId?: string | null;
  startU?: number | null;
  heightU?: number | null;
}) {
  if (input.placement) return input.placement;
  if (input.rackId || input.startU != null || input.heightU != null)
    return "rack";
  if (input.deviceType === "vm" || input.deviceType === "container")
    return "virtual";
  if (input.deviceType === "ap") return "wireless";
  if (input.deviceType === "rack_shelf") return "rack";
  return "room";
}

type ParentDeviceRow = {
  id: string;
  labId: string;
  hostname: string;
  deviceType: string;
  rackId: string | null;
  face: (typeof DEVICE_FACES)[number] | null;
};

function normalizePlacement(input: {
  deviceId?: string;
  deviceType: string;
  placement?: (typeof DEVICE_PLACEMENTS)[number] | null;
  rackId?: string | null;
  startU?: number | null;
  heightU?: number | null;
  face?: (typeof DEVICE_FACES)[number] | null;
  rackSlot?: (typeof DEVICE_RACK_SLOTS)[number] | null;
  parentDevice?: ParentDeviceRow | null;
}) {
  const placement = derivePlacement(input);

  if (placement === "shelf") {
    const parent = input.parentDevice;
    if (!parent) {
      throw new ValidationError(
        "A rack shelf / tray must be selected for shelf-mounted gear.",
      );
    }
    if (parent.deviceType !== "rack_shelf") {
      throw new ValidationError(
        "Shelf-mounted gear can only be attached to a rack shelf / tray.",
      );
    }
    if (!parent.rackId) {
      throw new ValidationError(
        "Selected rack shelf / tray is not mounted in a rack.",
      );
    }

    return {
      placement,
      rackId: parent.rackId,
      startU: null,
      heightU: input.heightU ?? 1,
      face: parent.face ?? null,
      rackSlot: "full" as const,
    };
  }

  if (placement !== "rack") {
    return {
      placement,
      rackId: null,
      startU: null,
      heightU: null,
      face: null,
      rackSlot: "full" as const,
    };
  }

  const resolved = validateRackPlacement({
    deviceId: input.deviceId,
    rackId: input.rackId ?? null,
    startU: input.startU ?? null,
    heightU: input.heightU ?? null,
    face: input.face ?? null,
    rackSlot: input.rackSlot ?? null,
  });

  return {
    placement,
    rackId: resolved.rackId,
    startU: resolved.startU,
    heightU: resolved.heightU,
    face: resolved.face,
    rackSlot: resolved.rackSlot,
  };
}

function resolveParentDevice(
  parentDeviceId: string | null | undefined,
  labId: string,
  deviceId?: string,
) {
  if (!parentDeviceId) return null;
  if (deviceId && parentDeviceId === deviceId) {
    throw new ValidationError("A device cannot be its own parent.");
  }

  const parent = db
    .prepare(
      "SELECT id, labId, hostname, deviceType, rackId, face FROM devices WHERE id = ?",
    )
    .get(parentDeviceId) as ParentDeviceRow | undefined;

  if (!parent) {
    throw new ValidationError("Selected parent device does not exist.");
  }
  if (parent.labId !== labId) {
    throw new ValidationError("Parent device must belong to the same lab.");
  }

  return parent;
}

function validateRoom(roomId: string | null | undefined, labId: string) {
  if (!roomId) return null;
  const room = db
    .prepare("SELECT labId FROM rooms WHERE id = ?")
    .get(roomId) as { labId: string } | undefined;
  if (!room) {
    throw new ValidationError("Selected room does not exist.");
  }
  if (room.labId !== labId) {
    throw new ValidationError("Selected room must belong to the same lab.");
  }
  return roomId;
}

function normalizeMacAddress(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  const compact = raw.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (compact.length !== 12) {
    throw new ValidationError(
      "MAC address must contain 12 hexadecimal characters.",
    );
  }
  return compact.match(/.{2}/g)?.join(":") ?? null;
}

function validateNetworkMode(input: {
  networkMode: (typeof DEVICE_NETWORK_MODES)[number];
  deviceType: string;
  parentDeviceId?: string | null;
}) {
  if (input.networkMode !== "host-shared") return input.networkMode;
  if (!input.parentDeviceId) {
    throw new ValidationError(
      "Host-shared networking requires a parent host device.",
    );
  }
  if (input.deviceType !== "vm" && input.deviceType !== "container") {
    throw new ValidationError(
      "Host-shared networking is only available for VMs and containers.",
    );
  }
  return input.networkMode;
}

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { rackId?: string; labId?: string } }>(
    "/",
    async (req, reply) => {
      if (!req.authUser) {
        return reply.status(401).send({ error: "Authentication required." });
      }

      const filter = resolveLabIdsForList(
        req.authUser,
        req.labAccess ?? [],
        req.query.labId,
      );
      if (!filter.ok) {
        return reply.status(filter.status).send({ error: filter.error });
      }

      let sql = "SELECT * FROM devices WHERE 1=1";
      const params: unknown[] = [];
      if (req.query.rackId) {
        sql += " AND rackId = ?";
        params.push(req.query.rackId);
      }
      const filtered = appendLabFilter(sql, params, filter.labIds);
      const rows = db
        .prepare(`${filtered.sql} ORDER BY hostname`)
        .all(...filtered.params) as Record<string, unknown>[];
      return rows.map(parseDevice);
    },
  );

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabReadFromRow(req, reply, row)) return;
    return parseDevice(row!);
  });

  app.post("/", async (req, reply) => {
    const body = asObject(req.body);
    const labId = requiredString(body, "labId", { maxLength: 80 });
    if (!assertLabWrite(req, reply, labId)) return;
    const hostname = requiredString(body, "hostname", { maxLength: 120 });
    const deviceType = requiredDeviceType(body);
    const displayName = optionalString(body, "displayName", { maxLength: 120 });
    const manufacturer = optionalString(body, "manufacturer", {
      maxLength: 120,
    });
    const model = optionalString(body, "model", { maxLength: 120 });
    const serial = optionalString(body, "serial", { maxLength: 120 });
    const managementIp = optionalString(body, "managementIp", {
      maxLength: 60,
    });
    const macAddress = normalizeMacAddress(
      optionalString(body, "macAddress", { maxLength: 32 }),
    );
    const status = optionalEnum(body, "status", DEVICE_STATUSES) ?? "unknown";
    const networkMode =
      optionalEnum(body, "networkMode", DEVICE_NETWORK_MODES) ?? "normal";
    const placement = optionalEnum(body, "placement", DEVICE_PLACEMENTS);
    const parentDeviceId = optionalString(body, "parentDeviceId", {
      maxLength: 80,
    });
    const roomId = validateRoom(
      optionalString(body, "roomId", { maxLength: 80 }),
      labId,
    );
    const cpuCores = optionalInteger(body, "cpuCores", { min: 1, max: 4096 });
    const memoryGb = optionalNumber(body, "memoryGb", {
      min: 0.1,
      max: 1024 * 1024,
    });
    const storageGb = optionalNumber(body, "storageGb", {
      min: 0,
      max: 1024 * 1024 * 10,
    });
    const specs = optionalString(body, "specs", { maxLength: 4000 });
    const rackId = optionalString(body, "rackId", { maxLength: 80 });
    const startU = optionalInteger(body, "startU", { min: 1, max: 100 });
    const heightU = optionalInteger(body, "heightU", { min: 1, max: 20 });
    const face = optionalEnum(body, "face", DEVICE_FACES);
    const rackSlot = optionalEnum(body, "rackSlot", DEVICE_RACK_SLOTS);
    const tags = optionalStringArray(body, "tags", { maxItems: 30 });
    const notes = optionalString(body, "notes", { maxLength: 2000 });
    const lastSeen = optionalString(body, "lastSeen", { maxLength: 80 });
    const portTemplateId = optionalString(body, "portTemplateId", {
      maxLength: 80,
    });

    if (managementIp) ensureIpv4(managementIp, "managementIp");
    if (lastSeen) ensureIsoDate(lastSeen, "lastSeen");

    const parentDevice = resolveParentDevice(parentDeviceId, labId);
    const normalizedPlacement = normalizePlacement({
      deviceType,
      placement,
      rackId,
      startU,
      heightU,
      face,
      rackSlot,
      parentDevice,
    });
    const normalizedParentDeviceId = parentDevice?.id ?? null;
    const normalizedNetworkMode = validateNetworkMode({
      networkMode,
      deviceType,
      parentDeviceId: normalizedParentDeviceId,
    });

    const template = portTemplateId ? getPortTemplate(portTemplateId) : null;
    if (portTemplateId && !template) {
      throw new ValidationError("Selected port template does not exist.");
    }

    const id = createId("d");
    const insertDevice = db.prepare(`
      INSERT INTO devices
        (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
         serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId, cpuCores, memoryGb, storageGb, specs,
         startU, heightU, face, rackSlot, tags, notes, lastSeen)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const insertPort = db.prepare(`
      INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId, macAddress)
      VALUES (@id, @deviceId, @name, @position, @kind, @speed, @linkState, @mode, @vlanId, @allowedVlanIds, @description, @face, @virtualSwitchId, @macAddress)
    `);

    const createDevice = db.transaction(() => {
      insertDevice.run(
        id,
        labId,
        normalizedPlacement.rackId,
        hostname,
        displayName ?? null,
        deviceType,
        manufacturer ?? null,
        model ?? null,
        serial ?? null,
        managementIp ?? null,
        macAddress,
        status,
        normalizedPlacement.placement,
        normalizedParentDeviceId,
        normalizedNetworkMode,
        roomId,
        cpuCores ?? null,
        memoryGb ?? null,
        storageGb ?? null,
        specs ?? null,
        normalizedPlacement.startU,
        normalizedPlacement.heightU,
        normalizedPlacement.face,
        normalizedPlacement.rackSlot,
        tags ? JSON.stringify(tags) : null,
        notes ?? null,
        lastSeen ?? null,
      );

      for (const port of template
        ? createPortsFromTemplate(id, template.id)
        : []) {
        insertPort.run(port);
      }
    });

    createDevice();

    if (managementIp) {
      applyWifiDiscoveryPlacementToDevice({
        labId,
        deviceId: id,
        ipAddress: managementIp,
        deviceType,
        hostname,
        displayName,
        macAddress,
        existingPlacement: normalizedPlacement.placement,
        existingParentDeviceId: normalizedParentDeviceId,
        lastSeen: lastSeen ?? null,
      });
    }

    const row = db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(id) as Record<string, unknown>;
    return reply.status(201).send(parseDevice(row));
  });

  app.post("/bulk", async (req, reply) => {
    const body = asObject(req.body);
    const deviceIds = optionalStringArray(body, "deviceIds", { maxItems: 500 });
    if (!deviceIds?.length) {
      throw new ValidationError("deviceIds must include at least one device.");
    }

    const changes = asObject(body.changes ?? {});
    const hasChanges = Object.keys(changes).some(
      (key) => key !== "deviceIds" && key !== "changes",
    );
    if (!hasChanges) {
      throw new ValidationError("No valid fields to update.");
    }

    const nextDeviceType =
      "deviceType" in changes ? requiredDeviceType(changes) : undefined;
    const placement = optionalEnum(changes, "placement", DEVICE_PLACEMENTS);
    const parentDeviceId = optionalString(changes, "parentDeviceId", {
      maxLength: 80,
    });

    if (placement === "wireless" && !parentDeviceId) {
      throw new ValidationError(
        "Wireless placement requires selecting an access point.",
      );
    }

    const wifiSsidId = optionalString(changes, "wifiSsidId", { maxLength: 80 });
    const roomId = optionalString(changes, "roomId", { maxLength: 80 });
    const rackSlot = optionalEnum(changes, "rackSlot", DEVICE_RACK_SLOTS);
    const status = optionalEnum(changes, "status", DEVICE_STATUSES);
    const manufacturer = optionalString(changes, "manufacturer", {
      maxLength: 120,
    });
    const model = optionalString(changes, "model", { maxLength: 120 });
    const specs = optionalString(changes, "specs", { maxLength: 4000 });
    const cpuCores = optionalInteger(changes, "cpuCores", {
      min: 1,
      max: 4096,
    });
    const memoryGb = optionalNumber(changes, "memoryGb", {
      min: 0.1,
      max: 1024 * 1024,
    });
    const storageGb = optionalNumber(changes, "storageGb", {
      min: 0,
      max: 1024 * 1024 * 10,
    });
    const tags = optionalStringArray(changes, "tags", { maxItems: 30 });

    // Pre-flight: confirm every device exists and is writable BEFORE any write,
    // so the bulk update applies atomically (no partial changes on failure).
    const existingById = new Map<string, Record<string, unknown>>();
    for (const deviceId of deviceIds) {
      const existing = db
        .prepare("SELECT * FROM devices WHERE id = ?")
        .get(deviceId) as Record<string, unknown> | undefined;
      if (!existing) {
        throw new ValidationError(`Device ${deviceId} does not exist.`);
      }
      if (!assertLabWriteFromRow(req, reply, existing)) return;
      existingById.set(deviceId, existing);
    }

    const updatedDevices: Record<string, unknown>[] = [];

    // Apply all changes in one transaction so a mid-list validation failure
    // (bad SSID, invalid AP, etc.) rolls back every device instead of leaving
    // a partial update.
    const applyBulkChanges = db.transaction(() => {
      for (const deviceId of deviceIds) {
        const existing = existingById.get(deviceId)!;

        const labId = String(existing.labId);
        const updates: string[] = [];
        const values: unknown[] = [];

        if (nextDeviceType !== undefined) {
          updates.push("deviceType = ?");
          values.push(nextDeviceType);
        }
        if (status !== undefined) {
          updates.push("status = ?");
          values.push(status);
        }
        if (manufacturer !== undefined) {
          updates.push("manufacturer = ?");
          values.push(manufacturer);
        }
        if (model !== undefined) {
          updates.push("model = ?");
          values.push(model);
        }
        if (specs !== undefined) {
          updates.push("specs = ?");
          values.push(specs);
        }
        if (cpuCores !== undefined) {
          updates.push("cpuCores = ?");
          values.push(cpuCores);
        }
        if (memoryGb !== undefined) {
          updates.push("memoryGb = ?");
          values.push(memoryGb);
        }
        if (storageGb !== undefined) {
          updates.push("storageGb = ?");
          values.push(storageGb);
        }
        if (tags !== undefined) {
          updates.push("tags = ?");
          values.push(tags ? JSON.stringify(tags) : null);
        }

        const placementFieldsChanging =
          placement !== undefined ||
          parentDeviceId !== undefined ||
          roomId !== undefined ||
          rackSlot !== undefined;

        if (placementFieldsChanging) {
          const nextPlacement =
            placement ??
            (roomId !== undefined
              ? ("room" as const)
              : existing.placement
                ? (String(
                    existing.placement,
                  ) as (typeof DEVICE_PLACEMENTS)[number])
                : null);
          const nextParentId =
            parentDeviceId === undefined
              ? nextPlacement === "wireless" ||
                nextPlacement === "virtual" ||
                nextPlacement === "shelf"
                ? existing.parentDeviceId
                  ? String(existing.parentDeviceId)
                  : null
                : null
              : parentDeviceId;

          if (nextPlacement === "wireless" && nextParentId) {
            const apDevice = db
              .prepare(
                "SELECT id, labId, deviceType FROM devices WHERE id = ? AND labId = ?",
              )
              .get(nextParentId, labId) as
              | { id: string; labId: string; deviceType: string }
              | undefined;
            if (!apDevice || apDevice.deviceType !== "ap") {
              throw new ValidationError(
                "Wireless placement requires a valid access point in this lab.",
              );
            }
          }

          const parentDevice = resolveParentDevice(
            nextParentId,
            labId,
            deviceId,
          );
          const normalizedPlacement = normalizePlacement({
            deviceId,
            deviceType: nextDeviceType ?? String(existing.deviceType),
            placement: nextPlacement,
            rackId: existing.rackId ? String(existing.rackId) : null,
            startU: existing.startU == null ? null : Number(existing.startU),
            heightU: existing.heightU == null ? null : Number(existing.heightU),
            face: existing.face
              ? (String(existing.face) as (typeof DEVICE_FACES)[number])
              : null,
            rackSlot:
              rackSlot ??
              (existing.rackSlot
                ? (String(
                    existing.rackSlot,
                  ) as (typeof DEVICE_RACK_SLOTS)[number])
                : null),
            parentDevice,
          });

          updates.push(
            "placement = ?",
            "parentDeviceId = ?",
            "rackId = ?",
            "startU = ?",
            "heightU = ?",
            "face = ?",
            "rackSlot = ?",
          );
          values.push(
            normalizedPlacement.placement,
            parentDevice?.id ?? null,
            normalizedPlacement.rackId,
            normalizedPlacement.startU,
            normalizedPlacement.heightU,
            normalizedPlacement.face,
            normalizedPlacement.rackSlot,
          );

          if (roomId !== undefined) {
            updates.push("roomId = ?");
            values.push(validateRoom(roomId, labId));
          } else if (
            normalizedPlacement.placement === "wireless" &&
            parentDevice
          ) {
            const apRoom = db
              .prepare("SELECT roomId FROM devices WHERE id = ?")
              .get(parentDevice.id) as { roomId: string | null } | undefined;
            updates.push("roomId = ?");
            values.push(apRoom?.roomId ?? null);
          } else if (
            normalizedPlacement.placement === "room" &&
            roomId === undefined &&
            placement !== undefined
          ) {
            updates.push("roomId = ?");
            values.push(null);
          }
        } else if (roomId !== undefined) {
          updates.push("roomId = ?", "placement = ?", "parentDeviceId = ?");
          values.push(validateRoom(roomId, labId), "room", null);
        }

        if (updates.length === 0) continue;

        values.push(deviceId);
        db.prepare(`UPDATE devices SET ${updates.join(", ")} WHERE id = ?`).run(
          ...values,
        );

        const nextPlacementValue =
          placement ??
          (roomId !== undefined
            ? "room"
            : existing.placement
              ? String(existing.placement)
              : null);

        if (nextPlacementValue === "wireless") {
          const resolvedParentId =
            parentDeviceId ??
            (existing.parentDeviceId ? String(existing.parentDeviceId) : null);
          if (resolvedParentId) {
            let resolvedSsidId = wifiSsidId ?? null;
            if (resolvedSsidId) {
              const ssid = db
                .prepare("SELECT id FROM wifiSsids WHERE id = ? AND labId = ?")
                .get(resolvedSsidId, labId) as { id: string } | undefined;
              if (!ssid) {
                throw new ValidationError(
                  "Selected SSID must belong to this lab.",
                );
              }
            }
            upsertWifiClientAssociation({
              clientDeviceId: deviceId,
              apDeviceId: resolvedParentId,
              ssidId: resolvedSsidId,
            });
          }
        } else if (placement !== undefined && placement !== "wireless") {
          db.prepare(
            "DELETE FROM wifiClientAssociations WHERE clientDeviceId = ?",
          ).run(deviceId);
        }

        const row = db
          .prepare("SELECT * FROM devices WHERE id = ?")
          .get(deviceId) as Record<string, unknown>;
        updatedDevices.push(parseDevice(row));
      }
    });

    applyBulkChanges();

    return reply.send({
      updated: updatedDevices.length,
      devices: updatedDevices,
    });
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const existing = db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabWriteFromRow(req, reply, existing)) return;
    const device = existing!;

    const body = asObject(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];

    const nextDeviceType =
      "deviceType" in body
        ? requiredDeviceType(body)
        : String(device.deviceType);
    const rackId = optionalString(body, "rackId", { maxLength: 80 });
    const startU = optionalInteger(body, "startU", { min: 1, max: 100 });
    const heightU = optionalInteger(body, "heightU", { min: 1, max: 20 });
    const face = optionalEnum(body, "face", DEVICE_FACES);
    const rackSlot = optionalEnum(body, "rackSlot", DEVICE_RACK_SLOTS);
    const placement = optionalEnum(body, "placement", DEVICE_PLACEMENTS);
    const parentDeviceId = optionalString(body, "parentDeviceId", {
      maxLength: 80,
    });
    const networkMode = optionalEnum(body, "networkMode", DEVICE_NETWORK_MODES);
    const roomId = optionalString(body, "roomId", { maxLength: 80 });

    let normalizedParentForNetwork = device.parentDeviceId
      ? String(device.parentDeviceId)
      : null;

    if (
      rackId !== undefined ||
      startU !== undefined ||
      heightU !== undefined ||
      face !== undefined ||
      rackSlot !== undefined ||
      placement !== undefined ||
      parentDeviceId !== undefined
    ) {
      const parentDevice = resolveParentDevice(
        parentDeviceId === undefined
          ? device.parentDeviceId
            ? String(device.parentDeviceId)
            : null
          : parentDeviceId,
        String(device.labId),
        req.params.id,
      );
      const normalizedPlacement = normalizePlacement({
        deviceId: req.params.id,
        deviceType: nextDeviceType,
        placement:
          placement === undefined
            ? device.placement
              ? (String(device.placement) as (typeof DEVICE_PLACEMENTS)[number])
              : null
            : placement,
        rackId:
          rackId === undefined
            ? device.rackId
              ? String(device.rackId)
              : null
            : rackId,
        startU:
          startU === undefined
            ? device.startU == null
              ? null
              : Number(device.startU)
            : startU,
        heightU:
          heightU === undefined
            ? device.heightU == null
              ? null
              : Number(device.heightU)
            : heightU,
        face:
          face === undefined
            ? device.face
              ? (String(device.face) as (typeof DEVICE_FACES)[number])
              : null
            : face,
        rackSlot:
          rackSlot === undefined
            ? device.rackSlot
              ? (String(device.rackSlot) as (typeof DEVICE_RACK_SLOTS)[number])
              : null
            : rackSlot,
        parentDevice,
      });
      const normalizedParentDeviceId = parentDevice?.id ?? null;
      normalizedParentForNetwork = normalizedParentDeviceId;

      updates.push(
        "placement = ?",
        "parentDeviceId = ?",
        "rackId = ?",
        "startU = ?",
        "heightU = ?",
        "face = ?",
        "rackSlot = ?",
      );
      values.push(
        normalizedPlacement.placement,
        normalizedParentDeviceId,
        normalizedPlacement.rackId,
        normalizedPlacement.startU,
        normalizedPlacement.heightU,
        normalizedPlacement.face,
        normalizedPlacement.rackSlot,
      );
    }

    if (
      networkMode !== undefined ||
      "deviceType" in body ||
      parentDeviceId !== undefined
    ) {
      const nextNetworkMode =
        networkMode ??
        (device.networkMode === "host-shared" ? "host-shared" : "normal");
      updates.push("networkMode = ?");
      values.push(
        validateNetworkMode({
          networkMode: nextNetworkMode,
          deviceType: nextDeviceType,
          parentDeviceId: normalizedParentForNetwork,
        }),
      );
    }

    if (roomId !== undefined) {
      updates.push("roomId = ?");
      values.push(validateRoom(roomId, String(device.labId)));
    }

    if ("macAddress" in body) {
      const macAddress = normalizeMacAddress(
        optionalString(body, "macAddress", { maxLength: 32 }),
      );
      updates.push("macAddress = ?");
      values.push(macAddress);
    }

    if ("snmpCredentialId" in body) {
      const snmpCredentialId = optionalString(body, "snmpCredentialId", {
        maxLength: 80,
      });
      if (snmpCredentialId) {
        const credential = db
          .prepare("SELECT id FROM snmpCredentials WHERE id = ? AND labId = ?")
          .get(snmpCredentialId, device.labId) as { id: string } | undefined;
        if (!credential) {
          throw new ValidationError("SNMP credential must belong to this lab.");
        }
      }
      updates.push("snmpCredentialId = ?");
      values.push(snmpCredentialId);
    }

    const simpleStringKeys = [
      ["hostname", 120],
      ["displayName", 120],
      ["manufacturer", 120],
      ["model", 120],
      ["serial", 120],
      ["managementIp", 60],
      ["specs", 4000],
      ["notes", 2000],
      ["lastSeen", 80],
    ] as const;

    for (const [key, maxLength] of simpleStringKeys) {
      const value = optionalString(body, key, { maxLength });
      if (value !== undefined) {
        if (key === "managementIp" && value) ensureIpv4(value, key);
        if (key === "lastSeen" && value) ensureIsoDate(value, key);
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }

    if ("deviceType" in body) {
      updates.push("deviceType = ?");
      values.push(nextDeviceType);
    }

    if ("status" in body) {
      updates.push("status = ?");
      values.push(requiredEnum(body, "status", DEVICE_STATUSES));
    }

    const cpuCores = optionalInteger(body, "cpuCores", { min: 1, max: 4096 });
    if (cpuCores !== undefined) {
      updates.push("cpuCores = ?");
      values.push(cpuCores);
    }

    const memoryGb = optionalNumber(body, "memoryGb", {
      min: 0.1,
      max: 1024 * 1024,
    });
    if (memoryGb !== undefined) {
      updates.push("memoryGb = ?");
      values.push(memoryGb);
    }

    const storageGb = optionalNumber(body, "storageGb", {
      min: 0,
      max: 1024 * 1024 * 10,
    });
    if (storageGb !== undefined) {
      updates.push("storageGb = ?");
      values.push(storageGb);
    }

    const tags = optionalStringArray(body, "tags", { maxItems: 30 });
    if (tags !== undefined) {
      updates.push("tags = ?");
      values.push(tags ? JSON.stringify(tags) : null);
    }

    const portTemplateId = optionalString(body, "portTemplateId", {
      maxLength: 80,
    });
    if (portTemplateId) {
      const hasPorts = db
        .prepare("SELECT COUNT(*) AS count FROM ports WHERE deviceId = ?")
        .get(req.params.id) as { count: number };
      if (hasPorts.count > 0) {
        return reply.status(409).send({
          error:
            "This device already has ports. Port templates can only be applied to empty devices.",
        });
      }
      const template = getPortTemplate(portTemplateId);
      if (!template) {
        throw new ValidationError("Selected port template does not exist.");
      }
      const insertPort = db.prepare(`
        INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId)
        VALUES (@id, @deviceId, @name, @position, @kind, @speed, @linkState, @mode, @vlanId, @allowedVlanIds, @description, @face, @virtualSwitchId)
      `);
      const applyPorts = db.transaction(() => {
        for (const port of createPortsFromTemplate(
          req.params.id,
          template.id,
        )) {
          insertPort.run(port);
        }
      });
      applyPorts();
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE devices SET ${updates.join(", ")} WHERE id = ?`).run(
        ...values,
      );
    } else if (!portTemplateId) {
      return reply.status(400).send({ error: "No valid fields to update" });
    }

    const row = db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(req.params.id) as Record<string, unknown>;
    return parseDevice(row);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const row = db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!assertLabWriteFromRow(req, reply, row)) return;

    const portIds = (
      db
        .prepare("SELECT id FROM ports WHERE deviceId = ?")
        .all(req.params.id) as Array<{ id: string }>
    ).map((port) => port.id);

    const deleteDevice = db.transaction(
      (deviceId: string, devicePortIds: string[]) => {
        if (devicePortIds.length > 0) {
          const placeholders = devicePortIds.map(() => "?").join(", ");
          db.prepare(
            `DELETE FROM ipAssignments WHERE deviceId = ? OR portId IN (${placeholders})`,
          ).run(deviceId, ...devicePortIds);
        } else {
          db.prepare("DELETE FROM ipAssignments WHERE deviceId = ?").run(
            deviceId,
          );
        }

        db.prepare(
          `
          UPDATE discoveredDevices
          SET importedDeviceId = NULL, status = 'new'
          WHERE importedDeviceId = ?
        `,
        ).run(deviceId);

        db.prepare("DELETE FROM devices WHERE id = ?").run(deviceId);
      },
    );

    deleteDevice(req.params.id, portIds);
    return reply.status(204).send();
  });
};
