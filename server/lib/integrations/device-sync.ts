import { db } from "../../db.js";
import { createHash } from "node:crypto";
import { cidrContainsHostIp } from "../ip-cidr.js";
import { createId } from "../ids.js";
import { initializeDevicePhysicalLayout } from "../device-physical-layout.js";
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
  action: "create" | "exists" | "conflict";
  name: string;
  deviceType: IntegrationImportableDevice["deviceType"];
  parentName: string | null;
  model: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  portCount: number;
  existingId?: string;
  existingHostname?: string;
  reason: string | null;
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
  action: "create" | "exists" | "conflict";
  name: string;
  hostName: string;
  reason: string | null;
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
  deviceType: string;
  parentDeviceId: string | null;
}

function existingLabDevices(labId: string): ExistingDeviceRow[] {
  return db
    .prepare(
      "SELECT id, hostname, displayName, macAddress, deviceType, parentDeviceId FROM devices WHERE labId = ?",
    )
    .all(labId) as ExistingDeviceRow[];
}

function normalizeName(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isGuestType(deviceType: string) {
  return deviceType === "vm" || deviceType === "container";
}

function matchesDeviceName(row: ExistingDeviceRow, name: string) {
  return (
    normalizeName(row.hostname) === name ||
    normalizeName(row.displayName) === name
  );
}

function addCount(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function deviceScopeKey(device: IntegrationImportableDevice) {
  const name = normalizeName(device.name);
  if (isGuestType(device.deviceType)) {
    return `guest|${device.deviceType}|${normalizeName(device.parentName)}|${name}`;
  }
  return `physical|${name}`;
}

function deviceProviderRecordId(
  device: IntegrationImportableDevice,
  index: number,
) {
  return (
    device.providerRecordId ??
    providerRecordId(
      "device",
      [
        device.deviceType,
        device.name,
        device.macAddress,
        device.serial,
        device.parentName,
      ],
      index,
    )
  );
}

interface ClassifiedDevice {
  index: number;
  source: IntegrationImportableDevice;
  diff: IntegrationDeviceDiff;
}

interface HostResolution {
  kind: "existing" | "planned" | "missing" | "ambiguous";
  id?: string;
  providerRecordId?: string;
}

function resolveHost(
  hostName: string | null | undefined,
  physicalDevices: ClassifiedDevice[],
  existing: ExistingDeviceRow[],
): HostResolution {
  const name = normalizeName(hostName);
  if (!name) return { kind: "missing" };

  const sourceMatches = physicalDevices.filter(
    ({ source }) => normalizeName(source.name) === name,
  );
  if (sourceMatches.length > 1) return { kind: "ambiguous" };
  if (sourceMatches.length === 1) {
    const sourceMatch = sourceMatches[0];
    if (sourceMatch.diff.action === "conflict") {
      return { kind: "ambiguous" };
    }
    if (sourceMatch.diff.action === "exists" && sourceMatch.diff.existingId) {
      return { kind: "existing", id: sourceMatch.diff.existingId };
    }
    return {
      kind: "planned",
      providerRecordId: sourceMatch.diff.providerRecordId,
    };
  }

  const existingMatches = existing.filter(
    (row) => !isGuestType(row.deviceType) && matchesDeviceName(row, name),
  );
  if (existingMatches.length === 1) {
    return { kind: "existing", id: existingMatches[0].id };
  }
  return {
    kind: existingMatches.length > 1 ? "ambiguous" : "missing",
  };
}

function conflictDiff(
  device: IntegrationImportableDevice,
  index: number,
  reason: string,
): ClassifiedDevice {
  return {
    index,
    source: device,
    diff: {
      providerRecordId: deviceProviderRecordId(device, index),
      action: "conflict",
      name: device.name.trim(),
      deviceType: device.deviceType,
      parentName: device.parentName?.trim() || null,
      model: device.model,
      macAddress: device.macAddress,
      ipAddress: device.ipAddress,
      portCount: device.ports.length,
      reason,
      proposedUpdates: [],
    },
  };
}

function classifyDevice(
  device: IntegrationImportableDevice,
  index: number,
  existing: ExistingDeviceRow[],
  macCounts: Map<string, number>,
  scopeCounts: Map<string, number>,
  physicalDevices: ClassifiedDevice[],
): ClassifiedDevice {
  const name = normalizeName(device.name);
  const providerId = deviceProviderRecordId(device, index);
  const mac = normalizeMac(device.macAddress);
  const guest = isGuestType(device.deviceType);

  if (mac && (macCounts.get(mac) ?? 0) > 1) {
    return conflictDiff(
      device,
      index,
      `Multiple controller records share MAC ${canonicalMacAddress(device.macAddress)}.`,
    );
  }

  const macMatches = mac
    ? existing.filter((row) => normalizeMac(row.macAddress) === mac)
    : [];
  if (macMatches.length > 1) {
    return conflictDiff(
      device,
      index,
      `Multiple existing Rackpad devices share MAC ${canonicalMacAddress(device.macAddress)}.`,
    );
  }
  if (macMatches.length === 1) {
    const match = macMatches[0];
    return {
      index,
      source: device,
      diff: {
        providerRecordId: providerId,
        action: "exists",
        name: device.name.trim(),
        deviceType: device.deviceType,
        parentName: device.parentName?.trim() || null,
        model: device.model,
        macAddress: device.macAddress,
        ipAddress: device.ipAddress,
        portCount: device.ports.length,
        existingId: match.id,
        existingHostname: match.hostname,
        reason: null,
        proposedUpdates: [],
      },
    };
  }

  let parent: HostResolution | null = null;
  if (guest) {
    parent = resolveHost(device.parentName, physicalDevices, existing);
    if (parent.kind === "missing") {
      return conflictDiff(
        device,
        index,
        `Parent host ${device.parentName || "(missing)"} is unavailable.`,
      );
    }
    if (parent.kind === "ambiguous") {
      return conflictDiff(
        device,
        index,
        `Parent host ${device.parentName || "(missing)"} is ambiguous.`,
      );
    }
  }

  const nameMatches = existing.filter((row) => {
    if (!matchesDeviceName(row, name)) return false;
    if (!guest) return !isGuestType(row.deviceType);
    return (
      row.deviceType === device.deviceType &&
      parent?.kind === "existing" &&
      row.parentDeviceId === parent.id
    );
  });
  const scopeCount = scopeCounts.get(deviceScopeKey(device)) ?? 0;

  if (!mac && scopeCount > 1) {
    return conflictDiff(
      device,
      index,
      `Multiple controller records named ${device.name.trim()} cannot be distinguished without a MAC address.`,
    );
  }

  if (mac) {
    const nameOnlyMatches = nameMatches.filter(
      (row) => !normalizeMac(row.macAddress),
    );
    if (
      nameOnlyMatches.length === 1 &&
      nameMatches.length === 1 &&
      scopeCount === 1
    ) {
      const match = nameOnlyMatches[0];
      return {
        index,
        source: device,
        diff: {
          providerRecordId: providerId,
          action: "exists",
          name: device.name.trim(),
          deviceType: device.deviceType,
          parentName: device.parentName?.trim() || null,
          model: device.model,
          macAddress: device.macAddress,
          ipAddress: device.ipAddress,
          portCount: device.ports.length,
          existingId: match.id,
          existingHostname: match.hostname,
          reason: null,
          proposedUpdates: [],
        },
      };
    }
    if (nameOnlyMatches.length > 0) {
      return conflictDiff(
        device,
        index,
        `Name ${device.name.trim()} matches existing Rackpad inventory without a unique MAC identity.`,
      );
    }
  } else if (nameMatches.length > 1) {
    return conflictDiff(
      device,
      index,
      `Multiple existing Rackpad devices match ${device.name.trim()}.`,
    );
  } else if (nameMatches.length === 1) {
    const match = nameMatches[0];
    return {
      index,
      source: device,
      diff: {
        providerRecordId: providerId,
        action: "exists",
        name: device.name.trim(),
        deviceType: device.deviceType,
        parentName: device.parentName?.trim() || null,
        model: device.model,
        macAddress: device.macAddress,
        ipAddress: device.ipAddress,
        portCount: device.ports.length,
        existingId: match.id,
        existingHostname: match.hostname,
        reason: null,
        proposedUpdates: [],
      },
    };
  }

  return {
    index,
    source: device,
    diff: {
      providerRecordId: providerId,
      action: "create",
      name: device.name.trim(),
      deviceType: device.deviceType,
      parentName: device.parentName?.trim() || null,
      model: device.model,
      macAddress: device.macAddress,
      ipAddress: device.ipAddress,
      portCount: device.ports.length,
      reason: null,
      proposedUpdates: [],
    },
  };
}

function classifyIntegrationDevices(
  labId: string,
  importableDevices: IntegrationImportableDevice[],
) {
  const existing = existingLabDevices(labId);
  const indexed = importableDevices
    .map((source, index) => ({ source, index }))
    .filter(({ source }) => Boolean(source.name.trim()));
  const macCounts = new Map<string, number>();
  const scopeCounts = new Map<string, number>();
  for (const { source } of indexed) {
    const mac = normalizeMac(source.macAddress);
    if (mac) addCount(macCounts, mac);
    addCount(scopeCounts, deviceScopeKey(source));
  }

  const physicalDevices = indexed
    .filter(({ source }) => !isGuestType(source.deviceType))
    .map(({ source, index }) =>
      classifyDevice(
        source,
        index,
        existing,
        macCounts,
        scopeCounts,
        [],
      ),
    );
  const guestDevices = indexed
    .filter(({ source }) => isGuestType(source.deviceType))
    .map(({ source, index }) =>
      classifyDevice(
        source,
        index,
        existing,
        macCounts,
        scopeCounts,
        physicalDevices,
      ),
    );
  return {
    existing,
    physicalDevices,
    devices: [...physicalDevices, ...guestDevices].sort(
      (a, b) => a.index - b.index,
    ),
  };
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
  const classified = classifyIntegrationDevices(
    input.labId,
    input.importableDevices,
  );
  const devices = classified.devices.map(({ diff }) => diff);

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
    const existingSwitches = db
      .prepare(
        `SELECT virtualSwitches.hostDeviceId, virtualSwitches.name
         FROM virtualSwitches
         JOIN devices ON devices.id = virtualSwitches.hostDeviceId
         WHERE devices.labId = ?`,
      )
      .all(input.labId) as Array<{ hostDeviceId: string; name: string }>;
    const sourceCounts = new Map<string, number>();
    for (const vswitch of input.virtualSwitches) {
      addCount(
        sourceCounts,
        `${normalizeName(vswitch.hostName)}|${normalizeName(vswitch.name)}`,
      );
    }
    for (const [index, vswitch] of input.virtualSwitches.entries()) {
      const sourceKey = `${normalizeName(vswitch.hostName)}|${normalizeName(vswitch.name)}`;
      const host = resolveHost(
        vswitch.hostName,
        classified.physicalDevices,
        classified.existing,
      );
      let action: IntegrationVirtualSwitchDiff["action"] = "create";
      let reason: string | null = null;
      if ((sourceCounts.get(sourceKey) ?? 0) > 1) {
        action = "conflict";
        reason = `Multiple controller records describe virtual switch ${vswitch.name} on ${vswitch.hostName}.`;
      } else if (host.kind === "missing") {
        action = "conflict";
        reason = `Host ${vswitch.hostName} is unavailable.`;
      } else if (host.kind === "ambiguous") {
        action = "conflict";
        reason = `Host ${vswitch.hostName} is ambiguous.`;
      } else if (
        host.kind === "existing" &&
        existingSwitches.some(
          (row) =>
            row.hostDeviceId === host.id &&
            normalizeName(row.name) === normalizeName(vswitch.name),
        )
      ) {
        action = "exists";
      }
      virtualSwitches.push({
        providerRecordId:
          vswitch.providerRecordId ??
          providerRecordId(
            "virtual-switch",
            [vswitch.hostName, vswitch.name],
            index,
          ),
        action,
        name: vswitch.name,
        hostName: vswitch.hostName,
        reason,
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
  selectedProviderRecordIds?: ReadonlySet<string>;
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
  const selectedProviderRecordIds = input.selectedProviderRecordIds ?? null;
  const isSelected = (providerRecordId: string) =>
    !selectedProviderRecordIds ||
    selectedProviderRecordIds.has(providerRecordId);

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
    const classification = classifyIntegrationDevices(
      input.labId,
      input.importableDevices,
    );
    const currentPlan = buildIntegrationDeviceSyncPlan({
      labId: input.labId,
      importableDevices: input.importableDevices,
      wifi: input.wifi,
      virtualSwitches: input.virtualSwitches ?? [],
    });
    const existing = classification.existing;
    const createdDeviceIdByProviderRecordId = new Map<string, string>();
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

    const resolveClassifiedHostId = (
      value: string | null | undefined,
    ) => {
      const resolution = resolveHost(
        value,
        classification.physicalDevices,
        classification.existing,
      );
      if (resolution.kind === "existing") return resolution.id ?? null;
      if (resolution.kind === "planned" && resolution.providerRecordId) {
        return (
          createdDeviceIdByProviderRecordId.get(resolution.providerRecordId) ??
          null
        );
      }
      return null;
    };

    const importOne = (classifiedDevice: ClassifiedDevice) => {
      const { source: device, diff } = classifiedDevice;
      if (!isSelected(diff.providerRecordId)) return;
      const name = device.name.trim();
      if (!name) return;
      const isGuest =
        device.deviceType === "vm" || device.deviceType === "container";
      const parentDeviceId = isGuest
        ? resolveClassifiedHostId(device.parentName)
        : null;
      if (diff.action === "exists") {
        // Existing devices are deliberately left untouched. Controller
        // metadata can be reviewed and adopted through a future provenance-
        // aware update flow rather than silently mutating manual inventory.
        if (selectedProviderRecordIds) {
          result.skipped.push(
            `${name}: now matches an existing Rackpad device; pull inventory again.`,
          );
        }
        return;
      }
      if (diff.action === "conflict") {
        result.skipped.push(
          `${name}: ${diff.reason ?? "the controller record is ambiguous."}`,
        );
        return;
      }
      if (isGuest && !parentDeviceId) {
        const host = resolveHost(
          device.parentName,
          classification.physicalDevices,
          classification.existing,
        );
        result.skipped.push(
          host.kind === "planned"
            ? `${name}: parent host ${device.parentName || "(missing)"} must be selected and imported with this record.`
            : `${name}: parent host ${device.parentName || "(missing)"} is unavailable or ambiguous.`,
        );
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
        deviceType: device.deviceType,
        parentDeviceId,
      });
      createdDeviceIdByProviderRecordId.set(diff.providerRecordId, deviceId);
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

      if (!isGuest) initializeDevicePhysicalLayout(deviceId);

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
    for (const classifiedDevice of classification.devices) {
      if (isGuestType(classifiedDevice.source.deviceType)) {
        continue;
      }
      importOne(classifiedDevice);
    }
    for (const [index, vswitch] of (input.virtualSwitches ?? []).entries()) {
      const diff = currentPlan.virtualSwitches[index];
      if (!diff || !isSelected(diff.providerRecordId)) continue;
      if (diff.action === "exists") {
        if (selectedProviderRecordIds) {
          result.skipped.push(
            `${vswitch.name} on ${vswitch.hostName}: now matches an existing virtual switch; pull inventory again.`,
          );
        }
        continue;
      }
      if (diff?.action === "conflict") {
        result.skipped.push(
          `${vswitch.name} on ${vswitch.hostName}: ${diff.reason ?? "the virtual switch is ambiguous."}`,
        );
        continue;
      }
      const hostDeviceId = resolveClassifiedHostId(vswitch.hostName);
      if (!hostDeviceId) {
        const host = resolveHost(
          vswitch.hostName,
          classification.physicalDevices,
          classification.existing,
        );
        result.skipped.push(
          host.kind === "planned"
            ? `${vswitch.name} on ${vswitch.hostName}: host must be selected and imported with this virtual switch.`
            : `${vswitch.name} on ${vswitch.hostName}: host is unavailable or ambiguous.`,
        );
        continue;
      }
      const key = `${hostDeviceId}|${vswitch.name.trim().toLowerCase()}`;
      if (vswitchIdByKey.has(key)) {
        if (selectedProviderRecordIds) {
          result.skipped.push(
            `${vswitch.name} on ${vswitch.hostName}: now matches an existing virtual switch; pull inventory again.`,
          );
        }
        continue;
      }
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
    for (const classifiedDevice of classification.devices) {
      if (!isGuestType(classifiedDevice.source.deviceType)) {
        continue;
      }
      importOne(classifiedDevice);
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
        if (existingSsid) {
          if (selectedProviderRecordIds) {
            result.skipped.push(
              `${name}: now matches an existing SSID; pull inventory again.`,
            );
          }
          continue;
        }
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
      "SELECT hostname, displayName, macAddress, deviceType, parentDeviceId FROM devices WHERE id = ? AND labId = ?",
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
