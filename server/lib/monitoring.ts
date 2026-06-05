import { spawn } from 'node:child_process'
import dgram from 'node:dgram'
import net from 'node:net'
import { db } from '../db.js'
import { sendMonitorTransitionAlert } from './alerts.js'

export const MONITOR_TYPES = ['none', 'icmp', 'tcp', 'http', 'https', 'snmp'] as const
export type MonitorType = (typeof MONITOR_TYPES)[number]
export const SNMP_VERSIONS = ['1', '2c'] as const
export type SnmpVersion = (typeof SNMP_VERSIONS)[number]
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
      const url = new URL(`${monitor.type}://${monitor.target}:${port}${path.startsWith('/') ? path : `/${path}`}`)
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
  const response = await snmpGet({
    host: monitor.target,
    port,
    version: monitor.snmpVersion ?? '2c',
    community: monitor.snmpCommunity?.trim() || 'public',
    oid: monitor.snmpOid,
    timeoutMs: 5000,
  })
  const expected = monitor.snmpExpectedValue?.trim()
  const message = `SNMP ${monitor.target}:${port} ${response.oid} = ${response.value}`

  if (!expected) {
    return { result: 'online', message }
  }

  if (response.value === expected) {
    return { result: 'online', message: `${message} (matched expected value).` }
  }

  return {
    result: 'offline',
    message: `${message} (expected ${expected}).`,
  }
}

function snmpGet(input: {
  host: string
  port: number
  version: SnmpVersion
  community: string
  oid: string
  timeoutMs: number
}): Promise<{ oid: string; value: string; type: string }> {
  const socket = dgram.createSocket('udp4')
  const requestId = Math.floor(Math.random() * 0x7fffffff)
  const message = buildSnmpGetRequest(input.version, input.community, input.oid, requestId)

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      socket.close()
      callback()
    }

    const timeout = setTimeout(() => {
      finish(() => {
        reject(new Error(`SNMP ${input.host}:${input.port} timed out from the Rackpad server.`))
      })
    }, input.timeoutMs)

    socket.once('error', (error) => {
      finish(() => reject(error))
    })

    socket.once('message', (packet) => {
      finish(() => {
        try {
          resolve(parseSnmpResponse(packet, requestId))
        } catch (error) {
          reject(error)
        }
      })
    })

    socket.send(message, input.port, input.host, (error) => {
      if (error) {
        finish(() => reject(error))
      }
    })
  })
}

function buildSnmpGetRequest(version: SnmpVersion, community: string, oid: string, requestId: number) {
  const variableBinding = berSequence(Buffer.concat([berObjectIdentifier(oid), Buffer.from([0x05, 0x00])]))
  const variableBindings = berSequence(variableBinding)
  const pdu = berTlv(0xa0, Buffer.concat([
    berInteger(requestId),
    berInteger(0),
    berInteger(0),
    variableBindings,
  ]))

  return berSequence(Buffer.concat([
    berInteger(version === '1' ? 0 : 1),
    berOctetString(community),
    pdu,
  ]))
}

function parseSnmpResponse(packet: Buffer, expectedRequestId: number) {
  const root = readTlv(packet, 0)
  if (root.tag !== 0x30) throw new Error('SNMP response was not a sequence.')

  let offset = root.valueStart
  const version = readTlv(packet, offset)
  offset = version.nextOffset
  const community = readTlv(packet, offset)
  offset = community.nextOffset
  if (version.tag !== 0x02 || community.tag !== 0x04) {
    throw new Error('SNMP response header was invalid.')
  }

  const pdu = readTlv(packet, offset)
  if (pdu.tag !== 0xa2) throw new Error('SNMP response did not contain a response PDU.')

  offset = pdu.valueStart
  const requestId = readTlv(packet, offset)
  offset = requestId.nextOffset
  const errorStatus = readTlv(packet, offset)
  offset = errorStatus.nextOffset
  const errorIndex = readTlv(packet, offset)
  offset = errorIndex.nextOffset

  if (decodeInteger(requestId.value) !== expectedRequestId) {
    throw new Error('SNMP response request id did not match.')
  }

  const status = decodeInteger(errorStatus.value)
  if (status !== 0) {
    throw new Error(`SNMP agent returned error status ${status} at index ${decodeInteger(errorIndex.value)}.`)
  }

  const variableBindings = readTlv(packet, offset)
  if (variableBindings.tag !== 0x30) throw new Error('SNMP response did not include variable bindings.')
  const variableBinding = readTlv(packet, variableBindings.valueStart)
  if (variableBinding.tag !== 0x30) throw new Error('SNMP variable binding was invalid.')

  const oid = readTlv(packet, variableBinding.valueStart)
  if (oid.tag !== 0x06) throw new Error('SNMP variable binding did not include an OID.')
  const value = readTlv(packet, oid.nextOffset)
  if (value.tag === 0x80 || value.tag === 0x81 || value.tag === 0x82) {
    throw new Error(`SNMP agent returned ${snmpValueType(value.tag)} for ${decodeObjectIdentifier(oid.value)}.`)
  }

  return {
    oid: decodeObjectIdentifier(oid.value),
    value: decodeSnmpValue(value.tag, value.value),
    type: snmpValueType(value.tag),
  }
}

function berTlv(tag: number, value: Buffer) {
  return Buffer.concat([Buffer.from([tag]), berLength(value.length), value])
}

function berSequence(value: Buffer) {
  return berTlv(0x30, value)
}

function berInteger(value: number) {
  if (value === 0) return berTlv(0x02, Buffer.from([0]))
  const bytes: number[] = []
  let next = value
  while (next > 0) {
    bytes.unshift(next & 0xff)
    next >>= 8
  }
  if (bytes[0] >= 0x80) bytes.unshift(0)
  return berTlv(0x02, Buffer.from(bytes))
}

function berOctetString(value: string) {
  return berTlv(0x04, Buffer.from(value, 'utf8'))
}

function berObjectIdentifier(value: string) {
  const parts = value
    .replace(/^\./, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))

  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error('SNMP OID must be a dotted numeric object identifier.')
  }
  if (parts[0] > 2 || (parts[0] < 2 && parts[1] > 39)) {
    throw new Error('SNMP OID root is invalid.')
  }

  const bytes = [parts[0] * 40 + parts[1]]
  for (const part of parts.slice(2)) {
    bytes.push(...encodeBase128(part))
  }
  return berTlv(0x06, Buffer.from(bytes))
}

function encodeBase128(value: number) {
  if (value === 0) return [0]
  const bytes: number[] = []
  let next = value
  while (next > 0) {
    bytes.unshift(next & 0x7f)
    next >>= 7
  }
  for (let index = 0; index < bytes.length - 1; index += 1) {
    bytes[index] |= 0x80
  }
  return bytes
}

function berLength(length: number) {
  if (length < 0x80) return Buffer.from([length])
  const bytes: number[] = []
  let next = length
  while (next > 0) {
    bytes.unshift(next & 0xff)
    next >>= 8
  }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function readTlv(packet: Buffer, offset: number) {
  if (offset >= packet.length) throw new Error('SNMP packet ended unexpectedly.')
  const tag = packet[offset]
  const lengthByte = packet[offset + 1]
  if (lengthByte == null) throw new Error('SNMP packet length was missing.')

  let length = lengthByte
  let valueStart = offset + 2
  if (lengthByte & 0x80) {
    const byteCount = lengthByte & 0x7f
    if (byteCount === 0 || byteCount > 4) throw new Error('SNMP packet used an unsupported BER length.')
    length = 0
    for (let index = 0; index < byteCount; index += 1) {
      const byte = packet[valueStart + index]
      if (byte == null) throw new Error('SNMP packet length was truncated.')
      length = (length << 8) | byte
    }
    valueStart += byteCount
  }

  const nextOffset = valueStart + length
  if (nextOffset > packet.length) throw new Error('SNMP packet value was truncated.')
  return {
    tag,
    valueStart,
    nextOffset,
    value: packet.subarray(valueStart, nextOffset),
  }
}

function decodeInteger(value: Buffer) {
  if (value.length === 0) return 0
  let result = value[0] & 0x7f
  for (let index = 1; index < value.length; index += 1) {
    result = (result << 8) | value[index]
  }
  return (value[0] & 0x80) ? result * -1 : result
}

function decodeUnsigned(value: Buffer) {
  let result = 0
  for (const byte of value) {
    result = (result * 256) + byte
  }
  return result
}

function decodeObjectIdentifier(value: Buffer) {
  const first = value[0]
  if (first == null) return ''
  const parts = [Math.floor(first / 40), first % 40]
  let current = 0
  for (const byte of value.subarray(1)) {
    current = (current << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) {
      parts.push(current)
      current = 0
    }
  }
  return parts.join('.')
}

function decodeSnmpValue(tag: number, value: Buffer) {
  if (tag === 0x02) return String(decodeInteger(value))
  if (tag === 0x04) return value.toString('utf8')
  if (tag === 0x05) return 'null'
  if (tag === 0x06) return decodeObjectIdentifier(value)
  if (tag === 0x40) return [...value].join('.')
  if (tag === 0x41 || tag === 0x42 || tag === 0x43 || tag === 0x47) {
    return String(decodeUnsigned(value))
  }
  if (tag === 0x46) {
    return value.reduce((total, byte) => (total * 256n) + BigInt(byte), 0n).toString()
  }
  return value.toString('hex')
}

function snmpValueType(tag: number) {
  switch (tag) {
    case 0x02:
      return 'integer'
    case 0x04:
      return 'string'
    case 0x05:
      return 'null'
    case 0x06:
      return 'oid'
    case 0x40:
      return 'ipAddress'
    case 0x41:
      return 'counter32'
    case 0x42:
      return 'gauge32'
    case 0x43:
      return 'timeTicks'
    case 0x46:
      return 'counter64'
    case 0x47:
      return 'uinteger32'
    case 0x80:
      return 'noSuchObject'
    case 0x81:
      return 'noSuchInstance'
    case 0x82:
      return 'endOfMibView'
    default:
      return `tag 0x${tag.toString(16)}`
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
