import { db } from "../../db.js";
import { createHash } from "node:crypto";
import { cidrContainsHostIp } from "../ip-cidr.js";
import { createId } from "../ids.js";
import { ensureIpv4 } from "../validation.js";
import {
  INTEGRATION_PORT_KINDS,
  type IntegrationImportableDevice,
  type IntegrationPortKind,
  type IntegrationVirtualSwitchSpec,
  type IntegrationWifiInventory,
} from "./inventory.js";

const IMPORTABLE_DEVICE_TYPES = [
  "switch",
  "router",
  "firewall",
  "ap",
  "server",
  "vm",
  "container",
  "other",
] as const;

function text(value: unknown, maxLength = 200): string {
  if (value == null) return "";
  return String(value).trim().slice(0, maxLength);
}

function providerRecordId(
  kind: "device" | "virtual-switch" | "ssid",
  identity: unknown,
  index: number,
) {
  const digest = createHash("sha256")
    .update(JSON.stringify([identity, index]))
    .digest("base64url")
    .slice(0, 24);
  return `${kind}:${digest}`;
}

// Provider responses are untrusted. Sanitize once on the server before issuing
// the opaque snapshot token; apply later consumes only that stored snapshot.
function sanitizeVlanNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 4094
    ? number
    : null;
}

export function sanitizeImportableDevices(
  value: unknown,
  warnings: string[] = [],
): IntegrationImportableDevice[] {
  if (!Array.isArray(value)) return [];
  const devices: IntegrationImportableDevice[] = [];
  for (const [deviceIndex, entry] of value.slice(0, 500).entries()) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = text(row.name, 120);
    const deviceType = text(row.deviceType, 20);
    if (!name) continue;
    if (!(IMPORTABLE_DEVICE_TYPES as readonly string[]).includes(deviceType)) {
      continue;
    }
    const seenPortNames = new Set<string>();
    const ports = Array.isArray(row.ports)
      ? row.ports.slice(0, 128).flatMap((portEntry) => {
          if (!portEntry || typeof portEntry !== "object") return [];
          const port = portEntry as Record<string, unknown>;
          const portName = text(port.name, 80);
          const kind = text(port.kind, 20);
          if (!portName) return [];
          const portKey = portName.toLowerCase();
          if (seenPortNames.has(portKey)) {
            warnings.push(`${name}: duplicate port ${portName} was skipped.`);
            return [];
          }
          seenPortNames.add(portKey);
          if (!(INTEGRATION_PORT_KINDS as readonly string[]).includes(kind)) {
            return [];
          }
          const linkState = text(port.linkState, 10);
          const mode = text(port.mode, 10);
          const taggedVlanNumbers = Array.isArray(port.taggedVlanNumbers)
            ? [
                ...new Set(
                  port.taggedVlanNumbers
                    .map(sanitizeVlanNumber)
                    .filter((number): number is number => number != null),
                ),
              ].slice(0, 64)
            : [];
          return [
            {
              name: portName,
              kind: kind as IntegrationPortKind,
              speed: text(port.speed, 20) || null,
              linkState: (linkState === "up" || linkState === "down"
                ? linkState
                : "unknown") as "up" | "down" | "unknown",
              mode: (mode === "access" || mode === "trunk" ? mode : null) as
                "access" | "trunk" | null,
              untaggedVlanNumber: sanitizeVlanNumber(port.untaggedVlanNumber),
              taggedVlanNumbers,
              macAddress: sanitizeMacAddress(
                port.macAddress,
                warnings,
                `${name}/${portName}`,
              ),
              virtualSwitchName: text(port.virtualSwitchName, 120) || null,
              ipAddresses: Array.isArray(port.ipAddresses)
                ? [
                    ...new Set(
                      port.ipAddresses
                        .slice(0, 16)
                        .map((entry) => sanitizeIpv4(entry, warnings, `${name}/${portName}`))
                        .filter((entry): entry is string => Boolean(entry)),
                    ),
                  ]
                : [],
            },
          ];
        })
      : [];
    devices.push({
      providerRecordId: providerRecordId(
        "device",
        [deviceType, name, row.macAddress, row.serial, row.parentName],
        deviceIndex,
      ),
      name,
      deviceType: deviceType as IntegrationImportableDevice["deviceType"],
      model: text(row.model, 120) || null,
      macAddress: sanitizeMacAddress(row.macAddress, warnings, name),
      ipAddress: sanitizeIpv4(row.ipAddress, warnings, name),
      serial: text(row.serial, 120) || null,
      firmware: text(row.firmware, 120) || null,
      online: row.online === true ? true : row.online === false ? false : null,
      parentName: text(row.parentName, 120) || null,
      ports,
    });
  }
  return devices;
}

export function sanitizeVirtualSwitches(
  value: unknown,
): IntegrationVirtualSwitchSpec[] {
  if (!Array.isArray(value)) return [];
  const switches: IntegrationVirtualSwitchSpec[] = [];
  for (const [switchIndex, entry] of value.slice(0, 200).entries()) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = text(row.name, 120);
    const hostName = text(row.hostName, 120);
    if (!name || !hostName) continue;
    const kind = text(row.kind, 20);
    switches.push({
      providerRecordId: providerRecordId(
        "virtual-switch",
        [hostName, name],
        switchIndex,
      ),
      name,
      hostName,
      kind:
        kind === "internal" || kind === "private"
          ? (kind as "internal" | "private")
          : "external",
      notes: text(row.notes, 500) || null,
    });
  }
  return switches;
}

export function sanitizeWifiInventory(
  value: unknown,
  warnings: string[] = [],
): IntegrationWifiInventory | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const controllerName = text(row.controllerName, 120);
  if (!controllerName) return null;
  const ssids = Array.isArray(row.ssids)
    ? row.ssids.slice(0, 200).flatMap((entry, ssidIndex) => {
        if (!entry || typeof entry !== "object") return [];
        const ssid = entry as Record<string, unknown>;
        const name = text(ssid.name, 120);
        if (!name) return [];
        const vlanNumber = Number(ssid.vlanNumber);
        return [
          {
            providerRecordId: providerRecordId(
              "ssid",
              [controllerName, name, ssid.vlanNumber],
              ssidIndex,
            ),
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
    managementIp: sanitizeIpv4(
      row.managementIp,
      warnings,
      `${controllerName} controller`,
    ),
    ssids,
  };
}

export interface IntegrationDeviceDiff {
  providerRecordId: string;
  action: "create" | "exists";
  name: string;
  deviceType: IntegrationImportableDevice["deviceType"];
  model: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  portCount: number;
  existingId?: string;
  existingHostname?: string;
  proposedUpdates: string[];
}

export interface IntegrationSsidDiff {
  providerRecordId: string;
  action: "create" | "exists";
  name: string;
  vlanNumber: number | null;
}

export interface IntegrationVirtualSwitchDiff {
  providerRecordId: string;
  action: "create" | "exists";
  name: string;
  hostName: string;
}

export interface IntegrationDeviceSyncPlan {
  labId: string;
  devices: IntegrationDeviceDiff[];
  ssids: IntegrationSsidDiff[];
  virtualSwitches: IntegrationVirtualSwitchDiff[];
  controllerName: string | null;
}

export interface IntegrationDeviceSyncResult {
  createdDeviceIds: string[];
  createdPortCount: number;
  createdSsidIds: string[];
  createdVirtualSwitchIds: string[];
  createdIpAssignmentIds: string[];
  linkedAccessPoints: number;
  skipped: string[];
}

function normalizeMac(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

// Stored MACs are canonicalized to uppercase colon-separated form
// (AA:BB:CC:DD:EE:FF) regardless of how the controller writes them.
export function canonicalMacAddress(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeMac(value);
  if (normalized.length !== 12) return null;
  return (normalized.match(/.{2}/g) ?? []).join(":").toUpperCase();
}

function sanitizeIpv4(
  value: unknown,
  warnings: string[],
  source: string,
): string | null {
  const candidate = text(value, 60);
  if (!candidate) return null;
  try {
    return ensureIpv4(candidate);
  } catch {
    warnings.push(`${source}: invalid IPv4 address ${candidate} was skipped.`);
    return null;
  }
}

function sanitizeMacAddress(
  value: unknown,
  warnings: string[],
  source: string,
): string | null {
  const candidate = text(value, 40);
  if (!candidate) return null;
  const canonical = canonicalMacAddress(candidate);
  if (!canonical) {
    warnings.push(`${source}: invalid MAC address ${candidate} was skipped.`);
  }
  return canonical;
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
    const byMac = existing.find((row) => normalizeMac(row.macAddress) === mac);
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
  virtualSwitches?: IntegrationVirtualSwitchSpec[];
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
      providerRecordId:
        device.providerRecordId ??
        providerRecordId("device", [device.deviceType, name], devices.length),
      action: match ? "exists" : "create",
      name,
      deviceType: device.deviceType,
      model: device.model,
      macAddress: device.macAddress,
      ipAddress: device.ipAddress,
      portCount: device.ports.length,
      existingId: match?.id,
      existingHostname: match?.hostname,
      proposedUpdates: [],
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
        providerRecordId:
          ssid.providerRecordId ??
          providerRecordId("ssid", [input.wifi.controllerName, name], ssids.length),
        action: existingSsids.has(name.toLowerCase()) ? "exists" : "create",
        name,
        vlanNumber: ssid.vlanNumber ?? null,
      });
    }
  }

  const virtualSwitches: IntegrationVirtualSwitchDiff[] = [];
  if (input.virtualSwitches && input.virtualSwitches.length > 0) {
    const existingSwitches = new Set(
      (
        db
          .prepare(
            `SELECT devices.hostname AS host, virtualSwitches.name AS name
             FROM virtualSwitches
             JOIN devices ON devices.id = virtualSwitches.hostDeviceId
             WHERE devices.labId = ?`,
          )
          .all(input.labId) as Array<{ host: string; name: string }>
      ).map(
        (row) =>
          `${row.host.trim().toLowerCase()}|${row.name.trim().toLowerCase()}`,
      ),
    );
    for (const vswitch of input.virtualSwitches) {
      const key = `${vswitch.hostName.trim().toLowerCase()}|${vswitch.name.trim().toLowerCase()}`;
      virtualSwitches.push({
        providerRecordId:
          vswitch.providerRecordId ??
          providerRecordId(
            "virtual-switch",
            [vswitch.hostName, vswitch.name],
            virtualSwitches.length,
          ),
        action: existingSwitches.has(key) ? "exists" : "create",
        name: vswitch.name,
        hostName: vswitch.hostName,
      });
    }
  }

  return {
    labId: input.labId,
    devices,
    ssids,
    virtualSwitches,
    controllerName: input.wifi?.controllerName ?? null,
  };
}

export function applyIntegrationDeviceSync(input: {
  labId: string;
  importableDevices: IntegrationImportableDevice[];
  wifi: IntegrationWifiInventory | null;
  virtualSwitches?: IntegrationVirtualSwitchSpec[] | null;
  vendor: string;
  actor: string;
}): IntegrationDeviceSyncResult {
  const result: IntegrationDeviceSyncResult = {
    createdDeviceIds: [],
    createdPortCount: 0,
    createdSsidIds: [],
    createdVirtualSwitchIds: [],
    createdIpAssignmentIds: [],
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
  const insertVirtualSwitch = db.prepare(`
    INSERT INTO virtualSwitches (id, hostDeviceId, name, kind, membersShareHostIp, notes)
    VALUES (?, ?, ?, ?, 0, ?)
  `);
  const writeAudit = db.prepare(`
    INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
    VALUES (?, ?, ?, ?, 'IntegrationSync', ?, ?)
  `);

  const apply = db.transaction(() => {
    const existing = existingLabDevices(input.labId);
    const apDeviceIds: string[] = [];
    // Interconnect what we can: a device IP that falls inside a subnet the
    // lab already tracks becomes an IP assignment (merge-only — existing
    // assignments on that address are left alone).
    const labSubnets = db
      .prepare("SELECT id, cidr FROM subnets WHERE labId = ?")
      .all(input.labId) as Array<{ id: string; cidr: string }>;
    const assignmentExists = db.prepare(
      "SELECT id FROM ipAssignments WHERE subnetId = ? AND ipAddress = ?",
    );
    const insertAssignment = db.prepare(`
      INSERT INTO ipAssignments (id, subnetId, ipAddress, assignmentType, allocationMode, deviceId, portId, hostname, description)
      VALUES (?, ?, ?, 'device', 'static', ?, ?, ?, ?)
    `);
    const linkDeviceIp = (
      deviceId: string,
      name: string,
      ipAddress: string | null,
      portId: string | null = null,
    ) => {
      if (!ipAddress || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ipAddress)) return;
      const subnet = labSubnets.find((entry) => {
        try {
          return cidrContainsHostIp(entry.cidr, ipAddress);
        } catch {
          return false;
        }
      });
      if (!subnet) return;
      if (assignmentExists.get(subnet.id, ipAddress)) return;
      const assignmentId = createId("ip");
      insertAssignment.run(
        assignmentId,
        subnet.id,
        ipAddress,
        deviceId,
        portId,
        name,
        "Linked by a controller integration import.",
      );
      result.createdIpAssignmentIds.push(assignmentId);
      writeAudit.run(
        createId("a"),
        now,
        input.actor,
        "integration.sync.ip.create",
        assignmentId,
        `Assigned ${ipAddress} to ${name} in subnet ${subnet.cidr}.`,
      );
    };
    const vlanIdByNumber = new Map<number, string>(
      (
        db
          .prepare("SELECT id, vlanId FROM vlans WHERE labId = ?")
          .all(input.labId) as Array<{ id: string; vlanId: number }>
      ).map((row) => [Number(row.vlanId), row.id]),
    );

    const resolveDeviceIdByName = (value: string | null | undefined) => {
      if (!value) return null;
      const key = value.trim().toLowerCase();
      if (!key) return null;
      const row = existing.find(
        (entry) =>
          entry.hostname.trim().toLowerCase() === key ||
          (entry.displayName ?? "").trim().toLowerCase() === key,
      );
      return row?.id ?? null;
    };
    const vswitchIdByKey = new Map<string, string>();
    for (const row of db
      .prepare(
        `SELECT virtualSwitches.id, virtualSwitches.hostDeviceId, virtualSwitches.name
         FROM virtualSwitches
         JOIN devices ON devices.id = virtualSwitches.hostDeviceId
         WHERE devices.labId = ?`,
      )
      .all(input.labId) as Array<{
      id: string;
      hostDeviceId: string;
      name: string;
    }>) {
      vswitchIdByKey.set(
        `${row.hostDeviceId}|${row.name.trim().toLowerCase()}`,
        row.id,
      );
    }

    const importOne = (device: IntegrationImportableDevice) => {
      const name = device.name.trim();
      if (!name) return;
      const isGuest =
        device.deviceType === "vm" || device.deviceType === "container";
      const parentDeviceId = isGuest
        ? resolveDeviceIdByName(device.parentName)
        : null;
      const match = matchDevice(device, existing);
      if (match) {
        // Existing devices are deliberately left untouched. Controller
        // metadata can be reviewed and adopted through a future provenance-
        // aware update flow rather than silently mutating manual inventory.
        return;
      }
      if (isGuest && !parentDeviceId) {
        result.skipped.push(
          `${name}: parent host ${device.parentName || "(missing)"} is unavailable.`,
        );
        return;
      }
      const hostnameTaken = existing.some(
        (row) => row.hostname.trim().toLowerCase() === name.toLowerCase(),
      );
      if (hostnameTaken) {
        result.skipped.push(name);
        return;
      }

      const deviceId = createId("d");
      // Physical gear lands loose (no rack, no room) until someone places
      // it; guests are virtual devices attached under their host.
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
        canonicalMacAddress(device.macAddress),
        device.online == null
          ? "unknown"
          : device.online
            ? "online"
            : "offline",
        isGuest ? "virtual" : "room",
        parentDeviceId,
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
        const mode = port.mode === "trunk" ? "trunk" : "access";
        const untaggedVlanId =
          port.untaggedVlanNumber != null
            ? (vlanIdByNumber.get(port.untaggedVlanNumber) ?? null)
            : null;
        const allowedVlanIds =
          mode === "trunk"
            ? (port.taggedVlanNumbers ?? [])
                .map((number) => vlanIdByNumber.get(number))
                .filter((id): id is string => Boolean(id))
            : [];
        // A guest NIC lands on its host's virtual switch when both are
        // known by name.
        const virtualSwitchId =
          port.virtualSwitchName && parentDeviceId
            ? (vswitchIdByKey.get(
                `${parentDeviceId}|${port.virtualSwitchName.trim().toLowerCase()}`,
              ) ?? null)
            : null;
        const portId = createId("p");
        insertPort.run({
          id: portId,
          deviceId,
          name: port.name,
          position: index + 1,
          kind: port.kind,
          speed: port.speed,
          linkState: port.linkState,
          mode,
          vlanId: untaggedVlanId,
          allowedVlanIds:
            allowedVlanIds.length > 0 ? JSON.stringify(allowedVlanIds) : null,
          description: null,
          face: "front",
          virtualSwitchId,
          macAddress: canonicalMacAddress(port.macAddress),
        });
        result.createdPortCount += 1;
        for (const ipAddress of port.ipAddresses ?? []) {
          linkDeviceIp(deviceId, name, ipAddress, portId);
        }
      });

      linkDeviceIp(deviceId, name, device.ipAddress);

      writeAudit.run(
        createId("a"),
        now,
        input.actor,
        "integration.sync.device.create",
        deviceId,
        `Imported ${device.deviceType} ${name} from a controller integration.`,
      );
    };

    // Hosts and physical gear first, then their virtual switches, then
    // guests — so parent and vswitch links resolve in one pass.
    for (const device of input.importableDevices) {
      if (device.deviceType === "vm" || device.deviceType === "container") {
        continue;
      }
      importOne(device);
    }
    for (const vswitch of input.virtualSwitches ?? []) {
      const hostDeviceId = resolveDeviceIdByName(vswitch.hostName);
      if (!hostDeviceId) continue;
      const key = `${hostDeviceId}|${vswitch.name.trim().toLowerCase()}`;
      if (vswitchIdByKey.has(key)) continue;
      const vswitchId = createId("vsw");
      insertVirtualSwitch.run(
        vswitchId,
        hostDeviceId,
        vswitch.name,
        vswitch.kind,
        vswitch.notes,
      );
      vswitchIdByKey.set(key, vswitchId);
      result.createdVirtualSwitchIds.push(vswitchId);
      writeAudit.run(
        createId("a"),
        now,
        input.actor,
        "integration.sync.vswitch.create",
        vswitchId,
        `Created virtual switch ${vswitch.name} on ${vswitch.hostName}.`,
      );
    }
    for (const device of input.importableDevices) {
      if (device.deviceType !== "vm" && device.deviceType !== "container") {
        continue;
      }
      importOne(device);
    }

    if (input.wifi) {
      let controllerId: string;
      const controllerRow = db
        .prepare("SELECT id FROM wifiControllers WHERE labId = ? AND name = ?")
        .get(input.labId, input.wifi.controllerName) as
        { id: string } | undefined;
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

      for (const ssid of input.wifi.ssids) {
        const name = ssid.name.trim();
        if (!name) continue;
        const existingSsid = db
          .prepare("SELECT id FROM wifiSsids WHERE labId = ? AND name = ?")
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

// Applies the connection's per-category device toggles. Firewalls follow the
// gateway toggle (they are the gateway in OPNsense setups).
export function filterImportableDevicesForConnection(
  connection: {
    syncSwitches: boolean;
    syncGateways: boolean;
    syncAccessPoints: boolean;
    syncHosts: boolean;
    syncGuests: boolean;
  },
  devices: IntegrationImportableDevice[],
): IntegrationImportableDevice[] {
  return devices.filter((device) => {
    if (device.deviceType === "switch") return connection.syncSwitches;
    if (device.deviceType === "router" || device.deviceType === "firewall") {
      return connection.syncGateways;
    }
    if (device.deviceType === "ap") return connection.syncAccessPoints;
    if (device.deviceType === "server") return connection.syncHosts;
    if (device.deviceType === "vm" || device.deviceType === "container") {
      return connection.syncGuests;
    }
    return true;
  });
}
