import { db } from '../db.js'
import {
  buildSnmpSessionFromCredential,
  loadSnmpCredentialSecrets,
} from './snmp-credentials.js'
import type { SnmpSession } from './snmp.js'
import { decryptSecret } from './secret-crypto.js'

export function loadMonitorCommunity(id: string, deviceId: string) {
  const row = db.prepare('SELECT snmpCommunityEnc FROM deviceMonitors WHERE id = ? AND deviceId = ?')
    .get(id, deviceId) as { snmpCommunityEnc: string | null } | undefined
  return row?.snmpCommunityEnc ? decryptSecret(row.snmpCommunityEnc) : null
}

export function resolveSnmpSessionForTarget(input: {
  deviceId: string
  labId: string
  host: string
  port?: number
  timeoutMs?: number
  snmpCredentialId?: string | null
  snmpVersion?: string | null
  snmpCommunity?: string | null
}) {
  const credentialId =
    input.snmpCredentialId ??
    (
      db
        .prepare('SELECT snmpCredentialId FROM devices WHERE id = ?')
        .get(input.deviceId) as { snmpCredentialId?: string | null } | undefined
    )?.snmpCredentialId ??
    null

  if (credentialId) {
    const credential = loadSnmpCredentialSecrets(credentialId, input.labId)
    if (input.snmpVersion === '3' && credential.version !== '3') {
      throw new Error('SNMPv3 targets require a usable SNMPv3 credential.')
    }
    return buildSnmpSessionFromCredential(credential, {
      host: input.host,
      port: input.port,
      timeoutMs: input.timeoutMs,
    })
  }

  if (input.snmpVersion === '3') {
    throw new Error('SNMPv3 targets require a usable SNMPv3 credential.')
  }

  const version = input.snmpVersion === '1' || input.snmpVersion === '2c' ? input.snmpVersion : '2c'
  return {
    host: input.host,
    port: input.port ?? 161,
    timeoutMs: input.timeoutMs ?? 8000,
    version,
    community: input.snmpCommunity?.trim() || 'public',
  } satisfies SnmpSession
}

export function resolveMonitorSnmpSession(
  monitor: {
    id?: string
    deviceId: string
    target?: string | null
    port?: number | null
    snmpCredentialId?: string | null
    snmpVersion?: string | null
    snmpCommunity?: string | null
  },
  device: { labId: string; snmpCredentialId?: string | null },
) {
  if (!monitor.target) {
    throw new Error('No SNMP target configured.')
  }

  return resolveSnmpSessionForTarget({
    deviceId: monitor.deviceId,
    labId: device.labId,
    host: monitor.target,
    port: monitor.port ?? undefined,
    timeoutMs: 5000,
    snmpCredentialId: monitor.snmpCredentialId ?? device.snmpCredentialId ?? null,
    snmpVersion: monitor.snmpVersion ?? null,
    snmpCommunity: monitor.snmpCredentialId || device.snmpCredentialId
      ? null
      : monitor.id ? loadMonitorCommunity(monitor.id, monitor.deviceId) : monitor.snmpCommunity ?? null,
  })
}
