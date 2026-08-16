import { db } from "../../db.js";
import { createId } from "../ids.js";
import {
  INTEGRATION_PORT_KINDS,
  type IntegrationImportableDevice,
  type IntegrationPortKind,
  type IntegrationWifiInventory,
} from "./inventory.js";

const IMPORTABLE_DEVICE_TYPES = [
  "switch",
  "router",
  "firewall",
  "ap",
  "server",
  "other",
] as const;

function text(value: unknown, maxLength = 200): string {
  if (value == null) return "";
  return String(value).trim().slice(0, maxLength);
}

// The apply route round-trips the previewed inventory through the client,
// so every field is re-validated and coerced before touching the database.
export function sanitizeImportableDevices(
  value: unknown,
): IntegrationImportableDevice[] {
  if (!Array.isArray(value)) return [];
  const devices: IntegrationImportableDevice[] = [];
  for (const entry of value.slice(0, 500)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = text(row.name, 120);
    const deviceType = text(row.deviceType, 20);
    if (!name) continue;
    if (
      !(IMPORTABLE_DEVICE_TYPES as readonly string[]).includes(deviceType)
    ) {
      continue;
    }
    const ports = Array.isArray(row.ports)
      ? row.ports.slice(0, 128).flatMap((portEntry) => {
          if (!portEntry || typeof portEntry !== "object") return [];
          const port = portEntry as Record<string, unknown>;
          const portName = text(port.name, 80);
          const kind = text(port.kind, 20);
          if (!portName) return [];
          if (!(INTEGRATION_PORT_KINDS as readonly string[]).includes(kind)) {
            return [];
          }
          const linkState = text(port.linkState, 10);
          return [
            {
              name: portName,
              kind: kind as IntegrationPortKind,
              speed: text(port.speed, 20) || null,
              linkState: (linkState === "up" || linkState === "down"
                ? linkState
                : "unknown") as "up" | "down" | "unknown",
            },
          ];
        })
      : [];
    devices.push({
      name,
      deviceType: deviceType as IntegrationImportableDevice["deviceType"],
      model: text(row.model, 120) || null,
      macAddress: text(row.macAddress, 40) || null,
      ipAddress: text(row.ipAddress, 60) || null,
      serial: text(row.serial, 120) || null,
      firmware: text(row.firmware, 120) || null,
      online:
        row.online === true ? true : row.online === false ? false : null,
      ports,
    });
  }
  return devices;
}

export function sanitizeWifiInventory(
  value: unknown,
): IntegrationWifiInventory | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const controllerName = text(row.controllerName, 120);
  if (!controllerName) return null;
  const ssids = Array.isArray(row.ssids)
    ? row.ssids.slice(0, 200).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const ssid = entry as Record<string, unknown>;
        const name = text(ssid.name, 120);
        if (!name) return [];
        const vlanNumber = Number(ssid.vlanNumber);
        return [
          {
            name,
            vlanNumber:
              Number.isInteger(vlanNumber) &&
              vlanNumber >= 1 &&
              vlanNumber <= 4094
                ? vlanNumber
                : null,
            security: text(ssid.security, 60) || null,
            hidden: ssid.hidden === true,
          },
        ];
      })
    : [];
  return {
    controllerName,
    vendor: text(row.vendor, 60) || "Unknown",
    managementIp: text(row.managementIp, 60) || null,
    ssids,
  };
}

export interface IntegrationDeviceDiff {
  action: "create" | "exists";
  name: string;
  deviceType: IntegrationImportableDevice["deviceType"];
  model: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  portCount: number;
  existingId?: string;
  existingHostname?: string;
}

export interface IntegrationSsidDiff {
  action: "create" | "exists";
  name: string;
  vlanNumber: number | null;
}

export interface IntegrationDeviceSyncPlan {
  labId: string;
  devices: IntegrationDeviceDiff[];
  ssids: IntegrationSsidDiff[];
  controllerName: string | null;
}

export interface IntegrationDeviceSyncResult {
  createdDeviceIds: string[];
  createdPortCount: number;
  createdSsidIds: string[];
  linkedAccessPoints: number;
  skipped: string[];
}

function normalizeMac(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

interface ExistingDeviceRow {
  id: string;
  hostname: string;
  displayName: string | null;
  macAddress: string | null;
}

function existingLabDevices(labId: string): ExistingDeviceRow[] {
  return db
    .prepare(
      "SELECT id, hostname, displayName, macAddress FROM devices WHERE labId = ?",
    )
    .all(labId) as ExistingDeviceRow[];
}

function matchDevice(
  device: IntegrationImportableDevice,
  existing: ExistingDeviceRow[],
): ExistingDeviceRow | undefined {
  const mac = normalizeMac(device.macAddress);
  if (mac) {
    const byMac = existing.find(
      (row) => normalizeMac(row.macAddress) === mac,
    );
    if (byMac) return byMac;
  }
  const name = device.name.trim().toLowerCase();
  if (!name) return undefined;
  return existing.find(
    (row) =>
      row.hostname.trim().toLowerCase() === name ||
      (row.displayName ?? "").trim().toLowerCase() === name,
  );
}

// Merge semantics only: existing devices and SSIDs are matched (by MAC,
// then hostname/display name) and left untouched; only missing records
// are offered for creation.
export function buildIntegrationDeviceSyncPlan(input: {
  labId: string;
  importableDevices: IntegrationImportableDevice[];
  wifi: IntegrationWifiInventory | null;
}): IntegrationDeviceSyncPlan {
  const existing = existingLabDevices(input.labId);
  const devices: IntegrationDeviceDiff[] = [];
  const seenNames = new Set<string>();

  for (const device of input.importableDevices) {
    const name = device.name.trim();
    if (!name) continue;
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);
    const match = matchDevice(device, existing);
    devices.push({
      action: match ? "exists" : "create",
      name,
      deviceType: device.deviceType,
      model: device.model,
      macAddress: device.macAddress,
      ipAddress: device.ipAddress,
      portCount: device.ports.length,
      existingId: match?.id,
      existingHostname: match?.hostname,
    });
  }

  const ssids: IntegrationSsidDiff[] = [];
  if (input.wifi) {
    const existingSsids = new Set(
      (
        db
          .prepare("SELECT name FROM wifiSsids WHERE labId = ?")
          .all(input.labId) as Array<{ name: string }>
      ).map((row) => row.name.trim().toLowerCase()),
    );
    const seenSsids = new Set<string>();
    for (const ssid of input.wifi.ssids) {
      const name = ssid.name.trim();
      if (!name || seenSsids.has(name.toLowerCase())) continue;
      seenSsids.add(name.toLowerCase());
      ssids.push({
        action: existingSsids.has(name.toLowerCase()) ? "exists" : "create",
        name,
        vlanNumber: ssid.vlanNumber ?? null,
      });
    }
  }

  return {
    labId: input.labId,
    devices,
    ssids,
    controllerName: input.wifi?.controllerName ?? null,
  };
}

export function applyIntegrationDeviceSync(input: {
  labId: string;
  importableDevices: IntegrationImportableDevice[];
  wifi: IntegrationWifiInventory | null;
  vendor: string;
  actor: string;
}): IntegrationDeviceSyncResult {
  const result: IntegrationDeviceSyncResult = {
    createdDeviceIds: [],
    createdPortCount: 0,
    createdSsidIds: [],
    linkedAccessPoints: 0,
    skipped: [],
  };
  const now = new Date().toISOString();

  const insertDevice = db.prepare(`
    INSERT INTO devices
      (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
       serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId,
       cpuCores, memoryGb, storageGb, specs, startU, heightU, face, tags, notes, lastSeen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertPort = db.prepare(`
    INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face, virtualSwitchId, macAddress)
    VALUES (@id, @deviceId, @name, @position, @kind, @speed, @linkState, @mode, @vlanId, @allowedVlanIds, @description, @face, @virtualSwitchId, @macAddress)
  `);
  const writeAudit = db.prepare(`
    INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
    VALUES (?, ?, ?, ?, 'IntegrationSync', ?, ?)
  `);

  const apply = db.transaction(() => {
    const existing = existingLabDevices(input.labId);
    const apDeviceIds: string[] = [];

    for (const device of input.importableDevices) {
      const name = device.name.trim();
      if (!name) continue;
      const match = matchDevice(device, existing);
      if (match) {
        if (device.deviceType === "ap") apDeviceIds.push(match.id);
        continue;
      }
      const hostnameTaken = existing.some(
        (row) => row.hostname.trim().toLowerCase() === name.toLowerCase(),
      );
      if (hostnameTaken) {
        result.skipped.push(name);
        continue;
      }

      const deviceId = createId("d");
      // Loose gear: no rack, no room — visible in Devices and the
      // loose-device visualizer layout until someone places it.
      insertDevice.run(
        deviceId,
        input.labId,
        null,
        name,
        name,
        device.deviceType,
        input.vendor || null,
        device.model,
        device.serial,
        device.ipAddress,
        device.macAddress,
        device.online == null ? "unknown" : device.online ? "online" : "offline",
        "room",
        null,
        "normal",
        null,
        null,
        null,
        null,
        device.firmware ? `firmware: ${device.firmware}` : null,
        null,
        1,
        null,
        null,
        null,
        device.online ? now : null,
      );
      existing.push({
        id: deviceId,
        hostname: name,
        displayName: name,
        macAddress: device.macAddress,
      });
      result.createdDeviceIds.push(deviceId);
      if (device.deviceType === "ap") apDeviceIds.push(deviceId);

      device.ports.forEach((port, index) => {
        insertPort.run({
          id: createId("p"),
          deviceId,
          name: port.name,
          position: index + 1,
          kind: port.kind,
          speed: port.speed,
          linkState: port.linkState,
          mode: "access",
          vlanId: null,
          allowedVlanIds: null,
          description: null,
          face: "front",
          virtualSwitchId: null,
          macAddress: null,
        });
        result.createdPortCount += 1;
      });

      writeAudit.run(
        createId("a"),
        now,
        input.actor,
        "integration.sync.device.create",
        deviceId,
        `Imported ${device.deviceType} ${name} from a controller integration.`,
      );
    }

    if (input.wifi) {
      let controllerId: string | null = null;
      const controllerRow = db
        .prepare(
          "SELECT id FROM wifiControllers WHERE labId = ? AND name = ?",
        )
        .get(input.labId, input.wifi.controllerName) as
        | { id: string }
        | undefined;
      if (controllerRow) {
        controllerId = controllerRow.id;
      } else {
        controllerId = createId("wific");
        db.prepare(
          `
          INSERT INTO wifiControllers (id, labId, deviceId, name, vendor, model, managementIp, notes)
          VALUES (?, ?, NULL, ?, ?, NULL, ?, NULL)
        `,
        ).run(
          controllerId,
          input.labId,
          input.wifi.controllerName,
          input.vendor,
          input.wifi.managementIp,
        );
        writeAudit.run(
          createId("a"),
          now,
          input.actor,
          "integration.sync.wifi.controller.create",
          controllerId,
          `Created WiFi controller ${input.wifi.controllerName}.`,
        );
      }

      const vlanIdByNumber = new Map<number, string>(
        (
          db
            .prepare("SELECT id, vlanId FROM vlans WHERE labId = ?")
            .all(input.labId) as Array<{ id: string; vlanId: number }>
        ).map((row) => [Number(row.vlanId), row.id]),
      );
      for (const ssid of input.wifi.ssids) {
        const name = ssid.name.trim();
        if (!name) continue;
        const existingSsid = db
          .prepare(
            "SELECT id FROM wifiSsids WHERE labId = ? AND name = ?",
          )
          .get(input.labId, name);
        if (existingSsid) continue;
        const ssidId = createId("ssid");
        db.prepare(
          `
          INSERT INTO wifiSsids (id, labId, name, purpose, security, hidden, vlanId, color)
          VALUES (?, ?, ?, NULL, ?, ?, ?, NULL)
        `,
        ).run(
          ssidId,
          input.labId,
          name,
          ssid.security,
          ssid.hidden ? 1 : 0,
          ssid.vlanNumber != null
            ? (vlanIdByNumber.get(ssid.vlanNumber) ?? null)
            : null,
        );
        result.createdSsidIds.push(ssidId);
        writeAudit.run(
          createId("a"),
          now,
          input.actor,
          "integration.sync.wifi.ssid.create",
          ssidId,
          `Created SSID ${name}.`,
        );
      }

      // Link AP device records to the controller without touching any
      // manually maintained location or notes.
      for (const apDeviceId of apDeviceIds) {
        const firmware =
          input.importableDevices.find(
            (device) =>
              device.deviceType === "ap" &&
              matchesApDevice(device, apDeviceId, input.labId),
          )?.firmware ?? null;
        db.prepare(
          `
          INSERT INTO wifiAccessPoints (deviceId, controllerId, location, firmwareVersion, notes)
          VALUES (?, ?, NULL, ?, NULL)
          ON CONFLICT(deviceId) DO UPDATE SET
            controllerId = excluded.controllerId,
            firmwareVersion = COALESCE(excluded.firmwareVersion, wifiAccessPoints.firmwareVersion)
        `,
        ).run(apDeviceId, controllerId, firmware);
        result.linkedAccessPoints += 1;
      }
    }
  });

  apply();
  return result;
}

function matchesApDevice(
  device: IntegrationImportableDevice,
  deviceId: string,
  labId: string,
) {
  const row = db
    .prepare(
      "SELECT hostname, displayName, macAddress FROM devices WHERE id = ? AND labId = ?",
    )
    .get(deviceId, labId) as ExistingDeviceRow | undefined;
  if (!row) return false;
  const mac = normalizeMac(device.macAddress);
  if (mac && normalizeMac(row.macAddress) === mac) return true;
  const name = device.name.trim().toLowerCase();
  return (
    row.hostname.trim().toLowerCase() === name ||
    (row.displayName ?? "").trim().toLowerCase() === name
  );
}
