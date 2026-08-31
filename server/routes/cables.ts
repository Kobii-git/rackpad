import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { writeAuditLogEntry } from "../lib/audit-log.js";
import {
  decodeCableRouteWaypoints,
  isPhysicalCableEndpoint,
  parseCableRouteWaypoints,
  physicalConnectorPairIsUsual,
  type CableRouteWaypoint,
} from "../lib/cable-routing.js";
import { assertRackStudioWaypointBounds } from "../lib/rack-studio-canvas.js";
import {
  appendLabFilter,
  assertLabRead,
  assertLabWrite,
  resolveLabIdsForList,
} from "../lib/lab-access.js";
import { createId } from "../lib/ids.js";
import {
  asObject,
  optionalBoolean,
  optionalString,
  optionalStringArray,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

function getPortLabRow(portId: string) {
  return db
    .prepare(
      `
    SELECT ports.id, ports.name, ports.kind, devices.labId, devices.hostname,
           ports.portRole, ports.aggregatePortId
    FROM ports
    JOIN devices ON devices.id = ports.deviceId
    WHERE ports.id = ?
  `,
    )
    .get(portId) as
    | {
        id: string;
        name: string;
        kind: string;
        labId: string;
        hostname: string;
        portRole: string | null;
        aggregatePortId: string | null;
      }
    | undefined;
}

function getLinkAccessRow(linkId: string) {
  return db
    .prepare(
      `
    SELECT
      portLinks.id,
      fromDevice.labId AS fromLabId,
      toDevice.labId AS toLabId
    FROM portLinks
    JOIN ports fromPort ON fromPort.id = portLinks.fromPortId
    JOIN devices fromDevice ON fromDevice.id = fromPort.deviceId
    JOIN ports toPort ON toPort.id = portLinks.toPortId
    JOIN devices toDevice ON toDevice.id = toPort.deviceId
    WHERE portLinks.id = ?
  `,
    )
    .get(linkId) as
    { id: string; fromLabId: string; toLabId: string } | undefined;
}

function serializeLinkRow(row: Record<string, unknown> | undefined) {
  if (!row) return row;
  return {
    ...row,
    visible: row.visible !== 0 && row.visible !== false,
    routeWaypoints: decodeCableRouteWaypoints(row.routeWaypoints),
  };
}

function assertWaypointRooms(
  waypoints: CableRouteWaypoint[],
  endpointLabIds: string[],
) {
  if (waypoints.length === 0) return;
  const allowedLabIds = new Set(endpointLabIds);
  const roomIds = [...new Set(waypoints.map((point) => point.roomId))];
  const placeholders = roomIds.map(() => "?").join(", ");
  const rooms = db
    .prepare(`SELECT id, labId FROM rooms WHERE id IN (${placeholders})`)
    .all(...roomIds) as Array<{ id: string; labId: string }>;
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  for (const roomId of roomIds) {
    const room = roomsById.get(roomId);
    if (!room) {
      throw new ValidationError(`Cable route room ${roomId} does not exist.`);
    }
    if (!allowedLabIds.has(room.labId)) {
      throw new ValidationError(
        "Cable route waypoints must stay within an endpoint lab.",
      );
    }
  }
  for (const waypoint of waypoints) {
    assertRackStudioWaypointBounds(waypoint);
  }
}

function assertPhysicalPair(
  fromPort: NonNullable<ReturnType<typeof getPortLabRow>>,
  toPort: NonNullable<ReturnType<typeof getPortLabRow>>,
  confirmUnusual: boolean,
) {
  if (
    !isPhysicalCableEndpoint(fromPort.kind, fromPort.portRole) ||
    !isPhysicalCableEndpoint(toPort.kind, toPort.portRole)
  ) {
    throw new ValidationError(
      "Physical patching requires two non-aggregate physical ports.",
    );
  }
  if (
    !physicalConnectorPairIsUsual(fromPort.kind, toPort.kind) &&
    !confirmUnusual
  ) {
    throw new ValidationError(
      `Connecting ${fromPort.kind} to ${toPort.kind} is unusual and requires confirmation.`,
      409,
      "CABLE_CONNECTOR_CONFIRMATION_REQUIRED",
      { fromKind: fromPort.kind, toKind: toPort.kind },
    );
  }
}

export const cablesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>("/", async (req, reply) => {
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

    const sql = `
      SELECT portLinks.*
      FROM portLinks
      JOIN ports fromPort ON fromPort.id = portLinks.fromPortId
      JOIN devices fromDevice ON fromDevice.id = fromPort.deviceId
      JOIN ports toPort ON toPort.id = portLinks.toPortId
      JOIN devices toDevice ON toDevice.id = toPort.deviceId
      WHERE 1=1
    `;
    const params: unknown[] = [];
    const fromFiltered = appendLabFilter(
      sql,
      params,
      filter.labIds,
      "fromDevice.labId",
    );
    const filtered = appendLabFilter(
      fromFiltered.sql,
      fromFiltered.params,
      filter.labIds,
      "toDevice.labId",
    );
    return (
      db.prepare(filtered.sql).all(...filtered.params) as Array<
        Record<string, unknown>
      >
    ).map((row) => serializeLinkRow(row));
  });

  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const access = getLinkAccessRow(req.params.id);
    if (!access) return reply.status(404).send({ error: "Not found." });
    if (!assertLabRead(req, reply, access.fromLabId)) return;
    if (!assertLabRead(req, reply, access.toLabId)) return;
    const row = db
      .prepare("SELECT * FROM portLinks WHERE id = ?")
      .get(req.params.id) as Record<string, unknown>;
    return serializeLinkRow(row);
  });

  app.post("/", async (req, reply) => {
    const body = asObject(req.body);
    const fromPortId = requiredString(body, "fromPortId", { maxLength: 80 });
    const toPortId = requiredString(body, "toPortId", { maxLength: 80 });
    const cableType = optionalString(body, "cableType", { maxLength: 80 });
    const cableLength = optionalString(body, "cableLength", { maxLength: 40 });
    const color = optionalString(body, "color", { maxLength: 40 });
    const notes = optionalString(body, "notes", { maxLength: 500 });
    const label = optionalString(body, "label", { maxLength: 120 });
    const visible = optionalBoolean(body, "visible");
    const routeWaypoints = parseCableRouteWaypoints(body.routeWaypoints);
    const physicalMode = optionalBoolean(body, "physicalMode") === true;
    const confirmUnusual =
      optionalBoolean(body, "confirmUnusual") === true;

    if (fromPortId === toPortId) {
      return reply
        .status(400)
        .send({ error: "A port cannot be linked to itself" });
    }

    const fromPort = getPortLabRow(fromPortId);
    const toPort = getPortLabRow(toPortId);
    if (!fromPort || !toPort) {
      return reply
        .status(400)
        .send({ error: "Both cable endpoints must exist" });
    }
    if (!assertLabWrite(req, reply, fromPort.labId)) return;
    if (!assertLabWrite(req, reply, toPort.labId)) return;
    assertWaypointRooms(routeWaypoints, [fromPort.labId, toPort.labId]);
    if (physicalMode) {
      assertPhysicalPair(fromPort, toPort, confirmUnusual);
    }
    const existing = db
      .prepare(
        `
      SELECT id
      FROM portLinks
      WHERE fromPortId IN (?, ?) OR toPortId IN (?, ?)
      LIMIT 1
    `,
      )
      .get(fromPortId, toPortId, fromPortId, toPortId);
    if (existing) {
      return reply
        .status(409)
        .send({ error: "One of the selected ports is already linked" });
    }

    const id = createId("l");
    db.transaction(() => {
      db.prepare(
        `INSERT INTO portLinks
          (id, fromPortId, toPortId, cableType, cableLength, color, notes, label, visible, routeWaypoints)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        fromPortId,
        toPortId,
        cableType ?? null,
        cableLength ?? null,
        color ?? null,
        notes ?? null,
        label ?? null,
        visible === false ? 0 : 1,
        JSON.stringify(routeWaypoints),
      );

      db.prepare(
        "UPDATE ports SET linkState = 'up' WHERE id = ? OR id = ?",
      ).run(fromPortId, toPortId);
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: physicalMode ? "port.link.physical" : "port.link",
        entityType: "PortLink",
        entityId: id,
        summary: `Linked ${fromPort.hostname}:${fromPort.name} to ${toPort.hostname}:${toPort.name}`,
      });
    })();

    const created = db.prepare("SELECT * FROM portLinks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return reply.status(201).send(serializeLinkRow(created));
  });

  app.post("/bulk", async (req, reply) => {
    const body = asObject(req.body);
    const requestedLinkIds = optionalStringArray(body, "linkIds");
    const linkIds = [...new Set(requestedLinkIds ?? [])];
    if (linkIds.length === 0) {
      throw new ValidationError("linkIds must include at least one cable.");
    }
    if (linkIds.length > 500) {
      throw new ValidationError("linkIds must contain 500 cables or fewer.");
    }

    const changes = asObject(body.changes ?? {});
    const allowedFields = new Set([
      "cableType",
      "cableLength",
      "color",
      "notes",
      "label",
      "visible",
      "routeWaypoints",
    ]);
    const unknownFields = Object.keys(changes).filter(
      (key) => !allowedFields.has(key),
    );
    if (unknownFields.length > 0) {
      throw new ValidationError(
        `Unsupported bulk cable fields: ${unknownFields.join(", ")}.`,
      );
    }

    const cableType = optionalString(changes, "cableType", { maxLength: 80 });
    const cableLength = optionalString(changes, "cableLength", {
      maxLength: 40,
    });
    const color = optionalString(changes, "color", { maxLength: 40 });
    const notes = optionalString(changes, "notes", { maxLength: 500 });
    const label = optionalString(changes, "label", { maxLength: 120 });
    const visible = optionalBoolean(changes, "visible");
    const routeWaypoints = Object.prototype.hasOwnProperty.call(
      changes,
      "routeWaypoints",
    )
      ? parseCableRouteWaypoints(changes.routeWaypoints)
      : undefined;
    const updates: string[] = [];
    const values: unknown[] = [];
    if (cableType !== undefined) {
      updates.push("cableType = ?");
      values.push(cableType);
    }
    if (cableLength !== undefined) {
      updates.push("cableLength = ?");
      values.push(cableLength);
    }
    if (color !== undefined) {
      updates.push("color = ?");
      values.push(color);
    }
    if (notes !== undefined) {
      updates.push("notes = ?");
      values.push(notes);
    }
    if (label !== undefined) {
      updates.push("label = ?");
      values.push(label);
    }
    if (visible !== undefined) {
      updates.push("visible = ?");
      values.push(visible === false ? 0 : 1);
    }
    if (routeWaypoints !== undefined) {
      updates.push("routeWaypoints = ?");
      values.push(JSON.stringify(routeWaypoints));
    }
    if (updates.length === 0) {
      throw new ValidationError("No valid cable fields to update.");
    }

    for (const linkId of linkIds) {
      const link = getLinkAccessRow(linkId);
      if (!link) {
        throw new ValidationError(`Cable ${linkId} does not exist.`);
      }
      if (!assertLabWrite(req, reply, link.fromLabId)) return;
      if (!assertLabWrite(req, reply, link.toLabId)) return;
      if (routeWaypoints !== undefined) {
        assertWaypointRooms(routeWaypoints, [link.fromLabId, link.toLabId]);
      }
    }

    const updateLink = db.prepare(
      `UPDATE portLinks SET ${updates.join(", ")} WHERE id = ?`,
    );
    db.transaction(() => {
      for (const linkId of linkIds) {
        updateLink.run(...values, linkId);
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "port.link.bulk-update",
          entityType: "PortLink",
          entityId: linkId,
          summary: `Updated cable metadata (${updates.join(", ")})`,
        });
      }
    })();

    const links = linkIds.map((linkId) =>
      serializeLinkRow(
        db.prepare("SELECT * FROM portLinks WHERE id = ?").get(linkId) as
          | Record<string, unknown>
          | undefined,
      ),
    );
    return { updated: links.length, links };
  });

  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const existing = db
      .prepare("SELECT * FROM portLinks WHERE id = ?")
      .get(req.params.id) as
      | {
          id: string;
          fromPortId: string;
          toPortId: string;
          routeWaypoints: unknown;
        }
      | undefined;
    const access = getLinkAccessRow(req.params.id);
    if (!existing || !access) {
      return reply.status(404).send({ error: "Not found." });
    }
    if (!assertLabWrite(req, reply, access.fromLabId)) return;
    if (!assertLabWrite(req, reply, access.toLabId)) return;

    const body = asObject(req.body);
    const updates: string[] = [];
    const values: unknown[] = [];

    const fromPortId = optionalString(body, "fromPortId", { maxLength: 80 });
    const toPortId = optionalString(body, "toPortId", { maxLength: 80 });
    const cableType = optionalString(body, "cableType", { maxLength: 80 });
    const cableLength = optionalString(body, "cableLength", { maxLength: 40 });
    const color = optionalString(body, "color", { maxLength: 40 });
    const notes = optionalString(body, "notes", { maxLength: 500 });
    const label = optionalString(body, "label", { maxLength: 120 });
    const visible = optionalBoolean(body, "visible");
    const routeWaypoints = Object.prototype.hasOwnProperty.call(
      body,
      "routeWaypoints",
    )
      ? parseCableRouteWaypoints(body.routeWaypoints)
      : undefined;
    const physicalMode = optionalBoolean(body, "physicalMode") === true;
    const confirmUnusual =
      optionalBoolean(body, "confirmUnusual") === true;
    const nextFromPortId = fromPortId ?? existing.fromPortId;
    const nextToPortId = toPortId ?? existing.toPortId;

    if (fromPortId !== undefined || toPortId !== undefined) {
      if (nextFromPortId === nextToPortId) {
        return reply
          .status(400)
          .send({ error: "A port cannot be linked to itself" });
      }

      const fromPort = getPortLabRow(nextFromPortId);
      const toPort = getPortLabRow(nextToPortId);
      if (!fromPort || !toPort) {
        return reply
          .status(400)
          .send({ error: "Both cable endpoints must exist" });
      }
      if (!assertLabWrite(req, reply, fromPort.labId)) return;
      if (!assertLabWrite(req, reply, toPort.labId)) return;
      if (physicalMode) {
        assertPhysicalPair(fromPort, toPort, confirmUnusual);
      }
      const conflicting = db
        .prepare(
          `
        SELECT id
        FROM portLinks
        WHERE id != ?
          AND (fromPortId IN (?, ?) OR toPortId IN (?, ?))
        LIMIT 1
      `,
        )
        .get(
          req.params.id,
          nextFromPortId,
          nextToPortId,
          nextFromPortId,
          nextToPortId,
        );
      if (conflicting) {
        return reply
          .status(409)
          .send({ error: "One of the selected ports is already linked" });
      }
    }

    const nextFromPort = getPortLabRow(nextFromPortId);
    const nextToPort = getPortLabRow(nextToPortId);
    if (!nextFromPort || !nextToPort) {
      return reply
        .status(400)
        .send({ error: "Both cable endpoints must exist" });
    }
    assertWaypointRooms(
      routeWaypoints ?? decodeCableRouteWaypoints(existing.routeWaypoints),
      [nextFromPort.labId, nextToPort.labId],
    );

    if (fromPortId !== undefined) {
      updates.push("fromPortId = ?");
      values.push(nextFromPortId);
    }
    if (toPortId !== undefined) {
      updates.push("toPortId = ?");
      values.push(nextToPortId);
    }
    if (cableType !== undefined) {
      updates.push("cableType = ?");
      values.push(cableType);
    }
    if (cableLength !== undefined) {
      updates.push("cableLength = ?");
      values.push(cableLength);
    }
    if (color !== undefined) {
      updates.push("color = ?");
      values.push(color);
    }
    if (notes !== undefined) {
      updates.push("notes = ?");
      values.push(notes);
    }
    if (label !== undefined) {
      updates.push("label = ?");
      values.push(label);
    }
    if (visible !== undefined) {
      updates.push("visible = ?");
      values.push(visible === false ? 0 : 1);
    }
    if (routeWaypoints !== undefined) {
      updates.push("routeWaypoints = ?");
      values.push(JSON.stringify(routeWaypoints));
    }

    if (updates.length === 0)
      return reply.status(400).send({ error: "No valid fields to update" });

    const updateLink = db.transaction(() => {
      values.push(req.params.id);
      db.prepare(`UPDATE portLinks SET ${updates.join(", ")} WHERE id = ?`).run(
        ...values,
      );
      for (const portId of new Set([
        existing.fromPortId,
        existing.toPortId,
        nextFromPortId,
        nextToPortId,
      ])) {
        const stillLinked = db
          .prepare(
            "SELECT id FROM portLinks WHERE fromPortId = ? OR toPortId = ?",
          )
          .get(portId, portId);
        db.prepare("UPDATE ports SET linkState = ? WHERE id = ?").run(
          stillLinked ? "up" : "down",
          portId,
        );
      }
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "port.link.update",
        entityType: "PortLink",
        entityId: req.params.id,
        summary: `Updated cable ${nextFromPort.hostname}:${nextFromPort.name} to ${nextToPort.hostname}:${nextToPort.name}`,
      });
    });

    updateLink();
    return serializeLinkRow(
      db.prepare("SELECT * FROM portLinks WHERE id = ?").get(req.params.id) as
        | Record<string, unknown>
        | undefined,
    );
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const link = db
      .prepare("SELECT * FROM portLinks WHERE id = ?")
      .get(req.params.id) as
      { fromPortId: string; toPortId: string } | undefined;
    const access = getLinkAccessRow(req.params.id);
    if (!link || !access) {
      return reply.status(404).send({ error: "Not found." });
    }
    if (!assertLabWrite(req, reply, access.fromLabId)) return;
    if (!assertLabWrite(req, reply, access.toLabId)) return;

    db.transaction(() => {
      db.prepare("DELETE FROM portLinks WHERE id = ?").run(req.params.id);

      for (const portId of [link.fromPortId, link.toPortId]) {
        const stillLinked = db
          .prepare(
            "SELECT id FROM portLinks WHERE fromPortId = ? OR toPortId = ?",
          )
          .get(portId, portId);
        if (!stillLinked) {
          db.prepare("UPDATE ports SET linkState = 'down' WHERE id = ?").run(
            portId,
          );
        }
      }
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "port.unlink",
        entityType: "PortLink",
        entityId: req.params.id,
        summary: `Removed cable ${link.fromPortId} to ${link.toPortId}`,
      });
    })();

    return reply.status(204).send();
  });
};
