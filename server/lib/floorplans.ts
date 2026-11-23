import type Database from "better-sqlite3";
import { ValidationError } from "./validation.js";

type Row = Record<string, unknown>;
export function validateFloorplanRows(input: {
  rooms: Row[];
  racks: Row[];
  devices: Row[];
  referenceImages: Row[];
  roomFloorplans: Row[];
  roomFloorplanMarkers: Row[];
}) {
  const rooms = new Map(input.rooms.map((row) => [row.id, row]));
  const racks = new Map(input.racks.map((row) => [row.id, row]));
  const devices = new Map(input.devices.map((row) => [row.id, row]));
  const images = new Map(input.referenceImages.map((row) => [row.id, row]));
  const plans = new Set<unknown>(),
    ids = new Set<unknown>(),
    owners = new Set<string>();
  const invalid = () => {
    throw new ValidationError(
      "Invalid room floorplan ownership, coordinates or metadata.",
      422,
    );
  };
  for (const plan of input.roomFloorplans) {
    const room = rooms.get(plan.roomId);
    if (
      !room ||
      plans.has(plan.roomId) ||
      !Number.isInteger(plan.revision) ||
      Number(plan.revision) < 0 ||
      Number(plan.revision) > 2147483647 ||
      typeof plan.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(plan.updatedAt))
    )
      invalid();
    plans.add(plan.roomId);
    if (plan.backgroundImageId != null) {
      const image = images.get(plan.backgroundImageId);
      if (
        !image ||
        image.entityType !== "room" ||
        image.entityId !== plan.roomId ||
        image.labId !== room!.labId
      )
        invalid();
    }
  }
  for (const marker of input.roomFloorplanMarkers) {
    const room = rooms.get(marker.roomId);
    const device =
      marker.deviceId == null ? undefined : devices.get(marker.deviceId);
    const rack = marker.rackId == null ? undefined : racks.get(marker.rackId);
    const owner = device ?? rack;
    const effectiveRoom = device
      ? device.rackId == null
        ? device.roomId
        : racks.get(device.rackId)?.roomId
      : rack?.roomId;
    const ownerKey = `${device ? "device" : "rack"}:${device?.id ?? rack?.id}`;
    if (
      !room ||
      !plans.has(marker.roomId) ||
      (marker.deviceId != null) === (marker.rackId != null) ||
      !owner ||
      effectiveRoom !== marker.roomId ||
      owner.labId !== room.labId ||
      owners.has(ownerKey) ||
      typeof marker.id !== "string" ||
      !marker.id ||
      marker.id.length > 80 ||
      ids.has(marker.id) ||
      ![marker.x, marker.y].every(
        (value) =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 1,
      ) ||
      (marker.label != null &&
        (typeof marker.label !== "string" || marker.label.length > 120)) ||
      typeof marker.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(marker.updatedAt))
    )
      invalid();
    owners.add(ownerKey);
    ids.add(marker.id);
  }
}
export function validateStoredFloorplans(database: Database.Database) {
  const rows = (table: string, columns = "*") =>
    database.prepare(`SELECT ${columns} FROM ${table}`).all() as Row[];
  validateFloorplanRows({
    rooms: rows("rooms", "id,labId"),
    racks: rows("racks", "id,labId,roomId"),
    devices: rows("devices", "id,labId,roomId,rackId"),
    referenceImages: rows("referenceImages", "id,labId,entityType,entityId"),
    roomFloorplans: rows("roomFloorplans"),
    roomFloorplanMarkers: rows("roomFloorplanMarkers"),
  });
}
