import type { FastifyPluginAsync } from "fastify";
import { db, parseRow } from "../db.js";
import { assertLabWrite, assertLabWriteFromRow } from "../lib/lab-access.js";
import { createId } from "../lib/ids.js";
import {
  asObject,
  optionalString,
  optionalStringArray,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

type DeviceLabRow = {
  id: string;
  labId: string;
};

type PortLabRow = {
  id: string;
  deviceId: string;
  labId: string;
  portRole: string | null;
  aggregatePortId: string | null;
};

function parsePort(row: Record<string, unknown>) {
  return parseRow(row, ["allowedVlanIds"]);
}

function getDeviceLabRow(deviceId: string) {
  return db
    .prepare("SELECT id, labId FROM devices WHERE id = ?")
    .get(deviceId) as DeviceLabRow | undefined;
}

function getPortLabRow(portId: string) {
  return db
    .prepare(
      `
      SELECT ports.id, ports.deviceId, devices.labId, ports.portRole, ports.aggregatePortId
      FROM ports
      JOIN devices ON devices.id = ports.deviceId
      WHERE ports.id = ?
    `,
    )
    .get(portId) as PortLabRow | undefined;
}

function getAggregatePortRow(portId: string) {
  return db
    .prepare(
      `
      SELECT ports.*, devices.labId
      FROM ports
      JOIN devices ON devices.id = ports.deviceId
      WHERE ports.id = ? AND ports.portRole = 'aggregate'
    `,
    )
    .get(portId) as Record<string, unknown> | undefined;
}

function portHasCable(portId: string) {
  return Boolean(
    db
      .prepare(
        "SELECT id FROM portLinks WHERE fromPortId = ? OR toPortId = ? LIMIT 1",
      )
      .get(portId, portId),
  );
}

function validateMemberPorts(input: {
  device: DeviceLabRow;
  memberPortIds: string[] | null | undefined;
  aggregatePortId?: string;
}) {
  const memberPortIds = [
    ...new Set((input.memberPortIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ];
  if (memberPortIds.length < 2) {
    throw new ValidationError("An aggregate must include at least two member ports.");
  }

  const members: PortLabRow[] = [];
  for (const portId of memberPortIds) {
    const port = getPortLabRow(portId);
    if (!port) {
      throw new ValidationError("Every aggregate member port must exist.");
    }
    if (port.labId !== input.device.labId || port.deviceId !== input.device.id) {
      throw new ValidationError(
        "Aggregate member ports must belong to the same device and lab.",
      );
    }
    if (port.id === input.aggregatePortId || port.portRole === "aggregate") {
      throw new ValidationError("Aggregate ports cannot be members of another aggregate.");
    }
    if (
      port.aggregatePortId &&
      (!input.aggregatePortId || port.aggregatePortId !== input.aggregatePortId)
    ) {
      throw new ValidationError("One of the selected ports is already in an aggregate.");
    }
    members.push(port);
  }

  return members;
}

function aggregatePayload(portId: string) {
  const aggregate = getAggregatePortRow(portId);
  if (!aggregate) return null;
  const members = db
    .prepare("SELECT * FROM ports WHERE aggregatePortId = ? ORDER BY position, name, id")
    .all(portId) as Record<string, unknown>[];
  return {
    aggregate: parsePort(aggregate),
    members: members.map(parsePort),
  };
}

export const portAggregatesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (req, reply) => {
    const body = asObject(req.body);
    const deviceId = requiredString(body, "deviceId", { maxLength: 80 });
    const name = requiredString(body, "name", { maxLength: 120 });
    const speed = optionalString(body, "speed", { maxLength: 20 });
    const description = optionalString(body, "description", { maxLength: 500 });
    const memberPortIds = optionalStringArray(body, "memberPortIds", {
      maxItems: 64,
    });

    const device = getDeviceLabRow(deviceId);
    if (!device) {
      return reply.status(404).send({ error: "Device not found." });
    }
    if (!assertLabWrite(req, reply, device.labId)) return;

    const members = validateMemberPorts({ device, memberPortIds });
    const row = db
      .prepare("SELECT MAX(position) AS maxPosition FROM ports WHERE deviceId = ?")
      .get(deviceId) as { maxPosition?: number | null };
    const aggregatePortId = createId("p");
    const position = (row.maxPosition ?? 0) + 1;

    const createAggregate = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO ports
          (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId, portRole, aggregatePortId, macAddress)
        VALUES (?, ?, ?, ?, 'virtual', ?, 'down', 'access', NULL, NULL, ?, 'front', NULL, 'aggregate', NULL, NULL)
      `,
      ).run(aggregatePortId, deviceId, name, position, speed ?? null, description ?? null);

      const updateMember = db.prepare(
        "UPDATE ports SET aggregatePortId = ? WHERE id = ?",
      );
      for (const member of members) {
        updateMember.run(aggregatePortId, member.id);
      }
    });

    createAggregate();
    return reply.status(201).send(aggregatePayload(aggregatePortId));
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const existing = getAggregatePortRow(req.params.id);
    if (!assertLabWriteFromRow(req, reply, existing)) return;

    const body = asObject(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];
    const name = optionalString(body, "name", { maxLength: 120 });
    const speed = optionalString(body, "speed", { maxLength: 20 });
    const description = optionalString(body, "description", { maxLength: 500 });
    const hasMemberPorts = "memberPortIds" in body;
    const memberPortIds = hasMemberPorts
      ? optionalStringArray(body, "memberPortIds", { maxItems: 64 })
      : undefined;

    if (name !== undefined) {
      if (!name) throw new ValidationError("Aggregate name cannot be empty.");
      updates.push("name = ?");
      values.push(name);
    }
    if (speed !== undefined) {
      updates.push("speed = ?");
      values.push(speed);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      values.push(description);
    }

    const device = {
      id: String(existing!.deviceId),
      labId: String(existing!.labId),
    };
    const members = hasMemberPorts
      ? validateMemberPorts({
          device,
          memberPortIds,
          aggregatePortId: req.params.id,
        })
      : null;

    if (updates.length === 0 && !hasMemberPorts) {
      return reply.status(400).send({ error: "No valid fields to update." });
    }

    const updateAggregate = db.transaction(() => {
      if (updates.length > 0) {
        values.push(req.params.id);
        db.prepare(`UPDATE ports SET ${updates.join(", ")} WHERE id = ?`).run(
          ...values,
        );
      }
      if (hasMemberPorts) {
        db.prepare("UPDATE ports SET aggregatePortId = NULL WHERE aggregatePortId = ?").run(
          req.params.id,
        );
        const updateMember = db.prepare(
          "UPDATE ports SET aggregatePortId = ? WHERE id = ?",
        );
        for (const member of members ?? []) {
          updateMember.run(req.params.id, member.id);
        }
      }
    });

    updateAggregate();
    return reply.send(aggregatePayload(req.params.id));
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const existing = getAggregatePortRow(req.params.id);
    if (!assertLabWriteFromRow(req, reply, existing)) return;
    if (portHasCable(req.params.id)) {
      return reply
        .status(409)
        .send({ error: "Remove the linked cable before deleting this aggregate." });
    }

    const removeAggregate = db.transaction(() => {
      db.prepare("UPDATE ports SET aggregatePortId = NULL WHERE aggregatePortId = ?").run(
        req.params.id,
      );
      db.prepare("DELETE FROM ports WHERE id = ?").run(req.params.id);
    });

    removeAggregate();
    return reply.status(204).send();
  });
};
