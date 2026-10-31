import { invalidateIntegrationPreviewTokens } from "./preview-tokens.js";
import { probeObservations } from "../monitor-observations.js";
import { createHash } from "node:crypto";
import { db } from "../../db.js";
import { invalidateExternalHealthWork } from "./external-health-epoch.js";
import {
  validateExternalReadings,
  MAX_EXTERNAL_READINGS,
  type ExternalCollectionError,
  type ExternalReading,
} from "./external-health-types.js";

export function externalSourceIdentity(connection: Record<string, unknown>) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        connection.provider,
        connection.baseUrl,
        connection.siteRef ?? null,
        connection.scopeRefs ?? null,
      ]),
    )
    .digest("hex");
}
export function externalConfigurationRevision(
  connection: Record<string, unknown>,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        externalSourceIdentity(connection),
        connection.labId,
        connection.authKind,
        connection.authId,
        connection.authSecretEnc,
        connection.verifyTls,
        connection.enabled,
        connection.healthPollingEnabled,
        connection.healthIntervalSeconds,
      ]),
    )
    .digest("hex");
}
export function externalReadingStale(
  observedAt: string,
  intervalSeconds: number,
  now = Date.now(),
) {
  const time = Date.parse(observedAt);
  return (
    !Number.isFinite(time) ||
    time > now + 300000 ||
    now - time > Math.max(intervalSeconds * 3000, 300000)
  );
}
export function listExternalReadings(connectionId: string, now = Date.now()) {
  const connection = db
    .prepare(
      "SELECT enabled,healthIntervalSeconds FROM integrationConnections WHERE id=?",
    )
    .get(connectionId) as
    { enabled: number; healthIntervalSeconds: number } | undefined;
  if (!connection) return [];
  return (
    db
      .prepare(
        "SELECT * FROM integrationLatestReadings WHERE connectionId=? ORDER BY recordName,providerRecordId,readingKey",
      )
      .all(connectionId) as Record<string, unknown>[]
  ).map((row) => {
    const stale = externalReadingStale(
      String(row.observedAt),
      connection.healthIntervalSeconds,
      now,
    );
    return {
      ...row,
      key: String(row.readingKey),
      value: JSON.parse(String(row.value)),
      reportedHealth: row.health,
      health:
        stale || row.collectionError || !connection.enabled
          ? "unknown"
          : row.health,
      stale,
    };
  });
}
export function storeExternalReadings(
  connectionId: string,
  input: ExternalReading[],
  now = new Date().toISOString(),
) {
  const readings = validateExternalReadings(input);
  db.transaction(() => {
    const present = new Set(
      readings.map((row) => JSON.stringify([row.providerRecordId, row.key])),
    );
    const existing = db
      .prepare(
        "SELECT providerRecordId,readingKey FROM integrationLatestReadings WHERE connectionId=?",
      )
      .all(connectionId) as Array<{
      providerRecordId: string;
      readingKey: string;
    }>;
    for (const row of existing)
      if (!present.has(JSON.stringify([row.providerRecordId, row.readingKey])))
        db.prepare(
          "UPDATE integrationLatestReadings SET collectionError='missing' WHERE connectionId=? AND providerRecordId=? AND readingKey=?",
        ).run(connectionId, row.providerRecordId, row.readingKey);
    const put =
      db.prepare(`INSERT INTO integrationLatestReadings(connectionId,providerRecordId,recordName,readingKey,label,value,unit,health,observedAt,collectedAt,collectionError)
      VALUES(@connectionId,@providerRecordId,@recordName,@key,@label,@value,@unit,@health,@observedAt,@collectedAt,NULL)
      ON CONFLICT(connectionId,providerRecordId,readingKey) DO UPDATE SET recordName=excluded.recordName,label=excluded.label,value=excluded.value,unit=excluded.unit,health=excluded.health,observedAt=excluded.observedAt,collectedAt=excluded.collectedAt,collectionError=NULL
      WHERE excluded.observedAt >= integrationLatestReadings.observedAt`);
    for (const row of readings)
      put.run({
        ...row,
        connectionId,
        value: JSON.stringify(row.value),
        collectedAt: now,
      });
    const count = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM integrationLatestReadings WHERE connectionId=?",
        )
        .get(connectionId) as { n: number }
    ).n;
    if (count > MAX_EXTERNAL_READINGS)
      db.prepare(
        "DELETE FROM integrationLatestReadings WHERE rowid IN (SELECT rowid FROM integrationLatestReadings WHERE connectionId=? ORDER BY observedAt,collectedAt,providerRecordId,readingKey LIMIT ?)",
      ).run(connectionId, count - MAX_EXTERNAL_READINGS);
    db.prepare(
      "UPDATE integrationConnections SET healthLastCheckedAt=?,healthLastError=NULL WHERE id=?",
    ).run(now, connectionId);
  })();
  for (const row of db
    .prepare(
      "SELECT e.monitorId FROM externalMonitorMappings e JOIN integrationRecordBindings b ON b.id=e.bindingId WHERE b.connectionId=?",
    )
    .all(connectionId) as Array<{ monitorId: string }>)
    probeObservations.delete(row.monitorId);
}
export function resetExternalMonitorResults(
  connectionId?: string,
  clearPending = true,
  monitorId?: string,
) {
  const where = `${connectionId ? "AND b.connectionId=?" : ""} ${monitorId ? "AND m.id=?" : ""}`;
  const ids = db
    .prepare(
      `SELECT m.id,m.deviceId FROM deviceMonitors m JOIN externalMonitorMappings e ON e.monitorId=m.id LEFT JOIN integrationRecordBindings b ON b.id=e.bindingId WHERE m.type='external' ${where}`,
    )
    .all(
      ...(connectionId ? [connectionId] : []),
      ...(monitorId ? [monitorId] : []),
    ) as Array<{
    id: string;
    deviceId: string;
  }>;
  const reset = db.prepare(
    `UPDATE deviceMonitors SET lastResult='unknown',lastMessage='External readings require refresh.',lastCheckAt=NULL${clearPending ? ",pendingAlertKind=NULL,pendingAlertAt=NULL,lastAlertAttemptAt=NULL" : ""} WHERE id=?`,
  );
  for (const row of ids) {
    probeObservations.delete(row.id);
    reset.run(row.id);
  }
  const rollup =
    db.prepare(`UPDATE devices SET status=CASE WHEN EXISTS(SELECT 1 FROM deviceMonitors WHERE deviceId=devices.id AND enabled=1 AND type!='none' AND lastResult='online') THEN 'online' ELSE 'unknown' END
    WHERE id=? AND status IN ('online','offline') AND NOT EXISTS(SELECT 1 FROM deviceMonitors WHERE deviceId=devices.id AND enabled=1 AND type!='none' AND lastResult='offline')`);
  for (const id of new Set(ids.map((row) => row.deviceId))) rollup.run(id);
}
export function invalidateExternalConnection(connectionId: string) {
  invalidateExternalHealthWork(connectionId);
  db.prepare(
    "UPDATE integrationLatestReadings SET collectionError='configuration_changed' WHERE connectionId=?",
  ).run(connectionId);
  resetExternalMonitorResults(connectionId);
}
export function requireFreshExternalReadings() {
  invalidateIntegrationPreviewTokens();
  invalidateExternalHealthWork();
  db.prepare(
    "UPDATE integrationLatestReadings SET collectionError='refresh_required'",
  ).run();
  resetExternalMonitorResults(undefined, false);
}
export function externalMonitorResult(monitorId: string, now = Date.now()) {
  const row = db
    .prepare(
      `SELECT m.deviceId,m.enabled AS monitorEnabled,b.deviceId AS boundDeviceId,b.sourceIdentity,b.connectionId,b.providerRecordId,e.readingKey,e.alertOnDegraded,c.*,c.enabled AS connectionEnabled,r.health,r.observedAt,r.collectionError
    FROM deviceMonitors m JOIN externalMonitorMappings e ON e.monitorId=m.id LEFT JOIN integrationRecordBindings b ON b.id=e.bindingId
    LEFT JOIN integrationConnections c ON c.id=b.connectionId LEFT JOIN integrationLatestReadings r ON r.connectionId=c.id AND r.providerRecordId=b.providerRecordId AND r.readingKey=e.readingKey WHERE m.id=?`,
    )
    .get(monitorId) as Record<string, unknown> | undefined;
  const unknown = {
    result: "unknown" as const,
    message: "External reading is missing, stale or unavailable.",
  };
  if (
    !row ||
    !row.connectionId ||
    !row.monitorEnabled ||
    !row.connectionEnabled ||
    row.boundDeviceId !== row.deviceId ||
    row.sourceIdentity !== externalSourceIdentity(row) ||
    row.collectionError ||
    !row.observedAt ||
    externalReadingStale(
      String(row.observedAt),
      Number(row.healthIntervalSeconds),
      now,
    )
  )
    return unknown;
  if (row.health === "unknown") return unknown;
  const result =
    row.health === "unhealthy" ||
    (row.health === "degraded" && row.alertOnDegraded)
      ? ("offline" as const)
      : ("online" as const);
  return { result, message: `External health: ${row.health}.` };
}
export function recordExternalCollectionFailure(
  connectionId: string,
  error: ExternalCollectionError,
  now = new Date().toISOString(),
) {
  db.transaction(() => {
    db.prepare(
      "UPDATE integrationLatestReadings SET collectionError=? WHERE connectionId=?",
    ).run(error, connectionId);
    db.prepare(
      "UPDATE integrationConnections SET healthLastCheckedAt=?,healthLastError=? WHERE id=?",
    ).run(now, error, connectionId);
    resetExternalMonitorResults(connectionId, false);
  })();
}
