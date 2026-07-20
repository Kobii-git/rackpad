import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyPluginAsync } from "fastify";
import { db, ensurePatchPanelPassThroughPorts, parseRow } from "../db.js";
import { requireAdmin, setBootstrapState } from "../lib/auth.js";
import {
  DEFAULT_ALERT_SETTINGS,
  loadAlertSettings,
  saveAlertSettings,
  sendTestAlert,
} from "../lib/alerts.js";
import { createId } from "../lib/ids.js";
import {
  loadUiSettings,
  normalizeLanguage,
  saveUiSettings,
} from "../lib/ui-settings.js";
import {
  asObject,
  ensureCidr,
  ensureIpv4,
  optionalBoolean,
  optionalInteger,
  optionalString,
  ValidationError,
} from "../lib/validation.js";
import { cidrContainsHostIp, cidrOverlaps, ipToInt } from "../lib/ip-cidr.js";
import { getSubnetIntegrity } from "../lib/subnet-integrity.js";
import { listAssignmentIntegrityIssues } from "../lib/ip-assignment-integrity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const PACKAGE_JSON_PATH = path.resolve(ROOT_DIR, "package.json");
const APP_VERSION = readAppVersion();
const REDACTED_ALERT_SETTING_FIELDS = [
  "discordWebhookUrl",
  "telegramBotToken",
  "smtpPassword",
] as const;

function readAppVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      version?: string;
    };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function createBackupFilename(exportedAt: string) {
  return `rackpad-backup-${exportedAt.replace(/[:.]/g, "-").replace("T", "_").replace("Z", "")}.json`;
}

function sanitizeBackupAppSettings(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    if (row.key !== "alertSettings" || typeof row.value !== "string") {
      return row;
    }

    try {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      const next = { ...DEFAULT_ALERT_SETTINGS, ...parsed };
      for (const key of REDACTED_ALERT_SETTING_FIELDS) {
        next[key] = null;
      }
      return {
        ...row,
        value: JSON.stringify(next),
      };
    } catch {
      return row;
    }
  });
}

const exportBackupSnapshot = db.transaction(
  (exportedAt: string, exportedBy: string, filename: string) => {
    const auditId = createId("a");

    const snapshot = {
      format: "rackpad-backup-v1",
      appVersion: APP_VERSION,
      exportedAt,
      exportedBy,
      secretsRedacted: true,
      data: {
        labs: db.prepare("SELECT * FROM labs ORDER BY name, id").all(),
        rooms: db.prepare("SELECT * FROM rooms ORDER BY labId, name, id").all(),
        racks: db.prepare("SELECT * FROM racks ORDER BY name, id").all(),
        devices: (
          db
            .prepare("SELECT * FROM devices ORDER BY hostname, id")
            .all() as Record<string, unknown>[]
        ).map((row) => parseRow(row, ["tags"])),
        virtualSwitches: db
          .prepare(
            "SELECT * FROM virtualSwitches ORDER BY hostDeviceId, name, id",
          )
          .all(),
        ports: (
          db
            .prepare("SELECT * FROM ports ORDER BY deviceId, position, id")
            .all() as Record<string, unknown>[]
        ).map((row) => parseRow(row, ["allowedVlanIds"])),
        portLinks: db
          .prepare("SELECT * FROM portLinks ORDER BY fromPortId, toPortId, id")
          .all(),
        portTemplates: (
          db
            .prepare("SELECT * FROM portTemplates ORDER BY name, id")
            .all() as Record<string, unknown>[]
        ).map((row) => parseRow(row, ["deviceTypes", "ports"])),
        vlans: db.prepare("SELECT * FROM vlans ORDER BY vlanId, id").all(),
        vlanRanges: db
          .prepare("SELECT * FROM vlanRanges ORDER BY startVlan, id")
          .all(),
        subnets: (
          db.prepare("SELECT * FROM subnets ORDER BY cidr, id").all() as Record<
            string,
            unknown
          >[]
        ).map((row) => parseRow(row, ["dnsServers"])),
        dhcpScopes: (
          db
            .prepare("SELECT * FROM dhcpScopes ORDER BY subnetId, name, id")
            .all() as Record<string, unknown>[]
        ).map((row) => parseRow(row, ["dnsServers"])),
        ipZones: db
          .prepare("SELECT * FROM ipZones ORDER BY subnetId, startIp, id")
          .all(),
        ipAssignments: db
          .prepare(
            "SELECT * FROM ipAssignments ORDER BY subnetId, ipAddress, id",
          )
          .all(),
        discoveredDevices: db
          .prepare(
            "SELECT * FROM discoveredDevices ORDER BY lastScannedAt DESC, ipAddress, id",
          )
          .all(),
        discoveryScanSchedules: db
          .prepare(
            "SELECT * FROM discoveryScanSchedules ORDER BY labId, cidr, id",
          )
          .all(),
        documentationPages: db
          .prepare(
            "SELECT * FROM documentationPages ORDER BY labId, updatedAt DESC, title, id",
          )
          .all(),
        documentationDeviceLinks: db
          .prepare(
            "SELECT * FROM documentationDeviceLinks ORDER BY documentationPageId, deviceId, id",
          )
          .all(),
        deviceImages: db
          .prepare(
            "SELECT * FROM deviceImages ORDER BY deviceId, createdAt DESC, id",
          )
          .all(),
        referenceImages: db
          .prepare(
            "SELECT * FROM referenceImages ORDER BY entityType, entityId, face, createdAt DESC, id",
          )
          .all(),
        auditLog: db
          .prepare("SELECT * FROM auditLog ORDER BY ts DESC, id DESC")
          .all(),
        users: db
          .prepare(
            `
        SELECT id, username, displayName, passwordHash, role, disabled, createdAt, lastLoginAt
        FROM users
        ORDER BY username, id
      `,
          )
          .all(),
        oidcIdentities: db
          .prepare("SELECT * FROM oidcIdentities ORDER BY issuer, subject")
          .all(),
        deviceMonitors: db
          .prepare("SELECT * FROM deviceMonitors ORDER BY deviceId, id")
          .all(),
        dockerImportSources: db
          .prepare(
            "SELECT id, labId, name, endpoint, NULL AS tokenEnc, lastSyncAt, lastSyncStatus, lastSyncMessage, createdAt, updatedAt, enabled FROM dockerImportSources ORDER BY labId, name, id",
          )
          .all(),
        dockerContainerLinks: db
          .prepare(
            "SELECT * FROM dockerContainerLinks ORDER BY sourceId, containerName, deviceId",
          )
          .all(),
        snmpCredentials: db
          .prepare("SELECT * FROM snmpCredentials ORDER BY labId, name, id")
          .all(),
        snmpTrapSources: db
          .prepare("SELECT * FROM snmpTrapSources ORDER BY labId, sourceIp")
          .all(),
        snmpTrapLog: db
          .prepare("SELECT * FROM snmpTrapLog ORDER BY receivedAt DESC")
          .all(),
        deviceServices: db
          .prepare(
            "SELECT * FROM deviceServices ORDER BY deviceId, serviceType, name, id",
          )
          .all(),
        wifiControllers: db
          .prepare("SELECT * FROM wifiControllers ORDER BY name, id")
          .all(),
        wifiSsids: db
          .prepare("SELECT * FROM wifiSsids ORDER BY name, id")
          .all(),
        wifiAccessPoints: db
          .prepare("SELECT * FROM wifiAccessPoints ORDER BY deviceId")
          .all(),
        wifiRadios: db
          .prepare(
            "SELECT * FROM wifiRadios ORDER BY apDeviceId, band, slotName, id",
          )
          .all(),
        wifiRadioSsids: db
          .prepare("SELECT * FROM wifiRadioSsids ORDER BY radioId, ssidId")
          .all(),
        wifiClientAssociations: db
          .prepare(
            "SELECT * FROM wifiClientAssociations ORDER BY apDeviceId, clientDeviceId",
          )
          .all(),
        appSettings: sanitizeBackupAppSettings(
          db.prepare("SELECT * FROM appSettings ORDER BY key").all() as Record<
            string,
            unknown
          >[],
        ),
      },
    };

    db.prepare(
      `
    INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    ).run(
      auditId,
      exportedAt,
      exportedBy,
      "admin.export",
      "Backup",
      auditId,
      `Exported Rackpad backup ${filename}`,
    );

    return snapshot;
  },
);

function normalizeArrayRecordArray(value: unknown, key: string) {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${key} must be an array.`);
  }
  return value.map((entry) => asObject(entry));
}

function validateBackupNetworkIntegrity(input: {
  labs: Record<string, unknown>[];
  vlans: Record<string, unknown>[];
  vlanRanges: Record<string, unknown>[];
  subnets: Record<string, unknown>[];
  dhcpScopes: Record<string, unknown>[];
  ipZones: Record<string, unknown>[];
  devices: Record<string, unknown>[];
  ports: Record<string, unknown>[];
  ipAssignments: Record<string, unknown>[];
}) {
  function invalid(
    message: string,
    entityType: string,
    entityId: string,
    subnetId?: string,
  ): never {
    throw new ValidationError(message, 422, "BACKUP_INTEGRITY_INVALID", {
      entityType,
      entityId,
      subnetId: subnetId ?? null,
    });
  }

  function entityId(row: Record<string, unknown>) {
    return String(row.id ?? "(missing id)");
  }

  function backupIpv4(
    value: unknown,
    label: string,
    entityType: string,
    id: string,
    subnetId?: string,
  ) {
    try {
      return ensureIpv4(String(value ?? ""), label);
    } catch {
      invalid(
        `${label} must be a valid IPv4 address.`,
        entityType,
        id,
        subnetId,
      );
    }
  }

  function validateHostAddress(
    value: unknown,
    label: string,
    subnet: { id: string; cidr: string },
    entityType: string,
    id: string,
  ) {
    const address = backupIpv4(value, label, entityType, id, subnet.id);
    if (!cidrContainsHostIp(subnet.cidr, address)) {
      invalid(
        `${label} ${address} is outside the usable host range of subnet ${subnet.cidr}.`,
        entityType,
        id,
        subnet.id,
      );
    }
    return address;
  }

  const labIds = new Set(input.labs.map((row) => String(row.id ?? "")));
  const vlansById = new Map<string, { id: string; labId: string }>();
  for (const row of input.vlans) {
    const id = entityId(row);
    const labId = String(row.labId ?? "");
    if (!labIds.has(labId)) {
      invalid("Backup VLAN references a missing lab.", "vlan", id);
    }
    vlansById.set(id, { id, labId });
  }
  for (const row of input.vlanRanges) {
    const id = entityId(row);
    if (!labIds.has(String(row.labId ?? ""))) {
      invalid("Backup VLAN range references a missing lab.", "vlanRange", id);
    }
    const start = Number(row.startVlan);
    const end = Number(row.endVlan);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      invalid("Backup VLAN range is inverted or invalid.", "vlanRange", id);
    }
  }

  const subnetsById = new Map<
    string,
    { id: string; labId: string; cidr: string; name: string }
  >();
  const subnetsByLab = new Map<
    string,
    Array<{ id: string; cidr: string; name: string }>
  >();
  for (const row of input.subnets) {
    const id = String(row.id ?? "");
    const labId = String(row.labId ?? "");
    if (!id || !labId || !labIds.has(labId)) {
      invalid(
        "Backup subnet references a missing lab.",
        "subnet",
        id || "(missing id)",
        id || undefined,
      );
    }
    let cidr: string;
    try {
      cidr = ensureCidr(String(row.cidr ?? ""), "backup subnet CIDR");
    } catch {
      invalid("Backup subnet CIDR is invalid.", "subnet", id, id);
    }
    row.cidr = cidr;
    const subnet = { id, labId, cidr, name: String(row.name ?? cidr) };
    const vlanId = row.vlanId ? String(row.vlanId) : null;
    if (vlanId) {
      const vlan = vlansById.get(vlanId);
      if (!vlan || vlan.labId !== labId) {
        invalid(
          "Backup subnet VLAN must belong to the same lab.",
          "subnet",
          id,
          id,
        );
      }
    }
    if (row.gateway) {
      row.gateway = validateHostAddress(
        row.gateway,
        "Backup subnet gateway",
        subnet,
        "subnet",
        id,
      );
    }
    subnetsById.set(id, subnet);
    const list = subnetsByLab.get(labId) ?? [];
    list.push(subnet);
    subnetsByLab.set(labId, list);
  }
  for (const subnets of subnetsByLab.values()) {
    for (let index = 0; index < subnets.length; index += 1) {
      for (
        let candidateIndex = index + 1;
        candidateIndex < subnets.length;
        candidateIndex += 1
      ) {
        const left = subnets[index];
        const right = subnets[candidateIndex];
        if (!cidrOverlaps(left.cidr, right.cidr)) continue;
        throw new ValidationError(
          `Backup subnets ${left.cidr} and ${right.cidr} overlap.`,
          409,
          "SUBNET_OVERLAP",
          { conflicts: [left, right] },
        );
      }
    }
  }

  const scopesById = new Map<
    string,
    { id: string; subnetId: string; startIp: string; endIp: string }
  >();
  for (const row of input.dhcpScopes) {
    const id = entityId(row);
    const subnetId = String(row.subnetId ?? "");
    const subnet = subnetsById.get(subnetId);
    if (!subnet)
      invalid(
        "Backup DHCP scope references a missing subnet.",
        "dhcpScope",
        id,
        subnetId,
      );
    const startIp = validateHostAddress(
      row.startIp,
      "Backup DHCP start IP",
      subnet,
      "dhcpScope",
      id,
    );
    const endIp = validateHostAddress(
      row.endIp,
      "Backup DHCP end IP",
      subnet,
      "dhcpScope",
      id,
    );
    if (ipToInt(startIp) > ipToInt(endIp)) {
      invalid(
        "Backup DHCP scope range is inverted.",
        "dhcpScope",
        id,
        subnetId,
      );
    }
    if (row.gateway) {
      row.gateway = validateHostAddress(
        row.gateway,
        "Backup DHCP gateway",
        subnet,
        "dhcpScope",
        id,
      );
    }
    row.startIp = startIp;
    row.endIp = endIp;
    scopesById.set(id, { id, subnetId, startIp, endIp });
  }

  for (const row of input.ipZones) {
    const id = entityId(row);
    const subnetId = String(row.subnetId ?? "");
    const subnet = subnetsById.get(subnetId);
    if (!subnet)
      invalid(
        "Backup IP zone references a missing subnet.",
        "ipZone",
        id,
        subnetId,
      );
    const startIp = validateHostAddress(
      row.startIp,
      "Backup zone start IP",
      subnet,
      "ipZone",
      id,
    );
    const endIp = validateHostAddress(
      row.endIp,
      "Backup zone end IP",
      subnet,
      "ipZone",
      id,
    );
    if (ipToInt(startIp) > ipToInt(endIp)) {
      invalid("Backup IP zone range is inverted.", "ipZone", id, subnetId);
    }
    row.startIp = startIp;
    row.endIp = endIp;
  }

  const devicesById = new Map(
    input.devices.map((row) => [
      String(row.id),
      { id: String(row.id), labId: String(row.labId) },
    ]),
  );
  for (const device of devicesById.values()) {
    if (!labIds.has(device.labId)) {
      invalid("Backup device references a missing lab.", "device", device.id);
    }
  }
  const portsById = new Map(
    input.ports.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        deviceId: String(row.deviceId),
        vlanId: row.vlanId ? String(row.vlanId) : null,
        allowedVlanIds: Array.isArray(row.allowedVlanIds)
          ? row.allowedVlanIds.map((value) => String(value))
          : [],
      },
    ]),
  );
  for (const port of portsById.values()) {
    const device = devicesById.get(port.deviceId);
    if (!device)
      invalid("Backup port references a missing device.", "port", port.id);
    for (const vlanId of [port.vlanId, ...port.allowedVlanIds]) {
      if (!vlanId) continue;
      const vlan = vlansById.get(vlanId);
      if (!vlan || vlan.labId !== device.labId) {
        invalid(
          "Backup port VLAN must belong to the device lab.",
          "port",
          port.id,
        );
      }
    }
  }

  for (const assignment of input.ipAssignments) {
    const id = entityId(assignment);
    const subnetId = String(assignment.subnetId ?? "");
    const subnet = subnetsById.get(subnetId);
    if (!subnet)
      invalid(
        "Backup IP assignment references a missing subnet.",
        "ipAssignment",
        id,
        subnetId,
      );
    const ipAddress = validateHostAddress(
      assignment.ipAddress,
      "Backup assignment IP",
      subnet,
      "ipAssignment",
      id,
    );
    assignment.ipAddress = ipAddress;

    const allocationMode = String(assignment.allocationMode ?? "static");
    const dhcpScopeId = assignment.dhcpScopeId
      ? String(assignment.dhcpScopeId)
      : null;
    if (allocationMode === "dhcp-reservation") {
      const scope = dhcpScopeId ? scopesById.get(dhcpScopeId) : null;
      if (!scope || scope.subnetId !== subnetId) {
        invalid(
          "Backup DHCP reservation must reference a scope in the same subnet.",
          "ipAssignment",
          id,
          subnetId,
        );
      }
      if (
        ipToInt(ipAddress) < ipToInt(scope.startIp) ||
        ipToInt(ipAddress) > ipToInt(scope.endIp)
      ) {
        invalid(
          "Backup DHCP reservation is outside its selected scope.",
          "ipAssignment",
          id,
          subnetId,
        );
      }
    } else if (dhcpScopeId) {
      invalid(
        "Backup static assignment cannot reference a DHCP scope.",
        "ipAssignment",
        id,
        subnetId,
      );
    }

    const deviceId = assignment.deviceId ? String(assignment.deviceId) : null;
    const portId = assignment.portId ? String(assignment.portId) : null;
    if (deviceId) {
      const device = devicesById.get(deviceId);
      if (!device)
        invalid(
          "Backup IP assignment references a missing device.",
          "ipAssignment",
          id,
          subnetId,
        );
      if (device.labId !== subnet.labId) {
        invalid(
          "Backup IP assignment references a device in another lab.",
          "ipAssignment",
          id,
          subnetId,
        );
      }
    }
    if (portId) {
      const port = portsById.get(portId);
      const portDevice = port ? devicesById.get(port.deviceId) : null;
      if (!port || !portDevice)
        invalid(
          "Backup IP assignment references a missing port.",
          "ipAssignment",
          id,
          subnetId,
        );
      if (
        portDevice.labId !== subnet.labId ||
        (deviceId && port.deviceId !== deviceId)
      ) {
        invalid(
          "Backup IP assignment references a port in another lab or device.",
          "ipAssignment",
          id,
          subnetId,
        );
      }
    }
    for (const field of ["vmId", "containerId"] as const) {
      const targetId = assignment[field] ? String(assignment[field]) : null;
      const target = targetId ? devicesById.get(targetId) : null;
      if (target && target.labId !== subnet.labId) {
        invalid(
          `Backup IP assignment ${field} belongs to another lab.`,
          "ipAssignment",
          id,
          subnetId,
        );
      }
    }
  }
}

const restoreBackupSnapshot = db.transaction(
  (snapshot: Record<string, unknown>, restoredBy: string) => {
    if (snapshot.format !== "rackpad-backup-v1") {
      throw new ValidationError("Unsupported backup format.");
    }

    const data = asObject(snapshot.data);
    const labs = normalizeArrayRecordArray(data.labs, "data.labs");
    const rooms = normalizeArrayRecordArray(data.rooms ?? [], "data.rooms");
    const racks = normalizeArrayRecordArray(data.racks, "data.racks");
    const devices = normalizeArrayRecordArray(data.devices, "data.devices");
    const virtualSwitches = normalizeArrayRecordArray(
      data.virtualSwitches ?? [],
      "data.virtualSwitches",
    );
    const ports = normalizeArrayRecordArray(data.ports, "data.ports");
    const portLinks = normalizeArrayRecordArray(
      data.portLinks,
      "data.portLinks",
    );
    const portTemplates = normalizeArrayRecordArray(
      data.portTemplates ?? [],
      "data.portTemplates",
    );
    const vlans = normalizeArrayRecordArray(data.vlans, "data.vlans");
    const vlanRanges = normalizeArrayRecordArray(
      data.vlanRanges,
      "data.vlanRanges",
    );
    const subnets = normalizeArrayRecordArray(data.subnets, "data.subnets");
    const dhcpScopes = normalizeArrayRecordArray(
      data.dhcpScopes,
      "data.dhcpScopes",
    );
    const ipZones = normalizeArrayRecordArray(data.ipZones, "data.ipZones");
    const ipAssignments = normalizeArrayRecordArray(
      data.ipAssignments,
      "data.ipAssignments",
    );
    const discoveredDevices = normalizeArrayRecordArray(
      data.discoveredDevices ?? [],
      "data.discoveredDevices",
    );
    const discoveryScanSchedules = normalizeArrayRecordArray(
      data.discoveryScanSchedules ?? [],
      "data.discoveryScanSchedules",
    );
    const documentationPages = normalizeArrayRecordArray(
      data.documentationPages ?? [],
      "data.documentationPages",
    );
    const documentationDeviceLinks = normalizeArrayRecordArray(
      data.documentationDeviceLinks ?? [],
      "data.documentationDeviceLinks",
    );
    const deviceImages = normalizeArrayRecordArray(
      data.deviceImages ?? [],
      "data.deviceImages",
    );
    const referenceImages = normalizeArrayRecordArray(
      data.referenceImages ?? [],
      "data.referenceImages",
    );
    const auditLog = normalizeArrayRecordArray(data.auditLog, "data.auditLog");
    const users = normalizeArrayRecordArray(data.users, "data.users");
    const oidcIdentities = normalizeArrayRecordArray(
      data.oidcIdentities ?? [],
      "data.oidcIdentities",
    );
    const deviceMonitors = normalizeArrayRecordArray(
      data.deviceMonitors,
      "data.deviceMonitors",
    );
    const dockerImportSources = normalizeArrayRecordArray(
      data.dockerImportSources ?? [],
      "data.dockerImportSources",
    );
    const dockerContainerLinks = normalizeArrayRecordArray(
      data.dockerContainerLinks ?? [],
      "data.dockerContainerLinks",
    );
    const snmpCredentials = normalizeArrayRecordArray(
      data.snmpCredentials ?? [],
      "data.snmpCredentials",
    );
    const snmpTrapSources = normalizeArrayRecordArray(
      data.snmpTrapSources ?? [],
      "data.snmpTrapSources",
    );
    const snmpTrapLog = normalizeArrayRecordArray(
      data.snmpTrapLog ?? [],
      "data.snmpTrapLog",
    );
    const deviceServices = normalizeArrayRecordArray(
      data.deviceServices ?? [],
      "data.deviceServices",
    );
    const wifiControllers = normalizeArrayRecordArray(
      data.wifiControllers ?? [],
      "data.wifiControllers",
    );
    const wifiSsids = normalizeArrayRecordArray(
      data.wifiSsids ?? [],
      "data.wifiSsids",
    );
    const wifiAccessPoints = normalizeArrayRecordArray(
      data.wifiAccessPoints ?? [],
      "data.wifiAccessPoints",
    );
    const wifiRadios = normalizeArrayRecordArray(
      data.wifiRadios ?? [],
      "data.wifiRadios",
    );
    const wifiRadioSsids = normalizeArrayRecordArray(
      data.wifiRadioSsids ?? [],
      "data.wifiRadioSsids",
    );
    const wifiClientAssociations = normalizeArrayRecordArray(
      data.wifiClientAssociations ?? [],
      "data.wifiClientAssociations",
    );
    const appSettings = normalizeArrayRecordArray(
      data.appSettings ?? [],
      "data.appSettings",
    );

    if (users.length === 0) {
      throw new ValidationError(
        "Backup must contain at least one user account.",
      );
    }

    validateBackupNetworkIntegrity({
      labs,
      vlans,
      vlanRanges,
      subnets,
      dhcpScopes,
      ipZones,
      devices,
      ports,
      ipAssignments,
    });

    db.exec(`
    DELETE FROM userSessions;
    DELETE FROM oidcIdentities;
    DELETE FROM wifiClientAssociations;
    DELETE FROM wifiRadioSsids;
    DELETE FROM wifiRadios;
    DELETE FROM wifiAccessPoints;
    DELETE FROM wifiSsids;
    DELETE FROM wifiControllers;
    DELETE FROM deviceServices;
    DELETE FROM deviceMonitors;
    DELETE FROM dockerContainerLinks;
    DELETE FROM dockerImportSources;
    DELETE FROM snmpTrapLog;
    DELETE FROM snmpTrapSources;
    DELETE FROM snmpCredentials;
    DELETE FROM appSettings;
    DELETE FROM auditLog;
    DELETE FROM referenceImages;
    DELETE FROM deviceImages;
    DELETE FROM documentationDeviceLinks;
    DELETE FROM documentationPages;
    DELETE FROM ipAssignments;
    DELETE FROM discoveryScanSchedules;
    DELETE FROM discoveredDevices;
    DELETE FROM portLinks;
    DELETE FROM ports;
    DELETE FROM virtualSwitches;
    DELETE FROM ipZones;
    DELETE FROM dhcpScopes;
    DELETE FROM subnets;
    DELETE FROM vlans;
    DELETE FROM vlanRanges;
    DELETE FROM portTemplates;
    DELETE FROM devices;
    DELETE FROM racks;
    DELETE FROM rooms;
    DELETE FROM users;
    DELETE FROM labs;
  `);

    const insertLab = db.prepare(
      "INSERT INTO labs (id, name, description, location) VALUES (?, ?, ?, ?)",
    );
    const insertRoom = db.prepare(
      "INSERT INTO rooms (id, labId, name, description, location, notes) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertRack = db.prepare(
      "INSERT INTO racks (id, labId, name, totalU, description, location, notes, roomId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertDevice = db.prepare(`
    INSERT INTO devices
      (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model, serial, managementIp, macAddress, status, placement, parentDeviceId, roomId, cpuCores, memoryGb, storageGb, specs, startU, heightU, face, rackSlot, tags, notes, lastSeen, networkMode, snmpCredentialId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const updateDeviceParent = db.prepare(`
    UPDATE devices
    SET parentDeviceId = ?
    WHERE id = ?
  `);
    const insertVirtualSwitch = db.prepare(`
    INSERT INTO virtualSwitches (id, hostDeviceId, name, kind, notes, membersShareHostIp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    const insertPort = db.prepare(`
    INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId, snmpIfIndex, macAddress, portRole, aggregatePortId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const updatePortAggregate = db.prepare(`
    UPDATE ports
    SET aggregatePortId = ?
    WHERE id = ?
  `);
    const insertPortLink = db.prepare(
      "INSERT INTO portLinks (id, fromPortId, toPortId, cableType, cableLength, color, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertPortTemplate = db.prepare(`
    INSERT INTO portTemplates (id, name, description, deviceTypes, ports, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    const insertVlan = db.prepare(
      "INSERT INTO vlans (id, labId, vlanId, name, description, color) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertVlanRange = db.prepare(
      "INSERT INTO vlanRanges (id, labId, name, startVlan, endVlan, purpose, color) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertSubnet = db.prepare(
      "INSERT INTO subnets (id, labId, cidr, name, description, gateway, dnsServers, vlanId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertDhcpScope = db.prepare(
      "INSERT INTO dhcpScopes (id, subnetId, name, startIp, endIp, gateway, dnsServers, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertIpZone = db.prepare(
      "INSERT INTO ipZones (id, subnetId, kind, startIp, endIp, description) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertIpAssignment = db.prepare(`
    INSERT INTO ipAssignments (id, subnetId, ipAddress, assignmentType, deviceId, portId, vmId, containerId, hostname, description, allocationMode, dhcpScopeId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertDiscoveredDevice = db.prepare(`
    INSERT INTO discoveredDevices
      (id, labId, ipAddress, hostname, displayName, deviceType, placement, macAddress, vendor, source, status, notes, importedDeviceId, lastSeen, lastScannedAt, technicalRole, technicalReason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertDiscoveryScanSchedule = db.prepare(`
    INSERT INTO discoveryScanSchedules
      (id, labId, name, cidr, intervalMs, enabled, lastRunAt, lastResult, lastMessage, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertDocumentationPage = db.prepare(`
    INSERT INTO documentationPages (id, labId, title, content, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    const insertDocumentationDeviceLink = db.prepare(`
    INSERT INTO documentationDeviceLinks (id, documentationPageId, deviceId, createdAt)
    VALUES (?, ?, ?, ?)
  `);
    const insertDeviceImage = db.prepare(`
    INSERT INTO deviceImages (id, deviceId, label, fileName, mimeType, dataUrl, notes, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertReferenceImage = db.prepare(`
    INSERT INTO referenceImages (id, labId, entityType, entityId, label, fileName, mimeType, dataUrl, face, notes, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertAudit = db.prepare(
      "INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertUser = db.prepare(`
    INSERT INTO users (id, username, displayName, passwordHash, role, disabled, createdAt, lastLoginAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertOidcIdentity = db.prepare(`
    INSERT INTO oidcIdentities (issuer, subject, userId, email, displayName, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    const insertDeviceMonitor = db.prepare(`
    INSERT INTO deviceMonitors (
      id,
      deviceId,
      name,
      type,
      target,
      port,
      path,
      snmpVersion,
      snmpCommunity,
      snmpOid,
      snmpExpectedValue,
      snmpMatchMode,
      portId,
      snmpIfIndex,
      snmpCredentialId,
      intervalMs,
      enabled,
      sortOrder,
      lastCheckAt,
      lastAlertAt,
      lastResult,
      lastMessage
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertSnmpCredential = db.prepare(`
    INSERT INTO snmpCredentials (
      id, labId, name, version,
      communityEnc, v3User, v3AuthProto, v3AuthPassEnc, v3PrivProto, v3PrivPassEnc, v3Context,
      createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertDockerImportSource = db.prepare(`
    INSERT INTO dockerImportSources (
      id, labId, name, endpoint, tokenEnc,
      lastSyncAt, lastSyncStatus, lastSyncMessage, createdAt, updatedAt, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertDockerContainerLink = db.prepare(`
    INSERT INTO dockerContainerLinks (
      deviceId, sourceId, containerId, containerName, image,
      state, status, lastSyncedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertSnmpTrapSource = db.prepare(`
    INSERT INTO snmpTrapSources (id, labId, deviceId, sourceIp, community, credentialId, lastTrapAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
    const insertSnmpTrapLog = db.prepare(`
    INSERT INTO snmpTrapLog (id, labId, deviceId, sourceIp, trapOid, ifIndex, varbindsJson, resultAction, message, receivedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertDeviceService = db.prepare(`
    INSERT INTO deviceServices (id, deviceId, name, serviceType, ipAssignmentId, portId, vlanId, monitorId, url, notes, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertWifiController = db.prepare(`
    INSERT INTO wifiControllers (id, labId, deviceId, name, vendor, model, managementIp, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertWifiSsid = db.prepare(`
    INSERT INTO wifiSsids (id, labId, name, purpose, security, hidden, vlanId, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertWifiAccessPoint = db.prepare(`
    INSERT INTO wifiAccessPoints (deviceId, controllerId, location, firmwareVersion, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
    const insertWifiRadio = db.prepare(`
    INSERT INTO wifiRadios (id, apDeviceId, slotName, band, channel, channelWidth, txPower, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertWifiRadioSsid = db.prepare(`
    INSERT INTO wifiRadioSsids (radioId, ssidId)
    VALUES (?, ?)
  `);
    const insertWifiClientAssociation = db.prepare(`
    INSERT INTO wifiClientAssociations
      (clientDeviceId, apDeviceId, radioId, ssidId, band, channel, signalDbm, lastSeen, lastRoamAt, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertAppSetting = db.prepare(`
    INSERT INTO appSettings (key, value, updatedAt)
    VALUES (?, ?, ?)
  `);

    for (const row of labs) {
      insertLab.run(
        row.id,
        row.name,
        row.description ?? null,
        row.location ?? null,
      );
    }
    for (const row of users) {
      insertUser.run(
        row.id,
        row.username,
        row.displayName,
        row.passwordHash,
        row.role,
        Number(row.disabled ?? 0),
        row.createdAt,
        row.lastLoginAt ?? null,
      );
    }
    for (const row of oidcIdentities) {
      insertOidcIdentity.run(
        row.issuer,
        row.subject,
        row.userId,
        row.email ?? null,
        row.displayName ?? null,
        row.createdAt,
        row.updatedAt,
      );
    }
    for (const row of rooms) {
      insertRoom.run(
        row.id,
        row.labId,
        row.name,
        row.description ?? null,
        row.location ?? null,
        row.notes ?? null,
      );
    }
    for (const row of racks) {
      insertRack.run(
        row.id,
        row.labId,
        row.name,
        row.totalU,
        row.description ?? null,
        row.location ?? null,
        row.notes ?? null,
        row.roomId ?? null,
      );
    }
    for (const row of snmpCredentials) {
      insertSnmpCredential.run(
        row.id,
        row.labId,
        row.name,
        row.version,
        row.communityEnc ?? null,
        row.v3User ?? null,
        row.v3AuthProto ?? null,
        row.v3AuthPassEnc ?? null,
        row.v3PrivProto ?? null,
        row.v3PrivPassEnc ?? null,
        row.v3Context ?? null,
        row.createdAt ?? new Date().toISOString(),
        row.updatedAt ?? row.createdAt ?? new Date().toISOString(),
      );
    }
    for (const row of dockerImportSources) {
      insertDockerImportSource.run(
        row.id,
        row.labId,
        row.name,
        row.endpoint,
        row.tokenEnc ?? null,
        row.lastSyncAt ?? null,
        row.lastSyncStatus ?? null,
        row.lastSyncMessage ?? null,
        row.createdAt ?? new Date().toISOString(),
        row.updatedAt ?? row.createdAt ?? new Date().toISOString(),
        row.enabled == null ? 1 : Number(Boolean(row.enabled)),
      );
    }
    for (const row of devices) {
      insertDevice.run(
        row.id,
        row.labId,
        row.rackId ?? null,
        row.hostname,
        row.displayName ?? null,
        row.deviceType,
        row.manufacturer ?? null,
        row.model ?? null,
        row.serial ?? null,
        row.managementIp ?? null,
        row.macAddress ?? null,
        row.status,
        row.placement ?? null,
        null,
        row.roomId ?? null,
        row.cpuCores ?? null,
        row.memoryGb ?? null,
        row.storageGb ?? null,
        row.specs ?? null,
        row.startU ?? null,
        row.heightU ?? null,
        row.face ?? null,
        row.rackSlot ?? "full",
        row.tags ? JSON.stringify(row.tags) : null,
        row.notes ?? null,
        row.lastSeen ?? null,
        row.networkMode ?? "normal",
        row.snmpCredentialId ?? null,
      );
    }
    const deviceIds = new Set(devices.map((row) => String(row.id)));
    for (const row of devices) {
      const parentDeviceId = row.parentDeviceId
        ? String(row.parentDeviceId)
        : null;
      if (
        !parentDeviceId ||
        parentDeviceId === String(row.id) ||
        !deviceIds.has(parentDeviceId)
      ) {
        continue;
      }
      updateDeviceParent.run(parentDeviceId, row.id);
    }
    for (const row of dockerContainerLinks) {
      insertDockerContainerLink.run(
        row.deviceId,
        row.sourceId,
        row.containerId,
        row.containerName,
        row.image,
        row.state,
        row.status,
        row.lastSyncedAt ?? null,
        row.createdAt ?? new Date().toISOString(),
        row.updatedAt ?? row.createdAt ?? new Date().toISOString(),
      );
    }
    for (const row of snmpTrapSources) {
      insertSnmpTrapSource.run(
        row.id,
        row.labId,
        row.deviceId ?? null,
        row.sourceIp,
        row.community ?? null,
        row.credentialId ?? null,
        row.lastTrapAt ?? null,
      );
    }
    for (const row of snmpTrapLog) {
      insertSnmpTrapLog.run(
        row.id,
        row.labId,
        row.deviceId ?? null,
        row.sourceIp,
        row.trapOid ?? null,
        row.ifIndex ?? null,
        row.varbindsJson ?? null,
        row.resultAction ?? "logged",
        row.message ?? "",
        row.receivedAt ?? new Date().toISOString(),
      );
    }
    for (const row of virtualSwitches) {
      insertVirtualSwitch.run(
        row.id,
        row.hostDeviceId,
        row.name,
        row.kind ?? "external",
        row.notes ?? null,
        Number(row.membersShareHostIp ?? 0),
      );
    }
    for (const row of vlans) {
      insertVlan.run(
        row.id,
        row.labId,
        row.vlanId,
        row.name,
        row.description ?? null,
        row.color ?? null,
      );
    }
    for (const row of vlanRanges) {
      insertVlanRange.run(
        row.id,
        row.labId,
        row.name,
        row.startVlan,
        row.endVlan,
        row.purpose ?? null,
        row.color ?? null,
      );
    }
    for (const row of subnets) {
      insertSubnet.run(
        row.id,
        row.labId,
        row.cidr,
        row.name,
        row.description ?? null,
        row.gateway ?? null,
        row.dnsServers ? JSON.stringify(row.dnsServers) : null,
        row.vlanId ?? null,
      );
    }
    for (const row of ports) {
      insertPort.run(
        row.id,
        row.deviceId,
        row.name,
        row.position,
        row.kind,
        row.speed ?? null,
        row.linkState,
        row.mode ?? "access",
        row.vlanId ?? null,
        row.allowedVlanIds ? JSON.stringify(row.allowedVlanIds) : null,
        row.description ?? null,
        row.face ?? null,
        row.virtualSwitchId ?? null,
        row.snmpIfIndex ?? null,
        row.macAddress ?? null,
        row.portRole ?? "physical",
        null,
      );
    }
    ensurePatchPanelPassThroughPorts(
      devices
        .filter((row) => row.deviceType === "patch_panel")
        .map((row) => String(row.id)),
    );
    const portIds = new Set(ports.map((row) => String(row.id)));
    for (const row of ports) {
      const aggregatePortId = row.aggregatePortId
        ? String(row.aggregatePortId)
        : null;
      if (aggregatePortId && portIds.has(aggregatePortId)) {
        updatePortAggregate.run(aggregatePortId, row.id);
      }
    }
    for (const row of portLinks) {
      insertPortLink.run(
        row.id,
        row.fromPortId,
        row.toPortId,
        row.cableType ?? null,
        row.cableLength ?? null,
        row.color ?? null,
        row.notes ?? null,
      );
    }
    for (const row of portTemplates) {
      insertPortTemplate.run(
        row.id,
        row.name,
        row.description,
        JSON.stringify(row.deviceTypes ?? []),
        JSON.stringify(row.ports ?? []),
        row.createdAt ?? new Date().toISOString(),
        row.updatedAt ?? new Date().toISOString(),
      );
    }
    for (const row of dhcpScopes) {
      insertDhcpScope.run(
        row.id,
        row.subnetId,
        row.name,
        row.startIp,
        row.endIp,
        row.gateway ?? null,
        row.dnsServers ? JSON.stringify(row.dnsServers) : null,
        row.description ?? null,
      );
    }
    for (const row of ipZones) {
      insertIpZone.run(
        row.id,
        row.subnetId,
        row.kind,
        row.startIp,
        row.endIp,
        row.description ?? null,
      );
    }
    for (const row of ipAssignments) {
      insertIpAssignment.run(
        row.id,
        row.subnetId,
        row.ipAddress,
        row.assignmentType,
        row.deviceId ?? null,
        row.portId ?? null,
        row.vmId ?? null,
        row.containerId ?? null,
        row.hostname ?? null,
        row.description ?? null,
        row.allocationMode ?? "static",
        row.dhcpScopeId ?? null,
      );
    }
    for (const row of discoveredDevices) {
      insertDiscoveredDevice.run(
        row.id,
        row.labId,
        row.ipAddress,
        row.hostname ?? null,
        row.displayName ?? null,
        row.deviceType ?? null,
        row.placement ?? null,
        row.macAddress ?? null,
        row.vendor ?? null,
        row.source,
        row.status ?? "new",
        row.notes ?? null,
        row.importedDeviceId ?? null,
        row.lastSeen ?? null,
        row.lastScannedAt ?? new Date().toISOString(),
        row.technicalRole ?? null,
        row.technicalReason ?? null,
      );
    }
    for (const row of discoveryScanSchedules) {
      const now = new Date().toISOString();
      insertDiscoveryScanSchedule.run(
        row.id,
        row.labId,
        row.name ?? null,
        row.cidr,
        row.intervalMs ?? 3_600_000,
        row.enabled === false || row.enabled === 0 ? 0 : 1,
        row.lastRunAt ?? null,
        row.lastResult ?? null,
        row.lastMessage ?? null,
        row.createdAt ?? now,
        row.updatedAt ?? row.createdAt ?? now,
      );
    }
    for (const row of documentationPages) {
      const now = new Date().toISOString();
      insertDocumentationPage.run(
        row.id,
        row.labId,
        row.title,
        row.content ?? "",
        row.createdAt ?? now,
        row.updatedAt ?? row.createdAt ?? now,
      );
    }
    for (const row of documentationDeviceLinks) {
      const now = new Date().toISOString();
      insertDocumentationDeviceLink.run(
        row.id,
        row.documentationPageId,
        row.deviceId,
        row.createdAt ?? now,
      );
    }
    for (const row of referenceImages) {
      const now = new Date().toISOString();
      insertReferenceImage.run(
        row.id,
        row.labId,
        row.entityType,
        row.entityId,
        row.label,
        row.fileName,
        row.mimeType,
        row.dataUrl,
        row.face ?? null,
        row.notes ?? null,
        row.createdAt ?? now,
        row.updatedAt ?? row.createdAt ?? now,
      );
    }
    for (const row of deviceImages) {
      const now = new Date().toISOString();
      insertDeviceImage.run(
        row.id,
        row.deviceId,
        row.label,
        row.fileName,
        row.mimeType,
        row.dataUrl,
        row.notes ?? null,
        row.createdAt ?? now,
        row.updatedAt ?? row.createdAt ?? now,
      );
    }
    for (const row of auditLog) {
      insertAudit.run(
        row.id,
        row.ts,
        row.user,
        row.action,
        row.entityType,
        row.entityId,
        row.summary,
      );
    }
    for (const row of deviceMonitors) {
      insertDeviceMonitor.run(
        row.id,
        row.deviceId,
        row.name ?? "Primary",
        row.type,
        row.target ?? null,
        row.port ?? null,
        row.path ?? null,
        row.snmpVersion ?? null,
        row.snmpCommunity ?? null,
        row.snmpOid ?? null,
        row.snmpExpectedValue ?? null,
        row.snmpMatchMode ?? "equals",
        row.portId ?? null,
        row.snmpIfIndex ?? null,
        row.snmpCredentialId ?? null,
        row.intervalMs ?? null,
        row.type === "none" ? 0 : Number(row.enabled ?? 0),
        row.sortOrder ?? 0,
        row.lastCheckAt ?? null,
        row.lastAlertAt ?? null,
        row.lastResult ?? null,
        row.lastMessage ?? null,
      );
    }
    for (const row of deviceServices) {
      const now = new Date().toISOString();
      insertDeviceService.run(
        row.id,
        row.deviceId,
        row.name,
        row.serviceType,
        row.ipAssignmentId ?? null,
        row.portId ?? null,
        row.vlanId ?? null,
        row.monitorId ?? null,
        row.url ?? null,
        row.notes ?? null,
        row.createdAt ?? now,
        row.updatedAt ?? row.createdAt ?? now,
      );
    }
    for (const row of wifiControllers) {
      insertWifiController.run(
        row.id,
        row.labId,
        row.deviceId ?? null,
        row.name,
        row.vendor ?? null,
        row.model ?? null,
        row.managementIp ?? null,
        row.notes ?? null,
      );
    }
    for (const row of wifiSsids) {
      insertWifiSsid.run(
        row.id,
        row.labId,
        row.name,
        row.purpose ?? null,
        row.security ?? null,
        Number(row.hidden ?? 0),
        row.vlanId ?? null,
        row.color ?? null,
      );
    }
    for (const row of wifiAccessPoints) {
      insertWifiAccessPoint.run(
        row.deviceId,
        row.controllerId ?? null,
        row.location ?? null,
        row.firmwareVersion ?? null,
        row.notes ?? null,
      );
    }
    for (const row of wifiRadios) {
      insertWifiRadio.run(
        row.id,
        row.apDeviceId,
        row.slotName,
        row.band,
        row.channel,
        row.channelWidth ?? null,
        row.txPower ?? null,
        row.notes ?? null,
      );
    }
    for (const row of wifiRadioSsids) {
      insertWifiRadioSsid.run(row.radioId, row.ssidId);
    }
    for (const row of wifiClientAssociations) {
      insertWifiClientAssociation.run(
        row.clientDeviceId,
        row.apDeviceId,
        row.radioId ?? null,
        row.ssidId ?? null,
        row.band ?? null,
        row.channel ?? null,
        row.signalDbm ?? null,
        row.lastSeen ?? null,
        row.lastRoamAt ?? null,
        row.notes ?? null,
      );
    }
    for (const row of appSettings) {
      insertAppSetting.run(
        row.key,
        row.value,
        row.updatedAt ?? new Date().toISOString(),
      );
    }

    const restoredAt = new Date().toISOString();
    const restoreAuditId = createId("a");
    insertAudit.run(
      restoreAuditId,
      restoredAt,
      restoredBy,
      "admin.restore",
      "Backup",
      restoreAuditId,
      `Restored Rackpad backup exported at ${String(snapshot.exportedAt ?? "unknown time")}`,
    );

    setBootstrapState(users.length === 0);

    return {
      restored: true,
      requiresLogin: true,
      counts: {
        labs: labs.length,
        rooms: rooms.length,
        racks: racks.length,
        devices: devices.length,
        virtualSwitches: virtualSwitches.length,
        discoveredDevices: discoveredDevices.length,
        discoveryScanSchedules: discoveryScanSchedules.length,
        documentationPages: documentationPages.length,
        documentationDeviceLinks: documentationDeviceLinks.length,
        deviceImages: deviceImages.length,
        referenceImages: referenceImages.length,
        deviceServices: deviceServices.length,
        portTemplates: portTemplates.length,
        wifiControllers: wifiControllers.length,
        wifiSsids: wifiSsids.length,
        wifiRadios: wifiRadios.length,
        wifiClientAssociations: wifiClientAssociations.length,
        vlans: vlans.length,
        subnets: subnets.length,
        users: users.length,
      },
    };
  },
);

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/integrity", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const subnetRows = db
      .prepare(
        `
      SELECT subnets.id, subnets.labId, subnets.cidr, subnets.name,
        (SELECT COUNT(*) FROM ipAssignments WHERE ipAssignments.subnetId = subnets.id) AS assignmentCount,
        (SELECT COUNT(*) FROM dhcpScopes WHERE dhcpScopes.subnetId = subnets.id) AS scopeCount,
        (SELECT COUNT(*) FROM ipZones WHERE ipZones.subnetId = subnets.id) AS zoneCount
      FROM subnets
      ORDER BY subnets.labId, subnets.cidr, subnets.id
    `,
      )
      .all() as Array<{
      id: string;
      labId: string;
      cidr: string;
      name: string;
      assignmentCount: number;
      scopeCount: number;
      zoneCount: number;
    }>;
    const subnetConflicts = subnetRows.flatMap((row) => {
      const integrity = getSubnetIntegrity(row);
      if (integrity.state === "ok") return [];
      return [
        {
          id: row.id,
          labId: row.labId,
          cidr: row.cidr,
          name: row.name,
          integrity,
          childCounts: {
            assignments: row.assignmentCount,
            dhcpScopes: row.scopeCount,
            zones: row.zoneCount,
          },
        },
      ];
    });
    return {
      checkedAt: new Date().toISOString(),
      subnetConflicts,
      assignmentReferences: listAssignmentIntegrityIssues(),
    };
  });

  app.get("/ui-settings", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return loadUiSettings();
  });

  app.put("/ui-settings", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = asObject(req.body);
    const saved = saveUiSettings({
      defaultLanguage: normalizeLanguage(body.defaultLanguage),
    });
    db.prepare(
      `
      INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      createId("a"),
      new Date().toISOString(),
      req.authUser.username,
      "admin.ui_settings.update",
      "UiSettings",
      "ui-settings",
      `Updated default language to ${saved.defaultLanguage}.`,
    );
    return saved;
  });

  app.get("/alert-settings", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return loadAlertSettings();
  });

  app.put("/alert-settings", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = asObject(req.body);
    const saved = saveAlertSettings({
      enabled: optionalBoolean(body, "enabled") ?? false,
      notifyOnDown: optionalBoolean(body, "notifyOnDown") ?? true,
      notifyOnRecovery: optionalBoolean(body, "notifyOnRecovery") ?? true,
      repeatWhileOffline: optionalBoolean(body, "repeatWhileOffline") ?? false,
      repeatIntervalMinutes:
        optionalInteger(body, "repeatIntervalMinutes", {
          min: 1,
          max: 10080,
        }) ?? 60,
      discordWebhookUrl: optionalString(body, "discordWebhookUrl", {
        maxLength: 1000,
      }),
      telegramBotToken: optionalString(body, "telegramBotToken", {
        maxLength: 255,
      }),
      telegramChatId: optionalString(body, "telegramChatId", {
        maxLength: 255,
      }),
      smtpHost: optionalString(body, "smtpHost", { maxLength: 255 }),
      smtpPort: optionalInteger(body, "smtpPort", { min: 1, max: 65535 }),
      smtpSecure: optionalBoolean(body, "smtpSecure") ?? false,
      smtpUsername: optionalString(body, "smtpUsername", { maxLength: 255 }),
      smtpPassword: optionalString(body, "smtpPassword", {
        maxLength: 255,
        allowEmpty: true,
      }),
      smtpFrom: optionalString(body, "smtpFrom", { maxLength: 255 }),
      smtpTo: optionalString(body, "smtpTo", { maxLength: 1000 }),
    });
    db.prepare(
      `
      INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      createId("a"),
      new Date().toISOString(),
      req.authUser.username,
      "alert.settings.update",
      "AlertSettings",
      "alert-settings",
      "Updated notification channels and delivery controls.",
    );
    return saved;
  });

  app.post("/alert-settings/test", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return sendTestAlert(req.authUser.username);
  });

  app.get("/export", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;

    const exportedAt = new Date().toISOString();
    const filename = createBackupFilename(exportedAt);
    const snapshot = exportBackupSnapshot(
      exportedAt,
      req.authUser.username,
      filename,
    );

    reply.header("Cache-Control", "no-store");
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);

    return snapshot;
  });

  app.post("/restore", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const snapshot = asObject(req.body);
    return reply.send(restoreBackupSnapshot(snapshot, req.authUser.username));
  });
};
