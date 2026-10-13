import { createHash } from "node:crypto";
import { db } from "../db.js";
import { canWriteLab, fetchUserLabAccess } from "./lab-access.js";
import { getPublicUserById } from "./auth.js";
import { writeAuditLogEntry } from "./audit-log.js";
import { requiredDeviceType } from "./device-types.js";
import { initializeDevicePhysicalLayout, reconcileDevicePhysicalLayout } from "./device-physical-layout.js";
import { isStackType, syncStackHeight, assertPortStackMember } from "./device-stacks.js";
import { isPhysicalCableEndpoint, physicalConnectorPairIsUsual } from "./cable-routing.js";
import { createId } from "./ids.js";
import { resolveRackStudioPlacement, type RackStudioDeviceRow, type RackStudioPlacementState } from "./rack-studio-placement.js";
import { ValidationError } from "./validation.js";
import { z } from "zod/v4";

const key = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const reference = z.object({ key: key.optional(), id: z.string().min(1).max(80).optional() }).refine(
  (value) => Number(value.key !== undefined) + Number(value.id !== undefined) === 1,
  "Provide exactly one proposed key or existing ID.",
);
const placement = z.object({
  mountKind: z.enum(["direct", "rack-top", "side", "shelf", "loose"]),
  rack: reference.optional(),
  parentDevice: reference.optional(),
  roomId: z.string().max(80).optional(),
  startU: z.number().int().min(1).max(100).optional(),
  heightU: z.number().int().min(1).max(20).optional(),
  face: z.enum(["front", "rear"]).optional(),
  column: z.number().int().min(0).max(11).optional(),
  columnSpan: z.number().int().min(1).max(12).optional(),
  side: z.enum(["left", "right"]).optional(),
  shelfX: z.number().min(0).max(1000).optional(),
  shelfY: z.number().min(0).max(1000).optional(),
  shelfWidth: z.number().min(1).max(1000).optional(),
  shelfHeight: z.number().min(1).max(1000).optional(),
  orientation: z.union([z.literal(0), z.literal(90)]).optional(),
}).strict();

export const mcpProposalSchema = z.object({
  labId: z.string().min(1).max(80),
  racks: z.array(z.object({
    key,
    name: z.string().trim().min(1).max(120),
    totalU: z.number().int().min(1).max(100).default(42),
    roomId: z.string().max(80).optional(),
  }).strict()).max(10).default([]),
  devices: z.array(z.object({
    key,
    hostname: z.string().trim().min(1).max(120),
    deviceType: z.string().min(1).max(80),
    manufacturer: z.string().max(120).optional(),
    model: z.string().max(120).optional(),
    roomId: z.string().max(80).optional(),
    placement: placement.optional(),
  }).strict()).max(100).default([]),
  ports: z.array(z.object({
    key,
    device: reference,
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["rj45", "sfp", "sfp_plus", "qsfp", "fiber", "power", "console", "usb", "virtual", "wifi", "sff", "other"]),
    speed: z.string().max(20).optional(),
    face: z.enum(["front", "rear"]).default("front"),
  }).strict()).max(500).default([]),
  connections: z.array(z.object({
    from: reference,
    to: reference,
    cableType: z.string().max(80).optional(),
    cableLength: z.string().max(40).optional(),
    label: z.string().max(120).optional(),
  }).strict()).max(250).default([]),
}).strict().refine((batch) => batch.racks.length + batch.devices.length + batch.ports.length + batch.connections.length > 0,
  "A proposal must create at least one record.");

export type McpProposalBatch = z.infer<typeof mcpProposalSchema>;
type CreatedIds = { racks: string[]; devices: string[]; ports: string[]; connections: string[] };

interface McpDraft {
  id: string;
  ownerId: string;
  labId: string;
  batch: McpProposalBatch;
  ids: CreatedIds;
  fingerprint: string;
  summary: ReturnType<typeof runBatch>;
  createdAt: string;
  expiresAt: string;
}

const DRAFT_TTL_MS = 60 * 60 * 1000;
const MAX_DRAFTS = 128;
const drafts = new Map<string, McpDraft>();

function pruneDrafts() {
  const now = Date.now();
  for (const [id, draft] of drafts) if (Date.parse(draft.expiresAt) <= now) drafts.delete(id);
}

function assertUniqueKeys(items: Array<{ key: string }>, label: string) {
  if (new Set(items.map(({ key }) => key)).size !== items.length) {
    throw new ValidationError(`Duplicate ${label} keys are not allowed.`);
  }
}

function assertLabRoom(roomId: string | undefined, labId: string) {
  if (!roomId) return null;
  const room = db.prepare("SELECT labId FROM rooms WHERE id = ?").get(roomId) as { labId: string } | undefined;
  if (!room || room.labId !== labId) throw new ValidationError("Room must belong to the proposal lab.");
  return roomId;
}

function resolveRef(ref: z.infer<typeof reference>, created: Map<string, string>, table: "racks" | "devices" | "ports", labId: string) {
  const id = ref.key ? created.get(ref.key) : ref.id;
  if (!id) throw new ValidationError(`Unknown proposed ${table} key.`);
  const row = table === "ports"
    ? db.prepare("SELECT devices.labId FROM ports JOIN devices ON devices.id = ports.deviceId WHERE ports.id = ?").get(id) as { labId: string } | undefined
    : db.prepare(`SELECT labId FROM ${table} WHERE id = ?`).get(id) as { labId: string } | undefined;
  if (!row || row.labId !== labId) throw new ValidationError(`Referenced ${table} record must belong to the proposal lab.`);
  return id;
}

function labFingerprint(labId: string) {
  const hash = createHash("sha256");
  for (const [table, sql] of [
    ["labs", "SELECT * FROM labs WHERE id = ? ORDER BY id"],
    ["rooms", "SELECT * FROM rooms WHERE labId = ? ORDER BY id"],
    ["racks", "SELECT * FROM racks WHERE labId = ? ORDER BY id"],
    ["devices", "SELECT * FROM devices WHERE labId = ? ORDER BY id"],
    ["ports", "SELECT ports.* FROM ports JOIN devices ON devices.id = ports.deviceId WHERE devices.labId = ? ORDER BY ports.id"],
    ["connections", "SELECT portLinks.* FROM portLinks JOIN ports ON ports.id = portLinks.fromPortId JOIN devices ON devices.id = ports.deviceId WHERE devices.labId = ? ORDER BY portLinks.id"],
  ] as const) {
    hash.update(table);
    hash.update(JSON.stringify(db.prepare(sql).all(labId)));
  }
  return hash.digest("hex");
}

function applyPlacement(deviceId: string, input: NonNullable<McpProposalBatch["devices"][number]["placement"]>, labId: string,
  racks: Map<string, string>, devices: Map<string, string>) {
  const rackId = input.rack ? resolveRef(input.rack, racks, "racks", labId) : null;
  const parentDeviceId = input.parentDevice ? resolveRef(input.parentDevice, devices, "devices", labId) : null;
  const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId) as RackStudioDeviceRow;
  const requested: RackStudioPlacementState = {
    mountKind: input.mountKind,
    roomId: assertLabRoom(input.roomId ?? row.roomId ?? undefined, labId), rackId, parentDeviceId,
    startU: input.startU ?? null, heightU: input.heightU ?? 1,
    face: input.face ?? "front", column: input.column ?? 0, columnSpan: input.columnSpan ?? 12,
    side: input.side ?? null, shelfX: input.shelfX ?? null, shelfY: input.shelfY ?? null,
    shelfWidth: input.shelfWidth ?? null, shelfHeight: input.shelfHeight ?? null,
    orientation: input.orientation ?? null,
  };
  const after = resolveRackStudioPlacement(row, requested);
  const rackSlot = after.columnSpan === 12 ? "full" : after.column === 6 && after.columnSpan === 6 ? "right" : "left";
  db.prepare(`UPDATE devices SET placement = ?, roomId = ?, rackId = ?, parentDeviceId = ?,
    startU = ?, heightU = ?, face = ?, rackSlot = ?, rackMountKind = ?, rackColumn = ?, rackColumnSpan = ?,
    shelfX = ?, shelfY = ?, shelfWidth = ?, shelfHeight = ?, shelfOrientation = ?, rackSide = ? WHERE id = ?`)
    .run(after.mountKind === "shelf" ? "shelf" : after.mountKind === "loose" ? "room" : "rack",
      after.roomId, after.rackId, after.parentDeviceId, after.startU, after.heightU, after.face,
      rackSlot, after.mountKind, after.column, after.columnSpan, after.shelfX, after.shelfY,
      after.shelfWidth, after.shelfHeight, after.orientation ?? 0, after.side, deviceId);
}

function runBatch(batch: McpProposalBatch, ids: CreatedIds, actor: string | null) {
  const lab = db.prepare("SELECT id FROM labs WHERE id = ?").get(batch.labId);
  if (!lab) throw new ValidationError("Proposal lab no longer exists.", 409);
  assertUniqueKeys(batch.racks, "rack");
  assertUniqueKeys(batch.devices, "device");
  assertUniqueKeys(batch.ports, "port");
  const rackIds = new Map<string, string>();
  const deviceIds = new Map<string, string>();
  const portIds = new Map<string, string>();
  const summary = { labId: batch.labId, racks: [] as Array<{ id: string; name: string }>,
    devices: [] as Array<{ id: string; hostname: string; placement: string }>,
    ports: [] as Array<{ id: string; deviceId: string; name: string }>,
    connections: [] as Array<{ id: string; fromPortId: string; toPortId: string }>,
    warnings: [] as string[] };
  for (const [index, rack] of batch.racks.entries()) {
    const roomId = assertLabRoom(rack.roomId, batch.labId);
    db.prepare("INSERT INTO racks (id, labId, name, totalU, roomId) VALUES (?, ?, ?, ?, ?)")
      .run(ids.racks[index], batch.labId, rack.name, rack.totalU, roomId);
    rackIds.set(rack.key, ids.racks[index]);
    summary.racks.push({ id: ids.racks[index], name: rack.name });
  }
  for (const [index, device] of batch.devices.entries()) {
    const deviceType = requiredDeviceType({ deviceType: device.deviceType });
    const existing = db.prepare("SELECT id FROM devices WHERE labId = ? AND hostname = ? LIMIT 1").get(batch.labId, device.hostname);
    if (existing) throw new ValidationError(`Device ${device.hostname} already exists in this lab.`, 409);
    const roomId = assertLabRoom(device.roomId, batch.labId);
    db.prepare(`INSERT INTO devices (id, labId, hostname, deviceType, manufacturer, model, placement, roomId, status, rackMountKind)
      VALUES (?, ?, ?, ?, ?, ?, 'room', ?, 'unknown', 'loose')`)
      .run(ids.devices[index], batch.labId, device.hostname, deviceType, device.manufacturer ?? null, device.model ?? null, roomId);
    if (isStackType(deviceType)) syncStackHeight(ids.devices[index]);
    deviceIds.set(device.key, ids.devices[index]);
    summary.devices.push({ id: ids.devices[index], hostname: device.hostname, placement: device.placement?.mountKind ?? "room" });
  }
  // All proposed devices exist before resolving parent or rack references.
  for (const [index, device] of batch.devices.entries()) {
    if (device.placement) applyPlacement(ids.devices[index], device.placement, batch.labId, rackIds, deviceIds);
    initializeDevicePhysicalLayout(ids.devices[index]);
  }
  for (const [index, port] of batch.ports.entries()) {
    const deviceId = resolveRef(port.device, deviceIds, "devices", batch.labId);
    const duplicate = db.prepare("SELECT id FROM ports WHERE deviceId = ? AND name = ? LIMIT 1").get(deviceId, port.name);
    if (duplicate) throw new ValidationError(`Port ${port.name} already exists on its device.`, 409);
    const next = db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS position FROM ports WHERE deviceId = ?").get(deviceId) as { position: number };
    assertPortStackMember(deviceId, null);
    db.prepare("INSERT INTO ports (id, deviceId, name, position, kind, speed, face, linkState) VALUES (?, ?, ?, ?, ?, ?, ?, 'down')")
      .run(ids.ports[index], deviceId, port.name, next.position, port.kind, port.speed ?? null, port.face);
    portIds.set(port.key, ids.ports[index]);
    summary.ports.push({ id: ids.ports[index], deviceId, name: port.name });
    reconcileDevicePhysicalLayout(deviceId);
  }
  for (const [index, connection] of batch.connections.entries()) {
    const fromPortId = resolveRef(connection.from, portIds, "ports", batch.labId);
    const toPortId = resolveRef(connection.to, portIds, "ports", batch.labId);
    if (fromPortId === toPortId) throw new ValidationError("A port cannot link to itself.");
    const fromPort = db.prepare("SELECT kind, portRole FROM ports WHERE id = ?").get(fromPortId) as { kind: string; portRole: string | null };
    const toPort = db.prepare("SELECT kind, portRole FROM ports WHERE id = ?").get(toPortId) as { kind: string; portRole: string | null };
    if (!isPhysicalCableEndpoint(fromPort.kind, fromPort.portRole) ||
        !isPhysicalCableEndpoint(toPort.kind, toPort.portRole)) {
      throw new ValidationError("Cable connections require two non-aggregate physical ports.");
    }
    if (!physicalConnectorPairIsUsual(fromPort.kind, toPort.kind)) {
      summary.warnings.push(`Unusual connector pair: ${fromPort.kind} to ${toPort.kind}.`);
    }
    const linked = db.prepare("SELECT id FROM portLinks WHERE fromPortId IN (?, ?) OR toPortId IN (?, ?) LIMIT 1")
      .get(fromPortId, toPortId, fromPortId, toPortId);
    if (linked) throw new ValidationError("A proposed connection uses an already linked port.", 409);
    db.prepare(`INSERT INTO portLinks (id, fromPortId, toPortId, cableType, cableLength, label)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(ids.connections[index], fromPortId, toPortId, connection.cableType ?? null,
        connection.cableLength ?? null, connection.label ?? null);
    db.prepare("UPDATE ports SET linkState = 'up' WHERE id IN (?, ?)").run(fromPortId, toPortId);
    summary.connections.push({ id: ids.connections[index], fromPortId, toPortId });
  }
  if (actor) {
    for (const [kind, entries] of [["rack", summary.racks], ["device", summary.devices], ["port", summary.ports], ["connection", summary.connections]] as const) {
      for (const entry of entries) writeAuditLogEntry({ user: actor, action: `mcp.proposal.${kind}.create`,
        entityType: kind, entityId: entry.id, summary: `Created ${kind} from reviewed MCP proposal.` });
    }
  }
  return summary;
}

class PreviewRollback extends Error {
  constructor(readonly summary: ReturnType<typeof runBatch>) { super("Preview rolled back."); }
}

export function createMcpProposal(ownerId: string, input: unknown) {
  const parsed = mcpProposalSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid or oversized MCP proposal.");
  const batch = parsed.data;
  const owner = getPublicUserById(ownerId);
  if (!owner || owner.disabled || !canWriteLab(owner, batch.labId, fetchUserLabAccess(owner.id))) {
    throw new ValidationError("Write access to the proposal lab is required.", 403);
  }
  pruneDrafts();
  if (drafts.size >= MAX_DRAFTS) throw new ValidationError("Too many pending MCP proposals.", 429);
  const ids: CreatedIds = {
    racks: batch.racks.map(() => createId("rack")), devices: batch.devices.map(() => createId("d")),
    ports: batch.ports.map(() => createId("p")), connections: batch.connections.map(() => createId("l")),
  };
  const fingerprint = labFingerprint(batch.labId);
  let summary: ReturnType<typeof runBatch> | null = null;
  try {
    db.transaction(() => { throw new PreviewRollback(runBatch(batch, ids, null)); }).immediate();
  } catch (error) {
    if (error instanceof PreviewRollback) summary = error.summary;
    else throw error;
  }
  if (!summary) throw new Error("MCP proposal preview failed.");
  const createdAt = new Date().toISOString();
  const draft: McpDraft = { id: createId("draft"), ownerId, labId: batch.labId, batch, ids, fingerprint,
    summary, createdAt, expiresAt: new Date(Date.now() + DRAFT_TTL_MS).toISOString() };
  drafts.set(draft.id, draft);
  return publicDraft(draft);
}

function publicDraft(draft: McpDraft) {
  return { id: draft.id, labId: draft.labId, summary: draft.summary,
    createdAt: draft.createdAt, expiresAt: draft.expiresAt,
    reviewLink: `/mcp-proposals/${draft.id}` };
}

export function listMcpProposals(ownerId: string) {
  pruneDrafts();
  const owner = getPublicUserById(ownerId);
  if (!owner || owner.disabled) return [];
  const access = fetchUserLabAccess(owner.id);
  return [...drafts.values()]
    .filter((draft) => draft.ownerId === ownerId && canWriteLab(owner, draft.labId, access))
    .map(publicDraft);
}

export function getMcpProposal(ownerId: string, id: string) {
  pruneDrafts();
  const draft = drafts.get(id);
  if (!draft || draft.ownerId !== ownerId) return null;
  const owner = getPublicUserById(ownerId);
  if (!owner || owner.disabled || !canWriteLab(owner, draft.labId, fetchUserLabAccess(owner.id))) return null;
  return { ...publicDraft(draft), batch: draft.batch };
}

export function applyMcpProposal(ownerId: string, id: string) {
  pruneDrafts();
  const draft = drafts.get(id);
  if (!draft || draft.ownerId !== ownerId) throw new ValidationError("Proposal not found or expired.", 404);
  const owner = getPublicUserById(ownerId);
  if (!owner || owner.disabled || !canWriteLab(owner, draft.labId, fetchUserLabAccess(owner.id))) {
    throw new ValidationError("Write access to this lab is required.", 403);
  }
  if (labFingerprint(draft.labId) !== draft.fingerprint) {
    drafts.delete(id);
    throw new ValidationError("Inventory changed since preview. Create a new proposal.", 409);
  }
  const summary = db.transaction(() => runBatch(draft.batch, draft.ids, owner.username)).immediate();
  drafts.delete(id);
  return summary;
}
