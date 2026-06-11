import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createId } from "./lib/ids.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH =
  process.env.DATABASE_PATH ?? path.resolve(__dirname, "../rackpad.db");
const CURRENT_SCHEMA_VERSION = 27;

export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const BOOTSTRAP_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS schemaVersion (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    version   INTEGER NOT NULL,
    updatedAt TEXT NOT NULL
  );
`;

const SCHEMA_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS labs (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        location    TEXT
      );

      CREATE TABLE IF NOT EXISTS racks (
        id          TEXT PRIMARY KEY,
        labId       TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        totalU      INTEGER NOT NULL DEFAULT 42,
        description TEXT,
        location    TEXT,
        notes       TEXT
      );

      CREATE TABLE IF NOT EXISTS devices (
        id           TEXT PRIMARY KEY,
        labId        TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        rackId       TEXT REFERENCES racks(id) ON DELETE SET NULL,
        hostname     TEXT NOT NULL,
        displayName  TEXT,
        deviceType   TEXT NOT NULL,
        manufacturer TEXT,
        model        TEXT,
        serial       TEXT,
        managementIp TEXT,
        status       TEXT NOT NULL DEFAULT 'unknown',
        startU       INTEGER,
        heightU      INTEGER,
        face         TEXT,
        tags         TEXT,
        notes        TEXT,
        lastSeen     TEXT
      );

      CREATE TABLE IF NOT EXISTS vlans (
        id          TEXT PRIMARY KEY,
        labId       TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        vlanId      INTEGER NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT
      );

      CREATE TABLE IF NOT EXISTS vlanRanges (
        id        TEXT PRIMARY KEY,
        labId     TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        name      TEXT NOT NULL,
        startVlan INTEGER NOT NULL,
        endVlan   INTEGER NOT NULL,
        purpose   TEXT,
        color     TEXT
      );

      CREATE TABLE IF NOT EXISTS ports (
        id          TEXT PRIMARY KEY,
        deviceId    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        position    INTEGER NOT NULL,
        kind        TEXT NOT NULL,
        speed       TEXT,
        linkState   TEXT NOT NULL DEFAULT 'unknown',
        vlanId      TEXT REFERENCES vlans(id) ON DELETE SET NULL,
        description TEXT,
        face        TEXT
      );

      CREATE TABLE IF NOT EXISTS portLinks (
        id          TEXT PRIMARY KEY,
        fromPortId  TEXT NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
        toPortId    TEXT NOT NULL REFERENCES ports(id) ON DELETE CASCADE,
        cableType   TEXT,
        cableLength TEXT,
        color       TEXT,
        notes       TEXT
      );

      CREATE TABLE IF NOT EXISTS subnets (
        id          TEXT PRIMARY KEY,
        labId       TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        cidr        TEXT NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        vlanId      TEXT REFERENCES vlans(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS dhcpScopes (
        id          TEXT PRIMARY KEY,
        subnetId    TEXT NOT NULL REFERENCES subnets(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        startIp     TEXT NOT NULL,
        endIp       TEXT NOT NULL,
        gateway     TEXT,
        dnsServers  TEXT,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS ipZones (
        id          TEXT PRIMARY KEY,
        subnetId    TEXT NOT NULL REFERENCES subnets(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        startIp     TEXT NOT NULL,
        endIp       TEXT NOT NULL,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS ipAssignments (
        id             TEXT PRIMARY KEY,
        subnetId       TEXT NOT NULL REFERENCES subnets(id) ON DELETE CASCADE,
        ipAddress      TEXT NOT NULL,
        assignmentType TEXT NOT NULL,
        deviceId       TEXT REFERENCES devices(id) ON DELETE SET NULL,
        portId         TEXT REFERENCES ports(id) ON DELETE SET NULL,
        vmId           TEXT,
        containerId    TEXT,
        hostname       TEXT,
        description    TEXT
      );

      CREATE TABLE IF NOT EXISTS auditLog (
        id         TEXT PRIMARY KEY,
        ts         TEXT NOT NULL,
        user       TEXT NOT NULL,
        action     TEXT NOT NULL,
        entityType TEXT NOT NULL,
        entityId   TEXT NOT NULL,
        summary    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id           TEXT PRIMARY KEY,
        username     TEXT NOT NULL,
        displayName  TEXT NOT NULL,
        passwordHash TEXT NOT NULL,
        role         TEXT NOT NULL,
        disabled     INTEGER NOT NULL DEFAULT 0,
        createdAt    TEXT NOT NULL,
        lastLoginAt  TEXT
      );

      CREATE TABLE IF NOT EXISTS userSessions (
        id         TEXT PRIMARY KEY,
        userId     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tokenHash  TEXT NOT NULL,
        createdAt  TEXT NOT NULL,
        expiresAt  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deviceMonitors (
        id          TEXT PRIMARY KEY,
        deviceId    TEXT NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
        type        TEXT NOT NULL DEFAULT 'none',
        target      TEXT,
        port        INTEGER,
        path        TEXT,
        intervalMs  INTEGER,
        enabled     INTEGER NOT NULL DEFAULT 0,
        lastCheckAt TEXT,
        lastResult  TEXT,
        lastMessage TEXT
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vlans_lab_vlanId
        ON vlans (labId, vlanId);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_assignments_subnet_ip
        ON ipAssignments (subnetId, ipAddress);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
        ON users (username);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_token_hash
        ON userSessions (tokenHash);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_vlan_ranges_lab_name
        ON vlanRanges (labId, name);

      CREATE INDEX IF NOT EXISTS idx_devices_lab_id
        ON devices (labId);

      CREATE INDEX IF NOT EXISTS idx_devices_rack_id
        ON devices (rackId);

      CREATE INDEX IF NOT EXISTS idx_ports_device_id
        ON ports (deviceId);

      CREATE INDEX IF NOT EXISTS idx_port_links_from_port_id
        ON portLinks (fromPortId);

      CREATE INDEX IF NOT EXISTS idx_port_links_to_port_id
        ON portLinks (toPortId);

      CREATE INDEX IF NOT EXISTS idx_ip_assignments_device_id
        ON ipAssignments (deviceId);

      CREATE INDEX IF NOT EXISTS idx_ip_assignments_subnet_id
        ON ipAssignments (subnetId);

      CREATE INDEX IF NOT EXISTS idx_dhcp_scopes_subnet_id
        ON dhcpScopes (subnetId);

      CREATE INDEX IF NOT EXISTS idx_ip_zones_subnet_id
        ON ipZones (subnetId);

      CREATE INDEX IF NOT EXISTS idx_device_monitors_device_id
        ON deviceMonitors (deviceId);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS portTemplates (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL,
        deviceTypes TEXT NOT NULL,
        ports       TEXT NOT NULL,
        createdAt   TEXT NOT NULL,
        updatedAt   TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_port_templates_name
        ON portTemplates (name);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE devices ADD COLUMN placement TEXT;
      ALTER TABLE devices ADD COLUMN parentDeviceId TEXT REFERENCES devices(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_devices_parent_device_id
        ON devices (parentDeviceId);

      CREATE TABLE IF NOT EXISTS discoveredDevices (
        id              TEXT PRIMARY KEY,
        labId           TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        ipAddress       TEXT NOT NULL,
        hostname        TEXT,
        displayName     TEXT,
        deviceType      TEXT,
        placement       TEXT,
        source          TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'new',
        notes           TEXT,
        importedDeviceId TEXT REFERENCES devices(id) ON DELETE SET NULL,
        lastSeen        TEXT,
        lastScannedAt   TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_devices_lab_ip
        ON discoveredDevices (labId, ipAddress);

      CREATE INDEX IF NOT EXISTS idx_discovered_devices_lab_status
        ON discoveredDevices (labId, status);
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE devices ADD COLUMN cpuCores INTEGER;
      ALTER TABLE devices ADD COLUMN memoryGb REAL;
      ALTER TABLE devices ADD COLUMN storageGb REAL;
      ALTER TABLE devices ADD COLUMN specs TEXT;

      ALTER TABLE discoveredDevices ADD COLUMN macAddress TEXT;
      ALTER TABLE discoveredDevices ADD COLUMN vendor TEXT;

      CREATE TABLE IF NOT EXISTS appSettings (
        key       TEXT PRIMARY KEY,
        value     TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE deviceMonitors RENAME TO deviceMonitors_legacy;

      CREATE TABLE deviceMonitors (
        id          TEXT PRIMARY KEY,
        deviceId    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        name        TEXT NOT NULL DEFAULT 'Primary',
        type        TEXT NOT NULL DEFAULT 'none',
        target      TEXT,
        port        INTEGER,
        path        TEXT,
        intervalMs  INTEGER,
        enabled     INTEGER NOT NULL DEFAULT 0,
        sortOrder   INTEGER NOT NULL DEFAULT 0,
        lastCheckAt TEXT,
        lastResult  TEXT,
        lastMessage TEXT
      );

      INSERT INTO deviceMonitors (
        id,
        deviceId,
        name,
        type,
        target,
        port,
        path,
        intervalMs,
        enabled,
        sortOrder,
        lastCheckAt,
        lastResult,
        lastMessage
      )
      SELECT
        id,
        deviceId,
        'Primary',
        type,
        target,
        port,
        path,
        intervalMs,
        enabled,
        0,
        lastCheckAt,
        lastResult,
        lastMessage
      FROM deviceMonitors_legacy;

      DROP TABLE deviceMonitors_legacy;

      CREATE INDEX IF NOT EXISTS idx_device_monitors_device_id
        ON deviceMonitors (deviceId);

      CREATE INDEX IF NOT EXISTS idx_device_monitors_device_sort
        ON deviceMonitors (deviceId, sortOrder, name, id);
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE deviceMonitors ADD COLUMN lastAlertAt TEXT;
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS wifiControllers (
        id           TEXT PRIMARY KEY,
        labId        TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        deviceId     TEXT UNIQUE REFERENCES devices(id) ON DELETE SET NULL,
        name         TEXT NOT NULL,
        vendor       TEXT,
        model        TEXT,
        managementIp TEXT,
        notes        TEXT
      );

      CREATE TABLE IF NOT EXISTS wifiSsids (
        id       TEXT PRIMARY KEY,
        labId    TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        name     TEXT NOT NULL,
        purpose  TEXT,
        security TEXT,
        hidden   INTEGER NOT NULL DEFAULT 0,
        vlanId   TEXT REFERENCES vlans(id) ON DELETE SET NULL,
        color    TEXT
      );

      CREATE TABLE IF NOT EXISTS wifiAccessPoints (
        deviceId         TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        controllerId     TEXT REFERENCES wifiControllers(id) ON DELETE SET NULL,
        location         TEXT,
        firmwareVersion  TEXT,
        notes            TEXT
      );

      CREATE TABLE IF NOT EXISTS wifiRadios (
        id            TEXT PRIMARY KEY,
        apDeviceId    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        slotName      TEXT NOT NULL,
        band          TEXT NOT NULL,
        channel       TEXT NOT NULL,
        channelWidth  TEXT,
        txPower       TEXT,
        notes         TEXT
      );

      CREATE TABLE IF NOT EXISTS wifiRadioSsids (
        radioId TEXT NOT NULL REFERENCES wifiRadios(id) ON DELETE CASCADE,
        ssidId  TEXT NOT NULL REFERENCES wifiSsids(id) ON DELETE CASCADE,
        PRIMARY KEY (radioId, ssidId)
      );

      CREATE TABLE IF NOT EXISTS wifiClientAssociations (
        clientDeviceId TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        apDeviceId     TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        radioId        TEXT REFERENCES wifiRadios(id) ON DELETE SET NULL,
        ssidId         TEXT REFERENCES wifiSsids(id) ON DELETE SET NULL,
        band           TEXT,
        channel        TEXT,
        signalDbm      INTEGER,
        lastSeen       TEXT,
        lastRoamAt     TEXT,
        notes          TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_wifi_controllers_lab_name
        ON wifiControllers (labId, name);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_wifi_ssids_lab_name
        ON wifiSsids (labId, name);

      CREATE INDEX IF NOT EXISTS idx_wifi_controllers_lab_id
        ON wifiControllers (labId);

      CREATE INDEX IF NOT EXISTS idx_wifi_ssids_lab_id
        ON wifiSsids (labId);

      CREATE INDEX IF NOT EXISTS idx_wifi_access_points_controller_id
        ON wifiAccessPoints (controllerId);

      CREATE INDEX IF NOT EXISTS idx_wifi_radios_ap_device_id
        ON wifiRadios (apDeviceId);

      CREATE INDEX IF NOT EXISTS idx_wifi_radio_ssids_ssid_id
        ON wifiRadioSsids (ssidId);

      CREATE INDEX IF NOT EXISTS idx_wifi_client_associations_ap_device_id
        ON wifiClientAssociations (apDeviceId);

      CREATE INDEX IF NOT EXISTS idx_wifi_client_associations_ssid_id
        ON wifiClientAssociations (ssidId);

      CREATE INDEX IF NOT EXISTS idx_wifi_client_associations_radio_id
        ON wifiClientAssociations (radioId);
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE ports ADD COLUMN mode TEXT NOT NULL DEFAULT 'access';
      ALTER TABLE ports ADD COLUMN allowedVlanIds TEXT;
    `,
  },
  {
    version: 10,
    sql: `
      CREATE TABLE IF NOT EXISTS virtualSwitches (
        id           TEXT PRIMARY KEY,
        hostDeviceId TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        notes        TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_virtual_switches_host_device_id
        ON virtualSwitches (hostDeviceId);

      ALTER TABLE ports ADD COLUMN virtualSwitchId TEXT REFERENCES virtualSwitches(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_ports_virtual_switch_id
        ON ports (virtualSwitchId);
    `,
  },
  {
    version: 11,
    sql: `
      ALTER TABLE virtualSwitches ADD COLUMN kind TEXT NOT NULL DEFAULT 'external';
    `,
  },
  {
    version: 12,
    sql: `
      CREATE TABLE IF NOT EXISTS rooms (
        id          TEXT PRIMARY KEY,
        labId       TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        location    TEXT,
        notes       TEXT
      );

      ALTER TABLE racks ADD COLUMN roomId TEXT REFERENCES rooms(id) ON DELETE SET NULL;
      ALTER TABLE devices ADD COLUMN roomId TEXT REFERENCES rooms(id) ON DELETE SET NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_lab_name
        ON rooms (labId, name);

      CREATE INDEX IF NOT EXISTS idx_rooms_lab_id
        ON rooms (labId);

      CREATE INDEX IF NOT EXISTS idx_racks_room_id
        ON racks (roomId);

      CREATE INDEX IF NOT EXISTS idx_devices_room_id
        ON devices (roomId);
    `,
  },
  {
    version: 13,
    sql: `
      CREATE TABLE IF NOT EXISTS oidcIdentities (
        issuer      TEXT NOT NULL,
        subject     TEXT NOT NULL,
        userId      TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        email       TEXT,
        displayName TEXT,
        createdAt   TEXT NOT NULL,
        updatedAt   TEXT NOT NULL,
        PRIMARY KEY (issuer, subject)
      );

      CREATE INDEX IF NOT EXISTS idx_oidc_identities_user_id
        ON oidcIdentities (userId);
    `,
  },
  {
    version: 14,
    sql: `
      ALTER TABLE devices ADD COLUMN macAddress TEXT;

      UPDATE devices
      SET macAddress = (
        SELECT discoveredDevices.macAddress
        FROM discoveredDevices
        WHERE discoveredDevices.importedDeviceId = devices.id
          AND discoveredDevices.macAddress IS NOT NULL
        ORDER BY discoveredDevices.lastScannedAt DESC
        LIMIT 1
      )
      WHERE macAddress IS NULL
        AND EXISTS (
          SELECT 1
          FROM discoveredDevices
          WHERE discoveredDevices.importedDeviceId = devices.id
            AND discoveredDevices.macAddress IS NOT NULL
        );

      UPDATE devices
      SET macAddress = (
        SELECT discoveredDevices.macAddress
        FROM discoveredDevices
        WHERE discoveredDevices.labId = devices.labId
          AND discoveredDevices.ipAddress = devices.managementIp
          AND discoveredDevices.macAddress IS NOT NULL
        ORDER BY discoveredDevices.lastScannedAt DESC
        LIMIT 1
      )
      WHERE macAddress IS NULL
        AND managementIp IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM discoveredDevices
          WHERE discoveredDevices.labId = devices.labId
            AND discoveredDevices.ipAddress = devices.managementIp
            AND discoveredDevices.macAddress IS NOT NULL
        );
    `,
  },
  {
    version: 15,
    sql: `
      CREATE TABLE IF NOT EXISTS documentationPages (
        id        TEXT PRIMARY KEY,
        labId     TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        title     TEXT NOT NULL,
        content   TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_documentation_pages_lab_id
        ON documentationPages (labId);

      CREATE INDEX IF NOT EXISTS idx_documentation_pages_lab_updated
        ON documentationPages (labId, updatedAt DESC);

      CREATE TABLE IF NOT EXISTS deviceImages (
        id        TEXT PRIMARY KEY,
        deviceId  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        label     TEXT NOT NULL,
        fileName  TEXT NOT NULL,
        mimeType  TEXT NOT NULL,
        dataUrl   TEXT NOT NULL,
        notes     TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_device_images_device_id
        ON deviceImages (deviceId);
    `,
  },
  {
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS referenceImages (
        id         TEXT PRIMARY KEY,
        labId      TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        entityType TEXT NOT NULL,
        entityId   TEXT NOT NULL,
        label      TEXT NOT NULL,
        fileName   TEXT NOT NULL,
        mimeType   TEXT NOT NULL,
        dataUrl    TEXT NOT NULL,
        face       TEXT,
        notes      TEXT,
        createdAt  TEXT NOT NULL,
        updatedAt  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reference_images_lab_id
        ON referenceImages (labId);

      CREATE INDEX IF NOT EXISTS idx_reference_images_entity
        ON referenceImages (entityType, entityId);
    `,
  },
  {
    version: 17,
    sql: `
      ALTER TABLE discoveredDevices ADD COLUMN technicalRole TEXT;
      ALTER TABLE discoveredDevices ADD COLUMN technicalReason TEXT;

      CREATE INDEX IF NOT EXISTS idx_discovered_devices_lab_technical
        ON discoveredDevices (labId, technicalRole);
    `,
  },
  {
    version: 18,
    sql: `
      ALTER TABLE ipAssignments ADD COLUMN allocationMode TEXT NOT NULL DEFAULT 'static';
      ALTER TABLE ipAssignments ADD COLUMN dhcpScopeId TEXT REFERENCES dhcpScopes(id) ON DELETE SET NULL;

      ALTER TABLE devices ADD COLUMN networkMode TEXT NOT NULL DEFAULT 'normal';
      ALTER TABLE virtualSwitches ADD COLUMN membersShareHostIp INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS deviceServices (
        id             TEXT PRIMARY KEY,
        deviceId       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        serviceType    TEXT NOT NULL,
        ipAssignmentId TEXT REFERENCES ipAssignments(id) ON DELETE SET NULL,
        portId         TEXT REFERENCES ports(id) ON DELETE SET NULL,
        vlanId         TEXT REFERENCES vlans(id) ON DELETE SET NULL,
        monitorId      TEXT REFERENCES deviceMonitors(id) ON DELETE SET NULL,
        url            TEXT,
        notes          TEXT,
        createdAt      TEXT NOT NULL,
        updatedAt      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ip_assignments_dhcp_scope_id
        ON ipAssignments (dhcpScopeId);

      CREATE INDEX IF NOT EXISTS idx_device_services_device_id
        ON deviceServices (deviceId);

      CREATE INDEX IF NOT EXISTS idx_device_services_type
        ON deviceServices (serviceType);
    `,
  },
  {
    version: 19,
    sql: `
      ALTER TABLE deviceMonitors ADD COLUMN snmpVersion TEXT;
      ALTER TABLE deviceMonitors ADD COLUMN snmpCommunity TEXT;
      ALTER TABLE deviceMonitors ADD COLUMN snmpOid TEXT;
      ALTER TABLE deviceMonitors ADD COLUMN snmpExpectedValue TEXT;
    `,
  },
  {
    version: 20,
    sql: `
      CREATE TABLE IF NOT EXISTS userLabAccess (
        userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        labId  TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        role   TEXT NOT NULL,
        PRIMARY KEY (userId, labId)
      );

      CREATE INDEX IF NOT EXISTS idx_user_lab_access_lab_id
        ON userLabAccess (labId);

      INSERT OR IGNORE INTO userLabAccess (userId, labId, role)
      SELECT u.id, l.id, CASE WHEN u.role = 'viewer' THEN 'viewer' ELSE 'editor' END
      FROM users u
      CROSS JOIN labs l
      WHERE u.role != 'admin';
    `,
  },
  {
    version: 21,
    sql: `
      ALTER TABLE deviceMonitors ADD COLUMN portId TEXT REFERENCES ports(id) ON DELETE SET NULL;
      ALTER TABLE deviceMonitors ADD COLUMN snmpIfIndex INTEGER;
      ALTER TABLE deviceMonitors ADD COLUMN snmpMatchMode TEXT NOT NULL DEFAULT 'equals';

      ALTER TABLE ports ADD COLUMN snmpIfIndex INTEGER;

      CREATE INDEX IF NOT EXISTS idx_device_monitors_port_id
        ON deviceMonitors (portId);

      CREATE INDEX IF NOT EXISTS idx_ports_snmp_if_index
        ON ports (deviceId, snmpIfIndex);
    `,
  },
  {
    version: 22,
    sql: `
      CREATE TABLE IF NOT EXISTS snmpCredentials (
        id             TEXT PRIMARY KEY,
        labId          TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        version        TEXT NOT NULL,
        communityEnc   TEXT,
        v3User         TEXT,
        v3AuthProto    TEXT,
        v3AuthPassEnc  TEXT,
        v3PrivProto    TEXT,
        v3PrivPassEnc  TEXT,
        v3Context      TEXT,
        createdAt      TEXT NOT NULL,
        updatedAt      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snmp_credentials_lab_id
        ON snmpCredentials (labId);

      ALTER TABLE devices ADD COLUMN snmpCredentialId TEXT REFERENCES snmpCredentials(id) ON DELETE SET NULL;
      ALTER TABLE deviceMonitors ADD COLUMN snmpCredentialId TEXT REFERENCES snmpCredentials(id) ON DELETE SET NULL;
    `,
  },
  {
    version: 23,
    sql: `
      CREATE TABLE IF NOT EXISTS snmpTrapSources (
        id           TEXT PRIMARY KEY,
        labId        TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        deviceId     TEXT REFERENCES devices(id) ON DELETE SET NULL,
        sourceIp     TEXT NOT NULL,
        community    TEXT,
        credentialId TEXT REFERENCES snmpCredentials(id) ON DELETE SET NULL,
        lastTrapAt   TEXT,
        UNIQUE(labId, sourceIp)
      );

      CREATE INDEX IF NOT EXISTS idx_snmp_trap_sources_lab_id
        ON snmpTrapSources (labId);

      CREATE INDEX IF NOT EXISTS idx_snmp_trap_sources_source_ip
        ON snmpTrapSources (sourceIp);

      CREATE TABLE IF NOT EXISTS snmpTrapLog (
        id           TEXT PRIMARY KEY,
        labId        TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        deviceId     TEXT REFERENCES devices(id) ON DELETE SET NULL,
        sourceIp     TEXT NOT NULL,
        trapOid      TEXT,
        ifIndex      INTEGER,
        varbindsJson TEXT,
        resultAction TEXT NOT NULL,
        message      TEXT NOT NULL,
        receivedAt   TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snmp_trap_log_lab_received
        ON snmpTrapLog (labId, receivedAt DESC);

      CREATE INDEX IF NOT EXISTS idx_snmp_trap_log_device_received
        ON snmpTrapLog (deviceId, receivedAt DESC);
    `,
  },
  {
    version: 24,
    sql: `
      ALTER TABLE discoveredDevices ADD COLUMN placementHint TEXT;
    `,
  },
  {
    version: 25,
    sql: `
      ALTER TABLE ports ADD COLUMN macAddress TEXT;
    `,
  },
  {
    version: 26,
    sql: `
      CREATE TABLE IF NOT EXISTS documentationDeviceLinks (
        id TEXT PRIMARY KEY,
        documentationPageId TEXT NOT NULL,
        deviceId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        UNIQUE(documentationPageId, deviceId),
        FOREIGN KEY(documentationPageId) REFERENCES documentationPages(id) ON DELETE CASCADE,
        FOREIGN KEY(deviceId) REFERENCES devices(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_documentation_device_links_page
        ON documentationDeviceLinks (documentationPageId);

      CREATE INDEX IF NOT EXISTS idx_documentation_device_links_device
        ON documentationDeviceLinks (deviceId);
    `,
  },
  {
    version: 27,
    sql: `
      CREATE TABLE IF NOT EXISTS dockerImportSources (
        id              TEXT PRIMARY KEY,
        labId           TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        endpoint        TEXT NOT NULL,
        tokenEnc        TEXT,
        lastSyncAt      TEXT,
        lastSyncStatus  TEXT,
        lastSyncMessage TEXT,
        createdAt       TEXT NOT NULL,
        updatedAt       TEXT NOT NULL,
        UNIQUE(labId, endpoint)
      );

      CREATE INDEX IF NOT EXISTS idx_docker_import_sources_lab_id
        ON dockerImportSources (labId);

      CREATE TABLE IF NOT EXISTS dockerContainerLinks (
        deviceId       TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        sourceId       TEXT NOT NULL REFERENCES dockerImportSources(id) ON DELETE CASCADE,
        containerId    TEXT NOT NULL,
        containerName  TEXT NOT NULL,
        image          TEXT NOT NULL,
        state          TEXT NOT NULL,
        status         TEXT NOT NULL,
        lastSyncedAt   TEXT,
        createdAt      TEXT NOT NULL,
        updatedAt      TEXT NOT NULL,
        UNIQUE(sourceId, containerId)
      );

      CREATE INDEX IF NOT EXISTS idx_docker_container_links_source_id
        ON dockerContainerLinks (sourceId);
    `,
  },
] as const;

const applySchema = db.transaction(() => {
  db.exec(BOOTSTRAP_SCHEMA_SQL);

  const row = db
    .prepare("SELECT version FROM schemaVersion WHERE id = 1")
    .get() as { version?: number } | undefined;
  let currentVersion = Number(row?.version ?? 0);

  for (const migration of SCHEMA_MIGRATIONS) {
    if (currentVersion >= migration.version) continue;
    db.exec(migration.sql);
    const updatedAt = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO schemaVersion (id, version, updatedAt)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, updatedAt = excluded.updatedAt
    `,
    ).run(migration.version, updatedAt);
    currentVersion = migration.version;
  }

  if (currentVersion === 0) {
    db.prepare(
      `
      INSERT INTO schemaVersion (id, version, updatedAt)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, updatedAt = excluded.updatedAt
    `,
    ).run(CURRENT_SCHEMA_VERSION, new Date().toISOString());
  }
});

applySchema();

type PatchPanelPortRow = {
  id: string;
  deviceId: string;
  name: string;
  position: number;
  kind: string;
  speed: string | null;
  linkState: string;
  mode: string | null;
  vlanId: string | null;
  allowedVlanIds: string | null;
  description: string | null;
  face: string | null;
  virtualSwitchId: string | null;
  macAddress: string | null;
};

export function ensurePatchPanelPassThroughPorts(deviceIds?: string[]) {
  const targetDeviceIds =
    deviceIds && deviceIds.length > 0
      ? [...new Set(deviceIds)]
      : (
          db
            .prepare(
              `
        SELECT id
        FROM devices
        WHERE deviceType = 'patch_panel'
      `,
            )
            .all() as Array<{ id: string }>
        ).map((row) => row.id);

  if (targetDeviceIds.length === 0) return 0;

  const selectPorts = db.prepare(`
    SELECT id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId
    FROM ports
    WHERE deviceId = ?
    ORDER BY position, name, id
  `);
  const insertPort = db.prepare(`
    INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId)
    VALUES (@id, @deviceId, @name, @position, @kind, @speed, @linkState, @mode, @vlanId, @allowedVlanIds, @description, @face, @virtualSwitchId)
  `);

  const normalize = db.transaction((ids: string[]) => {
    let createdCount = 0;

    for (const deviceId of ids) {
      const ports = selectPorts.all(deviceId) as PatchPanelPortRow[];
      const groups = new Map<string, PatchPanelPortRow[]>();

      for (const port of ports) {
        const key = `${port.kind}|${port.name.trim().toLowerCase()}`;
        const group = groups.get(key);
        if (group) {
          group.push(port);
        } else {
          groups.set(key, [port]);
        }
      }

      for (const group of groups.values()) {
        const front = group.find((port) => port.face !== "rear");
        const rear = group.find((port) => port.face === "rear");

        if (front && !rear) {
          insertPort.run({
            ...front,
            id: createId("p"),
            face: "rear",
            linkState: "down",
          });
          createdCount += 1;
        } else if (rear && !front) {
          insertPort.run({
            ...rear,
            id: createId("p"),
            face: "front",
            linkState: "down",
          });
          createdCount += 1;
        }
      }
    }

    return createdCount;
  });

  return normalize(targetDeviceIds);
}

ensurePatchPanelPassThroughPorts();

export function parseRow<T extends Record<string, unknown>>(
  row: T,
  jsonColumns: (keyof T)[],
): T {
  for (const col of jsonColumns) {
    if (typeof row[col] === "string") {
      try {
        (row as Record<string, unknown>)[String(col)] = JSON.parse(
          String(row[col]),
        );
      } catch {
        // Leave the raw value as-is if JSON parsing fails.
      }
    }
  }
  return row;
}
