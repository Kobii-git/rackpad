import { parseCableRouteMode, decodeCableRouteGuides, assertCableGuideReferences } from "./cable-routing.js";
import { validateStackIntegrity } from "./stack-integrity.js";
import type Database from "better-sqlite3";
import { CURRENT_SCHEMA_VERSION } from "../schema-version.js";

export const CURRENT_RACKPAD_SCHEMA_COLUMNS = {
  appSettings: ["key", "value", "updatedAt"],
  auditLog: ["id", "ts", "user", "action", "entityType", "entityId", "summary"],
  deviceImages: [
    "id",
    "deviceId",
    "label",
    "fileName",
    "mimeType",
    "dataUrl",
    "notes",
    "createdAt",
    "updatedAt",
  ],
  deviceMonitors: [
    "id",
    "deviceId",
    "name",
    "type",
    "target",
    "port",
    "path",
    "intervalMs",
    "enabled",
    "sortOrder",
    "lastCheckAt",
    "lastResult",
    "lastMessage",
    "lastAlertAt",
    "snmpVersion",
    "snmpCommunity",
    "snmpOid",
    "snmpExpectedValue",
    "portId",
    "snmpIfIndex",
    "snmpMatchMode",
    "snmpCredentialId",
    "ignoreTlsErrors",
    "snmpCommunityEnc",
  ],
  deviceServices: [
    "id",
    "deviceId",
    "name",
    "serviceType",
    "ipAssignmentId",
    "portId",
    "vlanId",
    "monitorId",
    "url",
    "notes",
    "createdAt",
    "updatedAt",
  ],
  devicePhysicalLayouts: [
    "deviceId",
    "sourceTemplateId",
    "status",
    "snapshot",
    "bindings",
    "portFingerprint",
    "createdAt",
    "updatedAt",
  ],
  deviceStackMembers: ["id", "deviceId", "position", "name", "manufacturer", "model", "serial", "heightU", "status", "notes"],
  deviceStackMemberMacs: ["memberId", "label", "macAddress"],
  devices: [
    "id",
    "labId",
    "rackId",
    "hostname",
    "displayName",
    "deviceType",
    "manufacturer",
    "model",
    "serial",
    "managementIp",
    "status",
    "startU",
    "heightU",
    "face",
    "tags",
    "notes",
    "lastSeen",
    "placement",
    "parentDeviceId",
    "cpuCores",
    "memoryGb",
    "storageGb",
    "specs",
    "roomId",
    "macAddress",
    "networkMode",
    "snmpCredentialId",
    "rackSlot",
    "ignoreDuplicateMac",
    "rackMountKind",
    "rackColumn",
    "rackColumnSpan",
    "shelfX",
    "shelfY",
    "shelfWidth",
    "shelfHeight",
    "shelfOrientation",
    "rackSide",
  ],
  dhcpScopes: [
    "id",
    "subnetId",
    "name",
    "startIp",
    "endIp",
    "gateway",
    "dnsServers",
    "description",
  ],
  discoveredDevices: [
    "id",
    "labId",
    "ipAddress",
    "hostname",
    "displayName",
    "deviceType",
    "placement",
    "source",
    "status",
    "notes",
    "importedDeviceId",
    "lastSeen",
    "lastScannedAt",
    "macAddress",
    "vendor",
    "technicalRole",
    "technicalReason",
    "placementHint",
  ],
  discoveryScanSchedules: [
    "id",
    "labId",
    "name",
    "cidr",
    "intervalMs",
    "enabled",
    "lastRunAt",
    "lastResult",
    "lastMessage",
    "createdAt",
    "updatedAt",
  ],
  dockerContainerLinks: [
    "deviceId",
    "sourceId",
    "containerId",
    "containerName",
    "image",
    "state",
    "status",
    "lastSyncedAt",
    "createdAt",
    "updatedAt",
  ],
  dockerImportSources: [
    "id",
    "labId",
    "name",
    "endpoint",
    "tokenEnc",
    "lastSyncAt",
    "lastSyncStatus",
    "lastSyncMessage",
    "createdAt",
    "updatedAt",
    "enabled",
    "verifyTls",
  ],
  integrationConnections: [
    "id",
    "labId",
    "provider",
    "name",
    "baseUrl",
    "authKind",
    "authId",
    "authSecretEnc",
    "siteRef",
    "verifyTls",
    "enabled",
    "syncVlans",
    "syncSubnets",
    "syncDhcp",
    "lastStatus",
    "lastCheckedAt",
    "lastError",
    "lastSummary",
    "createdAt",
    "updatedAt",
    "autoSyncEnabled",
    "autoSyncMode",
    "autoSyncCron",
    "autoSyncLabIds",
    "autoSyncFailureCount",
    "autoSyncPausedUntil",
    "lastAutoSyncAt",
    "lastAutoSyncStatus",
    "lastAutoSyncMessage",
    "scopeRefs",
    "syncDevices",
    "syncWifi",
    "syncSwitches",
    "syncGateways",
    "syncAccessPoints",
    "syncHosts",
    "syncGuests",
  ],
  integrationSyncSchedules: [
    "id",
    "connectionId",
    "name",
    "enabled",
    "mode",
    "cron",
    "labIds",
    "failureCount",
    "pausedUntil",
    "lastRunAt",
    "lastRunStatus",
    "lastRunMessage",
    "createdAt",
    "updatedAt",
  ],
  documentationDeviceLinks: [
    "id",
    "documentationPageId",
    "deviceId",
    "createdAt",
  ],
  documentationPages: [
    "id",
    "labId",
    "title",
    "content",
    "createdAt",
    "updatedAt",
  ],
  driveBayTemplates: [
    "id",
    "name",
    "description",
    "deviceTypes",
    "sections",
    "createdAt",
    "updatedAt",
  ],
  driveSlots: [
    "id",
    "deviceId",
    "name",
    "sectionName",
    "sectionOrder",
    "position",
    "slotType",
    "face",
    "layout",
    "columns",
    "driveId",
    "createdAt",
    "updatedAt",
  ],
  hardwareTemplateDefaults: ["deviceType", "templateId", "updatedAt"],
  hardwareTemplates: [
    "id",
    "name",
    "description",
    "category",
    "deviceTypes",
    "definition",
    "createdAt",
    "updatedAt",
  ],
  ipAssignments: [
    "id",
    "subnetId",
    "ipAddress",
    "assignmentType",
    "deviceId",
    "portId",
    "vmId",
    "containerId",
    "hostname",
    "description",
    "allocationMode",
    "dhcpScopeId",
  ],
  ipZones: ["id", "subnetId", "kind", "startIp", "endIp", "description"],
  labs: ["id", "name", "description", "location"],
  oidcIdentities: [
    "issuer",
    "subject",
    "userId",
    "email",
    "displayName",
    "createdAt",
    "updatedAt",
    "roleRecheckRequired",
  ],
  portLinks: [
    "id",
    "fromPortId",
    "toPortId",
    "cableType",
    "cableLength",
    "color",
    "notes",
    "label",
    "visible",
    "routeWaypoints",
    "routeMode",
    "routeGuides",
  ],
  portTemplates: [
    "id",
    "name",
    "description",
    "deviceTypes",
    "ports",
    "createdAt",
    "updatedAt",
  ],
  ports: [
    "id",
    "deviceId",
    "name",
    "position",
    "kind",
    "speed",
    "linkState",
    "vlanId",
    "description",
    "face",
    "mode",
    "allowedVlanIds",
    "virtualSwitchId",
    "snmpIfIndex",
    "macAddress",
    "portRole",
    "aggregatePortId",
    "stackMemberId",
  ],
  racks: [
    "id",
    "labId",
    "name",
    "totalU",
    "description",
    "location",
    "notes",
    "roomId",
    "studioX",
    "studioY",
  ],
  referenceImages: [
    "id",
    "labId",
    "entityType",
    "entityId",
    "label",
    "fileName",
    "mimeType",
    "dataUrl",
    "face",
    "notes",
    "createdAt",
    "updatedAt",
  ],
  rooms: ["id", "labId", "name", "description", "location", "notes"],
  schemaVersion: ["id", "version", "updatedAt"],
  snmpCredentials: [
    "id",
    "labId",
    "name",
    "version",
    "communityEnc",
    "v3User",
    "v3AuthProto",
    "v3AuthPassEnc",
    "v3PrivProto",
    "v3PrivPassEnc",
    "v3Context",
    "createdAt",
    "updatedAt",
  ],
  snmpSyncSchedules: [
    "id",
    "labId",
    "deviceId",
    "profileId",
    "policy",
    "intervalMs",
    "enabled",
    "lastRunAt",
    "lastResult",
    "lastMessage",
    "createdAt",
    "updatedAt",
  ],
  snmpTrapLog: [
    "id",
    "labId",
    "deviceId",
    "sourceIp",
    "trapOid",
    "ifIndex",
    "varbindsJson",
    "resultAction",
    "message",
    "receivedAt",
  ],
  snmpTrapSources: [
    "id",
    "labId",
    "deviceId",
    "sourceIp",
    "community",
    "credentialId",
    "lastTrapAt",
  ],
  storageDrives: [
    "id",
    "labId",
    "manufacturer",
    "model",
    "serial",
    "capacityGb",
    "interface",
    "formFactor",
    "notes",
    "createdAt",
    "updatedAt",
  ],
  storagePoolDrives: ["poolId", "driveId", "createdAt"],
  storagePools: [
    "id",
    "deviceId",
    "name",
    "poolType",
    "usableCapacityGb",
    "status",
    "notes",
    "createdAt",
    "updatedAt",
  ],
  subnets: [
    "id",
    "labId",
    "cidr",
    "name",
    "description",
    "vlanId",
    "gateway",
    "dnsServers",
  ],
  userLabAccess: ["userId", "labId", "role"],
  users: [
    "id",
    "username",
    "displayName",
    "passwordHash",
    "role",
    "disabled",
    "createdAt",
    "lastLoginAt",
  ],
  userSessions: ["id", "userId", "tokenHash", "createdAt", "expiresAt"],
  virtualSwitches: [
    "id",
    "hostDeviceId",
    "name",
    "notes",
    "kind",
    "membersShareHostIp",
  ],
  vlanRanges: [
    "id",
    "labId",
    "name",
    "startVlan",
    "endVlan",
    "purpose",
    "color",
  ],
  vlans: ["id", "labId", "vlanId", "name", "description", "color"],
  wifiAccessPoints: [
    "deviceId",
    "controllerId",
    "location",
    "firmwareVersion",
    "notes",
  ],
  wifiClientAssociations: [
    "clientDeviceId",
    "apDeviceId",
    "radioId",
    "ssidId",
    "band",
    "channel",
    "signalDbm",
    "lastSeen",
    "lastRoamAt",
    "notes",
  ],
  wifiControllers: [
    "id",
    "labId",
    "deviceId",
    "name",
    "vendor",
    "model",
    "managementIp",
    "notes",
  ],
  wifiRadioSsids: ["radioId", "ssidId"],
  wifiRadios: [
    "id",
    "apDeviceId",
    "slotName",
    "band",
    "channel",
    "channelWidth",
    "txPower",
    "notes",
  ],
  wifiSsids: [
    "id",
    "labId",
    "name",
    "purpose",
    "security",
    "hidden",
    "vlanId",
    "color",
  ],
} as const;

export class RackpadSqliteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RackpadSqliteValidationError";
  }
}

export function validateRackpadSqliteDatabase(
  database: Database.Database,
  label: string,
) {
  const integrity = database.pragma("integrity_check") as Array<{
    integrity_check: string;
  }>;
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new RackpadSqliteValidationError(
      `${label} failed SQLite integrity validation.`,
    );
  }

  const schema = database
    .prepare("SELECT version FROM schemaVersion WHERE id = 1")
    .get() as { version: number } | undefined;
  if (
    !schema ||
    !Number.isInteger(schema.version) ||
    (schema.version < 50 || schema.version > CURRENT_SCHEMA_VERSION)
  ) {
    throw new RackpadSqliteValidationError(
      `${label} schema is not supported by this Rackpad version.`,
    );
  }

  if (schema.version === 50) {
    const stackObjects = database.prepare("SELECT name FROM sqlite_master WHERE name IN ('deviceStackMembers', 'deviceStackMemberMacs', 'ports_stack_owner_insert', 'ports_stack_owner_update', 'stack_member_device_immutable', 'stack_type_guard', 'stack_height_guard', 'stack_device_delete', 'idx_ports_stack_member')").all();
    const stackColumn = (database.prepare('PRAGMA table_info(ports)').all() as Array<{ name: string }>).some(row => row.name === 'stackMemberId');
    if (stackObjects.length || stackColumn) throw new RackpadSqliteValidationError(`${label} has inconsistent schema 50 stack objects.`);
  }
  if (schema.version < 52) {
    const routeColumns = database.prepare("PRAGMA table_info(portLinks)").all() as Array<{ name: string }>;
    const triggers = database.prepare("SELECT name FROM sqlite_master WHERE name IN ('cable_guide_device_delete', 'cable_guide_device_room', 'cable_guide_rack_room')").all();
    if (triggers.length || routeColumns.some(column => column.name === "routeMode" || column.name === "routeGuides")) {
      throw new RackpadSqliteValidationError(`${label} has inconsistent legacy routing schema.`);
    }
  }
  const missingSchema: string[] = [];
  for (const [table, requiredColumns] of Object.entries(
    CURRENT_RACKPAD_SCHEMA_COLUMNS,
  )) {
    if (schema.version === 50 && (table === "deviceStackMembers" || table === "deviceStackMemberMacs")) continue;
    const columns = new Set(
      (
        database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    if (columns.size === 0) {
      missingSchema.push(table);
      continue;
    }
    for (const column of requiredColumns) {
      if (schema.version === 50 && table === "ports" && column === "stackMemberId") continue;
      if (schema.version < 52 && table === "portLinks" && (column === "routeMode" || column === "routeGuides")) continue;
      if (!columns.has(column)) missingSchema.push(`${table}.${column}`);
    }
  }
  if (missingSchema.length > 0) {
    throw new RackpadSqliteValidationError(
      `${label} is missing required Rackpad schema: ${missingSchema.join(", ")}.`,
    );
  }

  const foreignKeyFailures = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeyFailures.length > 0) {
    throw new RackpadSqliteValidationError(
      `${label} failed foreign-key validation.`,
    );
  }

  try { if (schema.version >= 51) validateStackIntegrity(database); } catch (error) {
    throw new RackpadSqliteValidationError(`${label} failed stack integrity validation: ${error instanceof Error ? error.message : "invalid stack"}`);
  }
  if (schema.version >= 52) {
    try {
      const links = database.prepare(`SELECT portLinks.routeMode, portLinks.routeGuides, a.labId AS fromLabId, b.labId AS toLabId
        FROM portLinks JOIN ports p ON p.id = portLinks.fromPortId JOIN devices a ON a.id = p.deviceId
        JOIN ports q ON q.id = portLinks.toPortId JOIN devices b ON b.id = q.deviceId`).all() as Array<{routeMode: unknown; routeGuides: unknown; fromLabId: string; toLabId: string}>;
      for (const link of links) {
        parseCableRouteMode(link.routeMode);
        assertCableGuideReferences(decodeCableRouteGuides(link.routeGuides), [link.fromLabId, link.toLabId],
          id => database.prepare(`SELECT devices.labId, COALESCE(racks.roomId, devices.roomId) AS roomId
            FROM devices LEFT JOIN racks ON racks.id = devices.rackId WHERE devices.id = ?`).get(id) as {labId: string; roomId: string | null} | undefined,
          id => database.prepare("SELECT labId FROM rooms WHERE id = ?").get(id) as {labId: string} | undefined);
      }
    } catch { throw new RackpadSqliteValidationError(`${label} has invalid cable routing metadata.`); }
  }
  return schema.version;
}
