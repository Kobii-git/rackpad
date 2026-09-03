import { db, parseRow } from "../db.js";
import { deviceTypeBase, deviceTypeLineage } from "./device-types.js";
import {
  BUILT_IN_HARDWARE_TEMPLATES,
  buildAutoPhysicalLayout,
  isPhysicalLayoutPort,
  portSetFingerprint,
  proposePhysicalPortBindings,
  reconcilePhysicalLayoutBindings,
  resolveTemplateSnapshot,
  validateHardwareTemplateV1,
  type HardwareTemplateV1,
  type PhysicalLayoutDevice,
  type PhysicalLayoutPort,
  type PhysicalLayoutStatus,
  type PortBindingV1,
  type ResolvedPhysicalLayoutV1,
} from "./physical-layout.js";

export interface DevicePhysicalLayoutRow {
  deviceId: string;
  sourceTemplateId: string | null;
  status: PhysicalLayoutStatus;
  snapshot: string;
  bindings: string;
  portFingerprint: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhysicalLayoutDeviceRow extends PhysicalLayoutDevice {
  labId: string;
}

const EPHEMERAL_LAYOUT_TIMESTAMP = "1970-01-01T00:00:00.000Z";

export function isPhysicalLayoutDevice(device: PhysicalLayoutDevice) {
  const baseType = deviceTypeBase(device.deviceType);
  return (
    device.placement !== "virtual" &&
    baseType !== "vm" &&
    baseType !== "container"
  );
}

export function getPhysicalLayoutDevice(deviceId: string) {
  return db
    .prepare(
      `
        SELECT id, labId, deviceType, heightU, rackSlot, placement
        FROM devices
        WHERE id = ?
      `,
    )
    .get(deviceId) as PhysicalLayoutDeviceRow | undefined;
}

export function getPhysicalLayoutPorts(deviceId: string) {
  return (
    db
      .prepare(
        `
          SELECT id, name, position, kind, face, portRole
          FROM ports
          WHERE deviceId = ?
          ORDER BY position, id
        `,
      )
      .all(deviceId) as PhysicalLayoutPort[]
  ).filter(isPhysicalLayoutPort);
}

function parseStoredTemplate(row: Record<string, unknown>) {
  const parsed = parseRow(row, ["definition"]);
  return validateHardwareTemplateV1(parsed.definition);
}

export function getPhysicalHardwareTemplate(templateId: string) {
  const builtIn = BUILT_IN_HARDWARE_TEMPLATES.find(
    (template) => template.id === templateId,
  );
  if (builtIn) return builtIn;
  const row = db
    .prepare("SELECT definition FROM hardwareTemplates WHERE id = ?")
    .get(templateId) as Record<string, unknown> | undefined;
  return row ? parseStoredTemplate(row) : null;
}

function resolveInitialLayout(
  device: PhysicalLayoutDeviceRow,
  ports: PhysicalLayoutPort[],
  fallbackMode: "legacy" | "generic",
) {
  const selectDefault = db.prepare(
    "SELECT templateId FROM hardwareTemplateDefaults WHERE deviceType = ?",
  );
  let defaultRow: { templateId: string } | undefined;
  for (const deviceType of deviceTypeLineage(device.deviceType)) {
    defaultRow = selectDefault.get(deviceType) as
      | { templateId: string }
      | undefined;
    if (defaultRow) break;
  }
  const template = defaultRow
    ? getPhysicalHardwareTemplate(defaultRow.templateId)
    : null;
  const autoMode =
    template?.id === "legacy-auto-v1"
      ? "legacy"
      : template?.id === "generic-auto-v1" || !template
        ? fallbackMode
        : null;
  if (autoMode) return buildAutoPhysicalLayout(device, ports, autoMode);

  const snapshot = resolveTemplateSnapshot(template!, device);
  const mapping = proposePhysicalPortBindings(snapshot, ports);
  return {
    snapshot,
    bindings: mapping.bindings,
    status: (mapping.unmappedPortIds.length > 0
      ? "needs-mapping"
      : "accurate") as PhysicalLayoutStatus,
  };
}

function generatedLayoutRow(
  device: PhysicalLayoutDeviceRow,
  ports: PhysicalLayoutPort[],
  fallbackMode: "legacy" | "generic",
): DevicePhysicalLayoutRow {
  const generated = resolveInitialLayout(device, ports, fallbackMode);
  return {
    deviceId: device.id,
    sourceTemplateId: generated.snapshot.sourceTemplateId,
    status: generated.status,
    snapshot: JSON.stringify(generated.snapshot),
    bindings: JSON.stringify(generated.bindings),
    portFingerprint: portSetFingerprint(ports),
    createdAt: EPHEMERAL_LAYOUT_TIMESTAMP,
    updatedAt: EPHEMERAL_LAYOUT_TIMESTAMP,
  };
}

export function readDevicePhysicalLayoutRow(
  device: PhysicalLayoutDeviceRow,
  ports: PhysicalLayoutPort[],
) {
  return (
    (db
      .prepare("SELECT * FROM devicePhysicalLayouts WHERE deviceId = ?")
      .get(device.id) as DevicePhysicalLayoutRow | undefined) ??
    generatedLayoutRow(device, ports, "generic")
  );
}

export function parseDevicePhysicalLayoutRow(
  row: DevicePhysicalLayoutRow,
  ports: PhysicalLayoutPort[],
) {
  const parsed = parseRow(row as unknown as Record<string, unknown>, [
    "snapshot",
    "bindings",
  ]) as unknown as Omit<DevicePhysicalLayoutRow, "snapshot" | "bindings"> & {
    snapshot: ResolvedPhysicalLayoutV1;
    bindings: PortBindingV1[];
  };
  const reconciled = reconcilePhysicalLayoutBindings({
    snapshot: parsed.snapshot,
    bindings: parsed.bindings,
    status: parsed.status,
    sourceTemplateId: parsed.sourceTemplateId,
    ports,
  });
  return {
    ...parsed,
    bindings: reconciled.bindings,
    effectiveStatus: reconciled.status,
    unmappedPortIds: reconciled.unmappedPortIds,
    currentPortFingerprint: reconciled.portFingerprint,
  };
}

export function readDevicePhysicalLayout(
  device: PhysicalLayoutDeviceRow,
  ports: PhysicalLayoutPort[],
) {
  return parseDevicePhysicalLayoutRow(
    readDevicePhysicalLayoutRow(device, ports),
    ports,
  );
}

export function initializeDevicePhysicalLayout(
  deviceId: string,
  fallbackMode: "legacy" | "generic" = "generic",
) {
  const device = getPhysicalLayoutDevice(deviceId);
  if (!device || !isPhysicalLayoutDevice(device)) return null;
  const existing = db
    .prepare("SELECT * FROM devicePhysicalLayouts WHERE deviceId = ?")
    .get(deviceId) as DevicePhysicalLayoutRow | undefined;
  if (existing) return existing;
  const ports = getPhysicalLayoutPorts(deviceId);
  const row = generatedLayoutRow(device, ports, fallbackMode);
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO devicePhysicalLayouts
        (deviceId, sourceTemplateId, status, snapshot, bindings, portFingerprint, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    row.deviceId,
    row.sourceTemplateId,
    row.status,
    row.snapshot,
    row.bindings,
    row.portFingerprint,
    now,
    now,
  );
  return db
    .prepare("SELECT * FROM devicePhysicalLayouts WHERE deviceId = ?")
    .get(deviceId) as DevicePhysicalLayoutRow;
}

export function reconcileDevicePhysicalLayout(deviceId: string) {
  const device = getPhysicalLayoutDevice(deviceId);
  if (!device || !isPhysicalLayoutDevice(device)) return null;
  const existing = db
    .prepare("SELECT * FROM devicePhysicalLayouts WHERE deviceId = ?")
    .get(deviceId) as DevicePhysicalLayoutRow | undefined;
  if (!existing) return initializeDevicePhysicalLayout(deviceId);

  const ports = getPhysicalLayoutPorts(deviceId);
  const parsed = parseRow(existing as unknown as Record<string, unknown>, [
    "snapshot",
    "bindings",
  ]) as unknown as Omit<DevicePhysicalLayoutRow, "snapshot" | "bindings"> & {
    snapshot: ResolvedPhysicalLayoutV1;
    bindings: PortBindingV1[];
  };
  const reconciled = reconcilePhysicalLayoutBindings({
    snapshot: parsed.snapshot,
    bindings: parsed.bindings,
    status: parsed.status,
    sourceTemplateId: parsed.sourceTemplateId,
    ports,
  });
  const bindings = JSON.stringify(reconciled.bindings);
  if (
    bindings === JSON.stringify(parsed.bindings) &&
    reconciled.status === parsed.status &&
    reconciled.portFingerprint === parsed.portFingerprint
  ) {
    return existing;
  }

  const updatedAt = new Date().toISOString();
  db.prepare(
    `
      UPDATE devicePhysicalLayouts
      SET status = ?, bindings = ?, portFingerprint = ?, updatedAt = ?
      WHERE deviceId = ?
    `,
  ).run(
    reconciled.status,
    bindings,
    reconciled.portFingerprint,
    updatedAt,
    deviceId,
  );
  return db
    .prepare("SELECT * FROM devicePhysicalLayouts WHERE deviceId = ?")
    .get(deviceId) as DevicePhysicalLayoutRow;
}

export function listPhysicalHardwareTemplates(): HardwareTemplateV1[] {
  const custom = (
    db
      .prepare("SELECT definition FROM hardwareTemplates ORDER BY name, id")
      .all() as Record<string, unknown>[]
  ).map(parseStoredTemplate);
  return [...BUILT_IN_HARDWARE_TEMPLATES, ...custom];
}
