import dgram from "node:dgram";
import { db } from "../db.js";
import { createId } from "./ids.js";
import {
  listMonitors,
  recordMonitorResult,
  reconcileDeviceMonitorRollup,
  type DeviceMonitor,
} from "./monitoring.js";
import { loadSnmpCredentialSecrets } from "./snmp-credentials.js";
import { getSnmpCredentialRow } from "./snmp-credentials.js";
import {
  extractIfIndex,
  parseSnmpTrapPacket,
  trapOidToLinkResult,
  type ParsedSnmpTrap,
  type SnmpV3TrapCredential,
} from "./snmp-trap-parser.js";

const DEDUPE_WINDOW_MS = 30_000;
const TRAP_LOG_BUCKET_LIMIT = 20;
const TRAP_LOG_BUCKET_WINDOW_MS = 60_000;
const dedupeCache = new Map<string, number>();
const trapLogBuckets = new Map<string, { count: number; resetAt: number }>();

interface TrapSourceMapping {
  id: string | null;
  labId: string;
  deviceId: string | null;
  community: string | null;
  credentialId: string | null;
  deviceCredentialId: string | null;
}

export interface SnmpTrapReceiverStatus {
  enabled: boolean;
  listening: boolean;
  port: number;
  bind: string;
  lastTrapAt: string | null;
  lastError: string | null;
  trapsReceived: number;
}

const status: SnmpTrapReceiverStatus = {
  enabled: false,
  listening: false,
  port: 1162,
  bind: "0.0.0.0",
  lastTrapAt: null,
  lastError: null,
  trapsReceived: 0,
};

let socket: dgram.Socket | null = null;

function envFlag(name: string, defaultValue: boolean) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

function resolveTrapPort() {
  const configured = Number.parseInt(process.env.SNMP_TRAP_PORT ?? "", 10);
  if (Number.isInteger(configured) && configured > 0 && configured <= 65535) {
    return configured;
  }
  return 1162;
}

export function getSnmpTrapReceiverStatus() {
  return { ...status };
}

export function startSnmpTrapReceiver() {
  if (socket) return () => stopSnmpTrapReceiver();

  const enabled = envFlag("SNMP_TRAP_ENABLED", true);
  status.enabled = enabled;
  status.port = resolveTrapPort();
  status.bind = process.env.SNMP_TRAP_BIND?.trim() || "0.0.0.0";

  if (!enabled) {
    return () => stopSnmpTrapReceiver();
  }

  socket = dgram.createSocket("udp4");
  socket.on("error", (error) => {
    status.listening = false;
    status.lastError = error.message;
  });
  socket.on("message", (packet, remote) => {
    void handleTrapPacket(packet, remote.address).catch((error) => {
      status.lastError =
        error instanceof Error ? error.message : "Trap processing failed.";
    });
  });

  socket.bind(status.port, status.bind, () => {
    status.listening = true;
    status.lastError = null;
    console.log(
      `[rackpad] SNMP trap receiver listening on udp://${status.bind}:${status.port}`,
    );
  });

  return () => stopSnmpTrapReceiver();
}

export function stopSnmpTrapReceiver() {
  if (!socket) return;
  socket.close();
  socket = null;
  status.listening = false;
}

function shouldDedupe(sourceIp: string, trap: ParsedSnmpTrap) {
  const key = `${sourceIp}:${trap.trapOid ?? trap.genericTrap ?? "unknown"}:${trap.ifIndex ?? "none"}`;
  const now = Date.now();
  const previous = dedupeCache.get(key);
  dedupeCache.set(key, now);
  if (dedupeCache.size > 5000) {
    for (const [entryKey, ts] of dedupeCache) {
      if (now - ts > DEDUPE_WINDOW_MS) dedupeCache.delete(entryKey);
    }
  }
  return previous != null && now - previous < DEDUPE_WINDOW_MS;
}

function consumeTrapLogBudget(sourceIp: string) {
  const now = Date.now();
  const bucket = trapLogBuckets.get(sourceIp);
  if (!bucket || now >= bucket.resetAt) {
    trapLogBuckets.set(sourceIp, {
      count: 1,
      resetAt: now + TRAP_LOG_BUCKET_WINDOW_MS,
    });
    cleanupTrapLogBuckets(now);
    return true;
  }

  if (bucket.count >= TRAP_LOG_BUCKET_LIMIT) {
    cleanupTrapLogBuckets(now);
    return false;
  }

  bucket.count += 1;
  cleanupTrapLogBuckets(now);
  return true;
}

function cleanupTrapLogBuckets(now: number) {
  if (trapLogBuckets.size <= 5000) return;
  for (const [sourceIp, bucket] of trapLogBuckets) {
    if (now >= bucket.resetAt) trapLogBuckets.delete(sourceIp);
  }
}

export async function handleTrapPacket(packet: Buffer, sourceIp: string) {
  status.trapsReceived += 1;
  status.lastTrapAt = new Date().toISOString();

  const mapping = resolveTrapSource(sourceIp);
  const trap = parseSnmpTrapPacket(packet, {
    v3Credentials: collectSnmpV3TrapCredentials(mapping),
  });
  if (shouldDedupe(sourceIp, trap)) {
    return { deduped: true };
  }

  const linkResult = trapOidToLinkResult(trap.trapOid, trap.genericTrap);
  const deviceId = mapping.deviceId;
  const labId = mapping.labId;

  const ifIndex = trap.ifIndex ?? extractIfIndex(trap.varbinds);
  const affectedMonitors = deviceId
    ? findMonitorsForTrap(deviceId, ifIndex)
    : [];
  const trustedMonitorIds = affectedMonitors
    .filter((monitor) => isTrapAuthorizedForMonitor(monitor, trap, mapping))
    .map((monitor) => monitor.id);

  let action = "logged";
  let message = `Trap from ${sourceIp}${trap.trapOid ? ` (${trap.trapOid})` : ""}`;

  if (linkResult && trustedMonitorIds.length > 0) {
    action = "monitors-updated";
    message = `Trap ${linkResult === "online" ? "linkUp" : "linkDown"} for ifIndex ${ifIndex ?? "unknown"} from ${sourceIp}`;
    for (const monitorId of trustedMonitorIds) {
      await recordMonitorResult(monitorId, {
        result: linkResult,
        message: `${message} via SNMP trap.`,
      });
    }
    if (deviceId) {
      reconcileDeviceMonitorRollup(deviceId);
    }
  } else if (linkResult && affectedMonitors.length > 0) {
    action = "unverified-source";
    message = `Trap ${linkResult} from ${sourceIp} matched SNMP monitor metadata but was not trusted by credential/community.`;
  } else if (linkResult && deviceId) {
    action = "no-monitor-match";
    message = `Trap ${linkResult} from ${sourceIp} did not match an enabled SNMP interface monitor.`;
  }

  upsertTrapSource({
    id: mapping.id,
    labId,
    deviceId,
    sourceIp,
    community: trap.community ?? null,
    credentialId: trap.credentialId ?? null,
  });

  const persisted = consumeTrapLogBudget(sourceIp);
  if (persisted) {
    insertTrapLog({
      labId,
      deviceId,
      sourceIp,
      trapOid: trap.trapOid ?? null,
      ifIndex: ifIndex ?? null,
      varbinds: trap.varbinds,
      resultAction: action,
      message,
    });

    db.prepare(
      `
      INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      createId("a"),
      new Date().toISOString(),
      "system",
      "monitor.snmp.trap",
      deviceId ? "Device" : "Lab",
      deviceId ?? labId,
      message,
    );
  }

  return {
    deduped: false,
    action,
    affectedMonitorIds: trustedMonitorIds,
    persisted,
  };
}

function resolveTrapSource(sourceIp: string): TrapSourceMapping {
  const existing = db
    .prepare(
      "SELECT * FROM snmpTrapSources WHERE sourceIp = ? ORDER BY lastTrapAt DESC LIMIT 1",
    )
    .get(sourceIp) as Record<string, unknown> | undefined;

  if (existing) {
    return {
      id: String(existing.id),
      labId: String(existing.labId),
      deviceId: existing.deviceId ? String(existing.deviceId) : null,
      community: existing.community ? String(existing.community) : null,
      credentialId: existing.credentialId
        ? String(existing.credentialId)
        : null,
      deviceCredentialId: existing.deviceId
        ? resolveDeviceCredentialId(String(existing.deviceId))
        : null,
    };
  }

  const device = db
    .prepare(
      "SELECT id, labId, snmpCredentialId FROM devices WHERE managementIp = ? ORDER BY hostname LIMIT 1",
    )
    .get(sourceIp) as
    | { id: string; labId: string; snmpCredentialId?: string | null }
    | undefined;

  if (device) {
    return {
      id: null,
      labId: device.labId,
      deviceId: device.id,
      community: null,
      credentialId: null,
      deviceCredentialId: device.snmpCredentialId ?? null,
    };
  }

  const fallbackLab = db
    .prepare("SELECT id FROM labs ORDER BY id LIMIT 1")
    .get() as { id: string } | undefined;

  return {
    id: null,
    labId: fallbackLab?.id ?? "lab_home",
    deviceId: null,
    community: null,
    credentialId: null,
    deviceCredentialId: null,
  };
}

function resolveDeviceCredentialId(deviceId: string) {
  const device = db
    .prepare("SELECT snmpCredentialId FROM devices WHERE id = ?")
    .get(deviceId) as { snmpCredentialId?: string | null } | undefined;
  return device?.snmpCredentialId ?? null;
}

function collectSnmpV3TrapCredentials(mapping: TrapSourceMapping) {
  const credentialIds = new Set<string>();
  if (mapping.credentialId) credentialIds.add(mapping.credentialId);
  if (mapping.deviceCredentialId) credentialIds.add(mapping.deviceCredentialId);

  if (mapping.deviceId) {
    const monitorCredentials = db
      .prepare(
        `
        SELECT DISTINCT snmpCredentialId
        FROM deviceMonitors
        WHERE deviceId = ? AND type = 'snmp' AND snmpCredentialId IS NOT NULL
      `,
      )
      .all(mapping.deviceId) as Array<{ snmpCredentialId: string }>;
    for (const row of monitorCredentials) {
      credentialIds.add(row.snmpCredentialId);
    }
  }

  if (credentialIds.size === 0) {
    const labCredentials = db
      .prepare(
        "SELECT id FROM snmpCredentials WHERE labId = ? AND version = '3'",
      )
      .all(mapping.labId) as Array<{ id: string }>;
    for (const row of labCredentials) {
      credentialIds.add(row.id);
    }
  }

  const credentials: SnmpV3TrapCredential[] = [];
  for (const credentialId of credentialIds) {
    try {
      const credential = loadSnmpCredentialSecrets(credentialId, mapping.labId);
      if (credential.version !== "3" || !credential.v3User?.trim()) continue;
      credentials.push({
        id: credential.id,
        user: credential.v3User.trim(),
        authProtocol: credential.v3AuthProto ?? "SHA",
        authPassword: credential.v3AuthPassword ?? "",
        privProtocol: credential.v3PrivProto ?? "none",
        privPassword: credential.v3PrivPassword ?? "",
        context: credential.v3Context ?? "",
      });
    } catch {
      // Ignore stale credential references; source authorization fails later.
    }
  }

  return credentials;
}

function communityMatches(
  actual: string | null | undefined,
  expected: string | null | undefined,
) {
  const actualValue = actual?.trim();
  const expectedValue = expected?.trim();
  return Boolean(actualValue && expectedValue && actualValue === expectedValue);
}

function isTrapAuthorizedForMonitor(
  monitor: DeviceMonitor,
  trap: ParsedSnmpTrap,
  mapping: TrapSourceMapping,
) {
  if (trap.snmpVersion === "3") {
    if (!trap.credentialId) return false;
    const allowedCredentialIds = [
      monitor.snmpCredentialId,
      mapping.credentialId,
      mapping.deviceCredentialId,
    ].filter(Boolean);
    return allowedCredentialIds.includes(trap.credentialId);
  }

  const trapCommunity = trap.community?.trim();
  if (!trapCommunity) return false;

  const credentialId = monitor.snmpCredentialId ?? mapping.credentialId;
  if (credentialId) {
    try {
      const credential = loadSnmpCredentialSecrets(credentialId, mapping.labId);
      if (credential.version === "3") return false;
      return communityMatches(trapCommunity, credential.community ?? "public");
    } catch {
      return false;
    }
  }

  if (communityMatches(trapCommunity, monitor.snmpCommunity)) return true;
  return communityMatches(trapCommunity, mapping.community);
}

function upsertTrapSource(input: {
  id: string | null;
  labId: string;
  deviceId: string | null;
  sourceIp: string;
  community: string | null;
  credentialId: string | null;
}) {
  const now = new Date().toISOString();
  if (input.id) {
    db.prepare(
      `
      UPDATE snmpTrapSources
      SET
        deviceId = COALESCE(?, deviceId),
        community = COALESCE(?, community),
        credentialId = COALESCE(?, credentialId),
        lastTrapAt = ?
      WHERE id = ?
    `,
    ).run(input.deviceId, input.community, input.credentialId, now, input.id);
    return;
  }

  const id = createId("trapsrc");
  db.prepare(
    `
    INSERT INTO snmpTrapSources (id, labId, deviceId, sourceIp, community, credentialId, lastTrapAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(labId, sourceIp) DO UPDATE SET
      deviceId = COALESCE(excluded.deviceId, snmpTrapSources.deviceId),
      community = COALESCE(excluded.community, snmpTrapSources.community),
      credentialId = COALESCE(excluded.credentialId, snmpTrapSources.credentialId),
      lastTrapAt = excluded.lastTrapAt
  `,
  ).run(
    id,
    input.labId,
    input.deviceId,
    input.sourceIp,
    input.community,
    input.credentialId,
    now,
  );
}

function findMonitorsForTrap(deviceId: string, ifIndex?: number) {
  const monitors = listMonitors(deviceId).filter(
    (monitor) => monitor.enabled && monitor.type === "snmp",
  );
  if (ifIndex == null) return monitors;

  const portIds = new Set(
    (
      db
        .prepare("SELECT id FROM ports WHERE deviceId = ? AND snmpIfIndex = ?")
        .all(deviceId, ifIndex) as Array<{ id: string }>
    ).map((row) => row.id),
  );

  return monitors.filter(
    (monitor) =>
      monitor.snmpIfIndex === ifIndex ||
      (monitor.portId != null && portIds.has(monitor.portId)),
  );
}

function insertTrapLog(input: {
  labId: string;
  deviceId: string | null;
  sourceIp: string;
  trapOid: string | null;
  ifIndex: number | null;
  varbinds: ParsedSnmpTrap["varbinds"];
  resultAction: string;
  message: string;
}) {
  db.prepare(
    `
    INSERT INTO snmpTrapLog (
      id, labId, deviceId, sourceIp, trapOid, ifIndex, varbindsJson, resultAction, message, receivedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    createId("traplog"),
    input.labId,
    input.deviceId,
    input.sourceIp,
    input.trapOid,
    input.ifIndex,
    JSON.stringify(input.varbinds),
    input.resultAction,
    input.message,
    new Date().toISOString(),
  );
}

export function listSnmpTrapLog(options: {
  labId?: string;
  deviceId?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  let sql = "SELECT * FROM snmpTrapLog WHERE 1=1";
  const params: unknown[] = [];

  if (options.labId) {
    sql += " AND labId = ?";
    params.push(options.labId);
  }
  if (options.deviceId) {
    sql += " AND deviceId = ?";
    params.push(options.deviceId);
  }

  sql += " ORDER BY receivedAt DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(
    parseTrapLogRow,
  );
}

export function listSnmpTrapSources(labId?: string) {
  const rows = labId
    ? db
        .prepare(
          "SELECT * FROM snmpTrapSources WHERE labId = ? ORDER BY sourceIp",
        )
        .all(labId)
    : db
        .prepare("SELECT * FROM snmpTrapSources ORDER BY labId, sourceIp")
        .all();
  return (rows as Record<string, unknown>[]).map(parseTrapSourceRow);
}

export function updateSnmpTrapSource(
  id: string,
  input: { deviceId?: string | null; credentialId?: string | null },
) {
  const existing = db
    .prepare("SELECT * FROM snmpTrapSources WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!existing) return null;

  const deviceId =
    input.deviceId === undefined
      ? (existing.deviceId as string | null)
      : input.deviceId;
  const credentialId =
    input.credentialId === undefined
      ? (existing.credentialId as string | null)
      : input.credentialId;
  if (deviceId) {
    const device = db
      .prepare("SELECT labId FROM devices WHERE id = ?")
      .get(deviceId) as { labId: string } | undefined;
    if (!device || device.labId !== String(existing.labId)) {
      throw new Error("Trap source device must belong to the same lab.");
    }
  }
  if (credentialId) {
    const credential = getSnmpCredentialRow(credentialId);
    if (!credential || String(credential.labId) !== String(existing.labId)) {
      throw new Error("Trap source credential must belong to the same lab.");
    }
  }

  db.prepare(
    `
    UPDATE snmpTrapSources
    SET deviceId = ?, credentialId = ?
    WHERE id = ?
  `,
  ).run(deviceId, credentialId, id);

  return parseTrapSourceRow(
    db.prepare("SELECT * FROM snmpTrapSources WHERE id = ?").get(id) as Record<
      string,
      unknown
    >,
  );
}

function parseTrapLogRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    labId: String(row.labId),
    deviceId: row.deviceId ? String(row.deviceId) : null,
    sourceIp: String(row.sourceIp),
    trapOid: row.trapOid ? String(row.trapOid) : null,
    ifIndex: row.ifIndex == null ? null : Number(row.ifIndex),
    varbinds: row.varbindsJson ? JSON.parse(String(row.varbindsJson)) : [],
    resultAction: String(row.resultAction),
    message: String(row.message),
    receivedAt: String(row.receivedAt),
  };
}

function parseTrapSourceRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    labId: String(row.labId),
    deviceId: row.deviceId ? String(row.deviceId) : null,
    sourceIp: String(row.sourceIp),
    community: row.community ? String(row.community) : null,
    credentialId: row.credentialId ? String(row.credentialId) : null,
    lastTrapAt: row.lastTrapAt ? String(row.lastTrapAt) : null,
  };
}
