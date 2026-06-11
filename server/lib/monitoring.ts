import { spawn } from 'node:child_process'
import net from 'node:net'
import { db } from '../db.js'
import { sendMonitorTransitionAlert } from './alerts.js'
import { ensureRoutableHost } from './net-guard.js'
import { snmpGet, SNMP_VERSIONS, type SnmpVersion } from './snmp.js'
import { resolveMonitorSnmpSession } from './snmp-session.js'
import {
  evaluateSnmpMatch,
  isIfOperStatusOid,
  operStatusToLinkState,
  SNMP_MATCH_MODES,
  type SnmpMatchMode,
} from './snmp-match.js'

export const MONITOR_TYPES = ['none', 'icmp', 'tcp', 'http', 'https', 'snmp'] as const
export type MonitorType = (typeof MONITOR_TYPES)[number]
export { SNMP_VERSIONS, type SnmpVersion, SNMP_MATCH_MODES, type SnmpMatchMode }
export type MonitorResult = { result: 'online' | 'offline' | 'unknown'; message: string }

export interface DeviceMonitor {
  id: string
  deviceId: string
  name: string
  type: MonitorType
  target?: string | null
  port?: number | null
  path?: string | null
  snmpVersion?: SnmpVersion | null
  snmpCommunity?: string | null
  snmpOid?: string | null
  snmpExpectedValue?: string | null
  snmpMatchMode?: SnmpMatchMode | null
  portId?: string | null
  snmpIfIndex?: number | null
  snmpCredentialId?: string | null
  intervalMs?: number | null
  enabled: boolean
  sortOrder: number
  lastCheckAt?: string | null
  lastAlertAt?: string | null
  lastResult?: string | null
  lastMessage?: string | null
}

let intervalHandle: NodeJS.Timeout | null = null

export function parseMonitor(row: Record<string, unknown>): DeviceMonitor {
  return {
    id: String(row.id),
    deviceId: String(row.deviceId),
    name: row.name ? String(row.name) : 'Primary',
    type: String(row.type) as MonitorType,
    target: row.target ? String(row.target) : null,
    port: row.port == null ? null : Number(row.port),
    path: row.path ? String(row.path) : null,
    snmpVersion: row.snmpVersion ? String(row.snmpVersion) as SnmpVersion : null,
    snmpCommunity: row.snmpCommunity ? String(row.snmpCommunity) : null,
    snmpOid: row.snmpOid ? String(row.snmpOid) : null,
    snmpExpectedValue: row.snmpExpectedValue ? String(row.snmpExpectedValue) : null,
    snmpMatchMode: row.snmpMatchMode
      ? (String(row.snmpMatchMode) as SnmpMatchMode)
      : null,
    portId: row.portId ? String(row.portId) : null,
    snmpIfIndex: row.snmpIfIndex == null ? null : Number(row.snmpIfIndex),
    snmpCredentialId: row.snmpCredentialId ? String(row.snmpCredentialId) : null,
    intervalMs: row.intervalMs == null ? null : Number(row.intervalMs),
    enabled: Number(row.enabled ?? 0) === 1,
    sortOrder: row.sortOrder == null ? 0 : Number(row.sortOrder),
    lastCheckAt: row.lastCheckAt ? String(row.lastCheckAt) : null,
    lastAlertAt: row.lastAlertAt ? String(row.lastAlertAt) : null,
    lastResult: row.lastResult ? String(row.lastResult) : null,
    lastMessage: row.lastMessage ? String(row.lastMessage) : null,
  }
}

export function listMonitors(deviceId?: string) {
  const rows = deviceId
    ? db.prepare('SELECT * FROM deviceMonitors WHERE deviceId = ? ORDER BY deviceId, sortOrder, name, id').all(deviceId)
    : db.prepare('SELECT * FROM deviceMonitors ORDER BY deviceId, sortOrder, name, id').all()
  return (rows as Record<string, unknown>[]).map(parseMonitor)
}

export function startMonitoringLoop(defaultIntervalMs: number) {
  if (defaultIntervalMs <= 0) return () => {}
  if (intervalHandle) clearInterval(intervalHandle)

  intervalHandle = setInterval(() => {
    void runDueChecks(defaultIntervalMs)
  }, defaultIntervalMs)
  intervalHandle.unref?.()

  return () => {
    if (intervalHandle) clearInterval(intervalHandle)
    intervalHandle = null
  }
}

export async function runDueChecks(defaultIntervalMs: number) {
  const monitors = listMonitors().filter((monitor) => monitor.enabled && monitor.type !== 'none')
  for (const monitor of monitors) {
    const dueEvery = monitor.intervalMs ?? defaultIntervalMs
    if (!monitor.lastCheckAt || Date.now() - Date.parse(monitor.lastCheckAt) >= dueEvery) {
      await runMonitorCheck(monitor.id)
    }
  }
}

export async function runMonitorCheck(id: string) {
  const row = db.prepare('SELECT * FROM deviceMonitors WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) {
    return null
  }

  const monitor = parseMonitor(row)
  const checkedAt = new Date().toISOString()

  if (!monitor.enabled || monitor.type === 'none') {
    await persistMonitorResult(monitor, {
      checkedAt,
      result: 'unknown',
      message: 'Health checks disabled.',
    })
    return parseMonitor(db.prepare('SELECT * FROM deviceMonitors WHERE id = ?').get(id) as Record<string, unknown>)
  }

  const result = await executeCheck(monitor)
  await persistMonitorResult(monitor, { checkedAt, ...result })
  return parseMonitor(db.prepare('SELECT * FROM deviceMonitors WHERE id = ?').get(id) as Record<string, unknown>)
}

export async function runDeviceChecks(deviceId: string) {
  const monitors = listMonitors(deviceId).filter((monitor) => monitor.enabled && monitor.type !== 'none')
  const results: DeviceMonitor[] = []
  for (const monitor of monitors) {
    const result = await runMonitorCheck(monitor.id)
    if (result) results.push(result)
  }
  return results
}

async function persistMonitorResult(
  monitor: DeviceMonitor,
  payload: { checkedAt: string; result: 'online' | 'offline' | 'unknown'; message: string },
) {
  db.prepare(`
    UPDATE deviceMonitors
    SET lastCheckAt = ?, lastResult = ?, lastMessage = ?
    WHERE id = ?
  `).run(payload.checkedAt, payload.result, payload.message, monitor.id)

  const currentDevice = db.prepare(`
    SELECT hostname, displayName, managementIp, deviceType, status
    FROM devices
    WHERE id = ?
  `).get(monitor.deviceId) as
    | { hostname?: string; displayName?: string | null; managementIp?: string | null; deviceType?: string | null; status?: string }
    | undefined
  if (!currentDevice) return

  syncMonitorPortState(monitor, payload.result)

  refreshDeviceMonitorRollup(monitor.deviceId, currentDevice.status, payload.checkedAt)

  await sendMonitorTransitionAlert(monitor.lastResult, monitor.lastAlertAt, {
    deviceId: monitor.deviceId,
    monitorId: monitor.id,
    hostname: currentDevice.hostname ?? monitor.deviceId,
    displayName: currentDevice.displayName ?? null,
    deviceType: currentDevice.deviceType ?? null,
    managementIp: currentDevice.managementIp ?? monitor.target ?? null,
    monitorName: monitor.name,
    monitorType: monitor.type,
    target: monitor.target ?? null,
    result: payload.result,
    message: payload.message,
    checkedAt: payload.checkedAt,
  })
}

export async function recordMonitorResult(
  monitorId: string,
  payload: { result: 'online' | 'offline' | 'unknown'; message: string },
) {
  const row = db.prepare('SELECT * FROM deviceMonitors WHERE id = ?').get(monitorId) as
    | Record<string, unknown>
    | undefined
  if (!row) return null

  const monitor = parseMonitor(row)
  const checkedAt = new Date().toISOString()
  await persistMonitorResult(monitor, { checkedAt, ...payload })
  return parseMonitor(
    db.prepare('SELECT * FROM deviceMonitors WHERE id = ?').get(monitorId) as Record<string, unknown>,
  )
}

export function reconcileDeviceMonitorRollup(deviceId: string) {
  const currentDevice = db.prepare(`
    SELECT status
    FROM devices
    WHERE id = ?
  `).get(deviceId) as { status?: string } | undefined
  if (!currentDevice) return
  refreshDeviceMonitorRollup(deviceId, currentDevice.status, null)
}

function refreshDeviceMonitorRollup(deviceId: string, currentStatus: string | undefined, checkedAt: string | null) {
  const activeMonitors = listMonitors(deviceId).filter((monitor) => monitor.enabled && monitor.type !== 'none')
  const latestOnlineCheck = activeMonitors
    .filter((monitor) => monitor.lastResult === 'online' && monitor.lastCheckAt)
    .map((monitor) => String(monitor.lastCheckAt))
    .sort()
    .at(-1) ?? checkedAt

  if (currentStatus === 'maintenance') {
    if (latestOnlineCheck) {
      db.prepare('UPDATE devices SET lastSeen = ? WHERE id = ?').run(latestOnlineCheck, deviceId)
    }
    return
  }

  if (activeMonitors.length === 0) {
    return
  }

  if (activeMonitors.some((monitor) => monitor.lastResult === 'offline')) {
    db.prepare('UPDATE devices SET status = ? WHERE id = ?').run('offline', deviceId)
    return
  }

  if (activeMonitors.some((monitor) => monitor.lastResult === 'online')) {
    db.prepare('UPDATE devices SET status = ?, lastSeen = ? WHERE id = ?').run('online', latestOnlineCheck ?? checkedAt ?? new Date().toISOString(), deviceId)
    return
  }

  db.prepare('UPDATE devices SET status = ? WHERE id = ?').run('unknown', deviceId)
}

async function executeCheck(monitor: DeviceMonitor) {
  try {
    if (!monitor.target) {
      return { result: 'unknown' as const, message: 'No target configured.' }
    }

    if (monitor.type === 'icmp') {
      return runIcmpProbe(monitor.target)
    }

    if (monitor.type === 'tcp') {
      const port = monitor.port ?? 22
      return tcpCheck(monitor.target, port)
    }

    if (monitor.type === 'http' || monitor.type === 'https') {
      const port = monitor.port ?? (monitor.type === 'https' ? 443 : 80)
      const path = monitor.path?.trim() || '/'
      const host = net.isIP(monitor.target) === 6 ? `[${monitor.target}]` : monitor.target
      const url = new URL(`${monitor.type}://${host}:${port}${path.startsWith('/') ? path : `/${path}`}`)
      await ensureRoutableHost(url)
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (!res.ok) {
        return { result: 'offline' as const, message: `${url} returned ${res.status}.` }
      }
      return { result: 'online' as const, message: `${url} returned ${res.status}.` }
    }

    if (monitor.type === 'snmp') {
      return snmpCheck(monitor)
    }

    return { result: 'unknown' as const, message: 'Unknown check type.' }
  } catch (error) {
    return {
      result: 'offline' as const,
      message: error instanceof Error ? error.message : 'Health check failed.',
    }
  }
}

export function runIcmpProbe(host: string): Promise<MonitorResult> {
  const { command, args } = getPingCommand(host)

  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false

    const finish = (result: MonitorResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }

    const timeout = setTimeout(() => {
      child.kill()
      finish({
        result: 'offline',
        message: `ICMP ${host} timed out from the Rackpad server.`,
      })
    }, 6000)

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })

    child.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish({
          result: 'unknown',
          message: 'ICMP ping is unavailable in the Rackpad runtime. Install ping support or use TCP/HTTP checks instead.',
        })
        return
      }
      finish({
        result: 'offline',
        message: error.message,
      })
    })

    child.once('close', (code) => {
      if (code === 0) {
        finish({
          result: 'online',
          message: `ICMP ${host} reachable.`,
        })
        return
      }

      finish({
        result: 'offline',
        message: summarizePingFailure(host, stdout, stderr),
      })
    })
  })
}

function tcpCheck(host: string, port: number) {
  return new Promise<{ result: 'online' | 'offline'; message: string }>((resolve, reject) => {
    const socket = net.connect({ host, port })
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve({
        result: 'offline',
        message: `TCP ${host}:${port} timed out from the Rackpad server.`,
      })
    }, 5000)

    socket.once('connect', () => {
      clearTimeout(timeout)
      socket.end()
      resolve({
        result: 'online',
        message: `TCP ${host}:${port} reachable.`,
      })
    })

    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout)
      socket.destroy()
      if (error.code === 'ECONNREFUSED') {
        resolve({
          result: 'online',
          message: `Host ${host} is reachable, but TCP ${port} refused the connection.`,
        })
        return
      }
      if (error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH') {
        resolve({
          result: 'offline',
          message: `TCP ${host}:${port} is unreachable from the Rackpad server.`,
        })
        return
      }
      if (error.code === 'EACCES' || error.code === 'EPERM') {
        resolve({
          result: 'offline',
          message: `TCP ${host}:${port} could not be opened from the Rackpad runtime: ${error.message}`,
        })
        return
      }
      reject(error)
    })
  })
}

async function snmpCheck(monitor: DeviceMonitor): Promise<MonitorResult> {
  if (!monitor.target) {
    return { result: 'unknown', message: 'No SNMP target configured.' }
  }
  if (!monitor.snmpOid) {
    return { result: 'unknown', message: 'No SNMP OID configured.' }
  }

  const port = monitor.port ?? 161
  const device = db
    .prepare('SELECT labId, snmpCredentialId FROM devices WHERE id = ?')
    .get(monitor.deviceId) as { labId: string; snmpCredentialId?: string | null } | undefined
  if (!device) {
    return { result: 'unknown', message: 'Device not found for SNMP monitor.' }
  }

  const session = resolveMonitorSnmpSession(monitor, device)
  const response = await snmpGet(session, monitor.snmpOid)
  const expected = monitor.snmpExpectedValue?.trim()
  const message = `SNMP ${monitor.target}:${port} ${response.oid} = ${response.value}`
  const matchMode = monitor.snmpMatchMode ?? (expected ? 'equals' : 'any')
  const matched = evaluateSnmpMatch(matchMode, response.value, expected)

  if (matched) {
    const suffix =
      matchMode === 'any'
        ? ''
        : matchMode === 'in'
          ? ` (matched allowed values ${expected}).`
          : ` (matched expected value${matchMode === 'notEquals' ? ' not' : ''}).`
    return {
      result: 'online',
      message: `${message}${suffix || ' (matched expected value).'}`,
    }
  }

  return {
    result: 'offline',
    message: `${message} (expected ${expected || 'match'} via ${matchMode}).`,
  }
}

function syncMonitorPortState(
  monitor: DeviceMonitor,
  result: 'online' | 'offline' | 'unknown',
) {
  if (monitor.type !== 'snmp' || !isIfOperStatusOid(monitor.snmpOid)) return

  const linkState = operStatusToLinkState(result)

  if (monitor.portId) {
    db.prepare('UPDATE ports SET linkState = ? WHERE id = ?').run(
      linkState,
      monitor.portId,
    )
    return
  }

  if (monitor.snmpIfIndex != null) {
    db.prepare(`
      UPDATE ports
      SET linkState = ?
      WHERE deviceId = ? AND snmpIfIndex = ?
    `).run(linkState, monitor.deviceId, monitor.snmpIfIndex)
  }
}

function getPingCommand(host: string) {
  if (process.platform === 'win32') {
    return { command: 'ping', args: ['-n', '1', '-w', '5000', host] }
  }

  return { command: 'ping', args: ['-c', '1', '-W', '5', host] }
}

function summarizePingFailure(host: string, stdout: string, stderr: string) {
  const lines = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.toLowerCase().startsWith('ping '))

  const excerpt = lines.at(-1) ?? lines[0]
  if (!excerpt) {
    return `ICMP ${host} is unreachable from the Rackpad server.`
  }
  return `ICMP ${host} failed: ${excerpt}`
}
