import type { FastifyPluginAsync } from "fastify";
import { db, parseRow } from "../db.js";
import { writeAuditLogEntry } from "../lib/audit-log.js";
import { deviceTypeBase } from "../lib/device-types.js";
import { assertLabWriteFromRow } from "../lib/lab-access.js";
import {
  currentRackStudioPlacement,
  parseRackStudioPlacementState,
  rackSlotForColumns,
  rackStudioPlacementStatesEqual,
  resolveRackStudioPlacement,
  type RackStudioDeviceRow,
} from "../lib/rack-studio-placement.js";
import {
  RACK_STUDIO_CANVAS_WIDTH,
  assertRackStudioRackFootprint,
} from "../lib/rack-studio-canvas.js";
import {
  asObject,
  optionalNumber,
  optionalString,
  requiredEnum,
  requiredString,
  ValidationError,
} from "../lib/validation.js";

const ACTION_KINDS = ["rack.move", "device.place"] as const;

interface RackCanvasRow extends Record<string, unknown> {
  id: string;
  labId: string;
  name: string;
  roomId: string | null;
  studioX: number | null;
  studioY: number | null;
}

interface RackCanvasState {
  roomId: string | null;
  x: number | null;
  y: number | null;
}

function parseRackCanvasState(value: unknown): RackCanvasState {
  const body = asObject(value);
  if (!("roomId" in body) || !("x" in body) || !("y" in body)) {
    throw new ValidationError(
      "Rack canvas state must include roomId, x, and y.",
    );
  }
  return {
    roomId: optionalString(body, "roomId", { maxLength: 120 }) ?? null,
    x:
      optionalNumber(body, "x", {
        min: 0,
        max: RACK_STUDIO_CANVAS_WIDTH,
      }) ?? null,
    y: optionalNumber(body, "y", { min: 0, max: 100_000 }) ?? null,
  };
}

function currentRackCanvasState(row: RackCanvasRow): RackCanvasState {
  return {
    roomId: row.roomId ?? null,
    x: row.studioX ?? null,
    y: row.studioY ?? null,
  };
}

function rackCanvasStatesEqual(left: RackCanvasState, right: RackCanvasState) {
  return (
    left.roomId === right.roomId && left.x === right.x && left.y === right.y
  );
}

function validateRackRoom(row: RackCanvasRow, roomId: string | null) {
  if (!roomId) {
    throw new ValidationError(
      "A rack must be assigned to a room before it can be positioned in Studio.",
    );
  }
  const room = db
    .prepare("SELECT labId FROM rooms WHERE id = ?")
    .get(roomId) as { labId: string } | undefined;
  if (!room) throw new ValidationError("Selected room does not exist.");
  if (room.labId !== row.labId) {
    throw new ValidationError("Selected room must belong to the same lab.");
  }
  if (row.roomId !== roomId) {
    throw new ValidationError(
      "Use the rack editor to change a rack's room before positioning it.",
    );
  }
}

function parseDeviceRow(row: RackStudioDeviceRow) {
  return {
    ...parseRow(row, ["tags"]),
    ignoreDuplicateMac: Number(row.ignoreDuplicateMac ?? 0) === 1,
  };
}

function placementName(mountKind: string) {
  if (mountKind === "shelf") return "shelf";
  if (mountKind === "loose") return "room";
  return "rack";
}

export const rackStudioRoutes: FastifyPluginAsync = async (app) => {
  app.post("/actions", async (req, reply) => {
    const body = asObject(req.body);
    const kind = requiredEnum(body, "kind", ACTION_KINDS);
    const targetId = requiredString(body, "targetId", { maxLength: 120 });

    if (kind === "rack.move") {
      const rack = db
        .prepare("SELECT * FROM racks WHERE id = ?")
        .get(targetId) as RackCanvasRow | undefined;
      if (
        !assertLabWriteFromRow(
          req,
          reply,
          rack as unknown as Record<string, unknown> | undefined,
        )
      ) {
        return;
      }
      const expected = parseRackCanvasState(body.expected);
      const next = parseRackCanvasState(body.next);
      if ((next.x === null) !== (next.y === null)) {
        throw new ValidationError(
          "Rack canvas coordinates must both be set or both use automatic placement.",
        );
      }
      validateRackRoom(rack!, next.roomId);
      assertRackStudioRackFootprint({
        roomId: next.roomId!,
        x: next.x,
        y: next.y,
      });

      const moveRack = db.transaction(() => {
        const current = db
          .prepare("SELECT * FROM racks WHERE id = ?")
          .get(targetId) as RackCanvasRow;
        const before = currentRackCanvasState(current);
        if (!rackCanvasStatesEqual(before, expected)) {
          throw new ValidationError(
            "Rack position changed after this action was prepared.",
            409,
            "RACK_STUDIO_CONFLICT",
            { current: before },
          );
        }
        db.prepare(
          "UPDATE racks SET studioX = ?, studioY = ? WHERE id = ?",
        ).run(next.x, next.y, targetId);
        writeAuditLogEntry({
          user: req.authUser!.username,
          action: "rack-studio.rack.move",
          entityType: "Rack",
          entityId: targetId,
          summary: `Moved rack ${current.name} on the room canvas`,
        });
        return before;
      });
      const before = moveRack();
      const updated = db
        .prepare("SELECT * FROM racks WHERE id = ?")
        .get(targetId) as RackCanvasRow;
      return {
        kind,
        targetId,
        before,
        after: currentRackCanvasState(updated),
        rack: updated,
      };
    }

    const device = db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(targetId) as RackStudioDeviceRow | undefined;
    if (
      !assertLabWriteFromRow(
        req,
        reply,
        device as unknown as Record<string, unknown> | undefined,
      )
    ) {
      return;
    }
    const expected = parseRackStudioPlacementState(body.expected);
    const requested = parseRackStudioPlacementState(body.next);

    const placeDevice = db.transaction(() => {
      const current = db
        .prepare("SELECT * FROM devices WHERE id = ?")
        .get(targetId) as RackStudioDeviceRow;
      const before = currentRackStudioPlacement(current);
      if (!rackStudioPlacementStatesEqual(before, expected)) {
        throw new ValidationError(
          "Device placement changed after this action was prepared.",
          409,
          "RACK_STUDIO_CONFLICT",
          { current: before },
        );
      }
      if (
        deviceTypeBase(current.deviceType) === "rack_shelf" &&
        requested.mountKind !== "direct" &&
        db
          .prepare(
            "SELECT id FROM devices WHERE parentDeviceId = ? AND (placement = 'shelf' OR rackMountKind = 'shelf') LIMIT 1",
          )
          .get(current.id)
      ) {
        throw new ValidationError(
          "Move or unmount devices from this shelf before moving the shelf out of the rack.",
        );
      }
      const after = resolveRackStudioPlacement(current, requested);
      const rackSlot = rackSlotForColumns(after.column, after.columnSpan);
      db.prepare(
        `
          UPDATE devices
          SET placement = ?, roomId = ?, rackId = ?, parentDeviceId = ?,
              startU = ?, heightU = ?, face = ?, rackSlot = ?,
              rackMountKind = ?, rackColumn = ?, rackColumnSpan = ?,
              shelfX = ?, shelfY = ?, shelfWidth = ?, shelfHeight = ?,
              shelfOrientation = ?, rackSide = ?
          WHERE id = ?
        `,
      ).run(
        placementName(after.mountKind),
        after.roomId,
        after.rackId,
        after.parentDeviceId,
        after.startU,
        after.heightU,
        after.face,
        rackSlot,
        after.mountKind,
        after.column,
        after.columnSpan,
        after.shelfX,
        after.shelfY,
        after.shelfWidth,
        after.shelfHeight,
        after.orientation ?? 0,
        after.side,
        current.id,
      );
      if (
        deviceTypeBase(current.deviceType) === "rack_shelf" &&
        after.mountKind === "direct"
      ) {
        db.prepare(
          `
            UPDATE devices
            SET rackId = ?, roomId = ?, face = ?
            WHERE parentDeviceId = ?
              AND (placement = 'shelf' OR rackMountKind = 'shelf')
          `,
        ).run(after.rackId, after.roomId, after.face, current.id);
      }
      writeAuditLogEntry({
        user: req.authUser!.username,
        action: "rack-studio.device.place",
        entityType: "Device",
        entityId: current.id,
        summary: `Placed ${current.hostname} as ${after.mountKind} equipment in Rack Studio`,
      });
      return { before, after };
    });

    const result = placeDevice();
    const updatedDevices = (
      db
        .prepare(
          `
            SELECT *
            FROM devices
            WHERE id = ? OR parentDeviceId = ?
            ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, hostname, id
          `,
        )
        .all(targetId, targetId, targetId) as RackStudioDeviceRow[]
    ).map(parseDeviceRow);
    const updated = updatedDevices.find((row) => row.id === targetId)!;
    return {
      kind,
      targetId,
      before: result.before,
      after: result.after,
      device: updated,
      devices: updatedDevices,
    };
  });
};
