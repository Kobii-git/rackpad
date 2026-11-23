import type Database from "better-sqlite3";

// Code-owned queries only. Audit ownership is a snapshot, never a foreign key to
// an inventory row which may subsequently move or be deleted.
const QUERIES: Record<string, string> = {
  Lab: "SELECT id AS labId FROM labs WHERE id = ?",
  ...Object.fromEntries(
    Object.entries({
      Rack: "racks",
      Room: "rooms",
      Device: "devices",
      Vlan: "vlans",
      VlanRange: "vlanRanges",
      Subnet: "subnets",
      DiscoveredDevice: "discoveredDevices",
      DiscoveryScanSchedule: "discoveryScanSchedules",
      DocumentationPage: "documentationPages",
      ReferenceImage: "referenceImages",
      StorageDrive: "storageDrives",
      WifiController: "wifiControllers",
      WifiSsid: "wifiSsids",
      SnmpCredential: "snmpCredentials",
      SnmpSyncSchedule: "snmpSyncSchedules",
      IntegrationConnection: "integrationConnections",
    }).map(([type, table]) => [
      type,
      `SELECT labId FROM ${table} WHERE id = ?`,
    ]),
  ),
  ...Object.fromEntries(
    Object.entries({
      Port: ["ports", "deviceId", "id"],
      VirtualSwitch: ["virtualSwitches", "hostDeviceId", "id"],
      DriveSlot: ["driveSlots", "deviceId", "id"],
      StoragePool: ["storagePools", "deviceId", "id"],
      DeviceMonitor: ["deviceMonitors", "deviceId", "id"],
      DeviceImage: ["deviceImages", "deviceId", "id"],
      DeviceService: ["deviceServices", "deviceId", "id"],
      WifiAccessPoint: ["wifiAccessPoints", "deviceId", "deviceId"],
      WifiRadio: ["wifiRadios", "apDeviceId", "id"],
      DeviceStackMember: ["deviceStackMembers", "deviceId", "id"],
    }).map(([type, [table, parent, key]]) => [
      type,
      `SELECT devices.labId FROM ${table} JOIN devices ON devices.id = ${table}.${parent} WHERE ${table}.${key} = ?`,
    ]),
  ),
  ...Object.fromEntries(
    Object.entries({
      DhcpScope: "dhcpScopes",
      IpZone: "ipZones",
      IpAssignment: "ipAssignments",
    }).map(([type, table]) => [
      type,
      `SELECT subnets.labId FROM ${table} JOIN subnets ON subnets.id = ${table}.subnetId WHERE ${table}.id = ?`,
    ]),
  ),
  PortLink: `SELECT DISTINCT devices.labId FROM portLinks
    JOIN ports ON ports.id IN (portLinks.fromPortId, portLinks.toPortId)
    JOIN devices ON devices.id = ports.deviceId WHERE portLinks.id = ?`,
  WifiClientAssociation: `SELECT DISTINCT devices.labId FROM wifiClientAssociations
    JOIN devices ON devices.id IN (wifiClientAssociations.clientDeviceId, wifiClientAssociations.apDeviceId)
    WHERE wifiClientAssociations.clientDeviceId = ?`,
  IntegrationSyncSchedule: `SELECT integrationConnections.labId FROM integrationSyncSchedules
    JOIN integrationConnections ON integrationConnections.id = integrationSyncSchedules.connectionId WHERE integrationSyncSchedules.id = ?`,
  ...Object.fromEntries(
    Object.entries({
      User: ["users", "id"],
      PortTemplate: ["portTemplates", "id"],
      DriveBayTemplate: ["driveBayTemplates", "id"],
      HardwareTemplate: ["hardwareTemplates", "id"],
      HardwareTemplateDefault: ["hardwareTemplateDefaults", "deviceType"],
    }).map(([type, [table, key]]) => [
      type,
      `SELECT NULL AS labId FROM ${table} WHERE ${key} = ?`,
    ]),
  ),
};

export function resolveAuditLabIds(
  database: Database.Database,
  type: string,
  id: string,
): string[] | null {
  if (type === "DeviceType") return [];
  if (!Object.hasOwn(QUERIES, type)) return null;
  const sql = QUERIES[type];
  const rows = database.prepare(sql).all(id) as Array<{ labId: string | null }>;
  return rows.length
    ? [...new Set(rows.flatMap((row) => (row.labId ? [row.labId] : [])))].sort()
    : null;
}

export function parseAuditLabIds(value: unknown): string[] | null {
  if (value == null) return null;
  if (typeof value === "string") {
    if (value.length > 16384) throw new Error("Invalid audit lab scope.");
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("Invalid audit lab scope.");
    }
  }
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (id) => typeof id !== "string" || !id.trim() || id.length > 120,
    ) ||
    new Set(value).size !== value.length
  )
    throw new Error("Invalid audit lab scope.");
  return [...value].sort() as string[];
}

export function captureUnscopedAudit(database: Database.Database) {
  return (
    database
      .prepare(
        "SELECT id, entityType, entityId FROM auditLog WHERE labIds IS NULL",
      )
      .all() as Array<{ id: string; entityType: string; entityId: string }>
  ).flatMap((row) => {
    const labs = resolveAuditLabIds(database, row.entityType, row.entityId);
    return labs === null ? [] : [{ id: row.id, labIds: JSON.stringify(labs) }];
  });
}

export function backfillAuditScopes(database: Database.Database) {
  const update = database.prepare(
    "UPDATE auditLog SET labIds = ? WHERE id = ? AND labIds IS NULL",
  );
  for (const row of captureUnscopedAudit(database))
    update.run(row.labIds, row.id);
}
