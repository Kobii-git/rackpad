import { randomInt } from 'node:crypto'
import dgram from 'node:dgram'
import { snmpV3Get, snmpV3GetNext, type SnmpV3Session } from './snmp-v3.js'

export const SNMP_VERSIONS = ['1', '2c', '3'] as const
export type SnmpVersion = (typeof SNMP_VERSIONS)[number]

export const SNMP_EXCEPTION_TYPES = [
  'noSuchObject',
  'noSuchInstance',
  'endOfMibView',
] as const
export type SnmpExceptionType = (typeof SNMP_EXCEPTION_TYPES)[number]

export interface SnmpValue {
  kind: 'value'
  oid: string
  value: string
  type: string
}

export interface SnmpException {
  kind: 'exception'
  oid: string
  exception: SnmpExceptionType
}

export type SnmpResponse = SnmpValue | SnmpException

export interface SnmpV1V2Session {
  host: string
  port: number
  version: '1' | '2c'
  community: string
  timeoutMs: number
}

export type SnmpSession = SnmpV1V2Session | SnmpV3Session
export type { SnmpV3Session }

const MIN_SNMP_TIMEOUT_MS = 1000
const MAX_SNMP_TIMEOUT_MS = 30_000
const DEFAULT_SNMP_TIMEOUT_MS = 8000
const SNMP_TIMEOUT_BUCKETS_MS = [
  1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000,
  11_000, 12_000, 13_000, 14_000, 15_000, 16_000, 17_000, 18_000,
  19_000, 20_000, 21_000, 22_000, 23_000, 24_000, 25_000, 26_000,
  27_000, 28_000, 29_000, 30_000,
] as const

export function boundedSnmpTimeoutMs(timeoutMs: number) {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_SNMP_TIMEOUT_MS
  const bounded = Math.min(
    MAX_SNMP_TIMEOUT_MS,
    Math.max(MIN_SNMP_TIMEOUT_MS, Math.trunc(timeoutMs)),
  )
  const bucketIndex = Math.ceil(bounded / 1000) - 1
  return SNMP_TIMEOUT_BUCKETS_MS[bucketIndex] ?? DEFAULT_SNMP_TIMEOUT_MS
}

export function snmpGet(session: SnmpSession, oid: string): Promise<SnmpResponse> {
  if (session.version === '3') {
    return snmpV3Get(session, oid)
  }
  return snmpRequest(session, oid, 'get')
}

export function snmpGetNext(session: SnmpSession, oid: string): Promise<SnmpResponse> {
  if (session.version === '3') {
    return snmpV3GetNext(session, oid)
  }
  return snmpRequest(session, oid, 'getNext')
}

export async function snmpWalkColumn(
  session: SnmpSession,
  columnOid: string,
  maxRows = 512,
): Promise<SnmpValue[]> {
  const prefix = normalizeOid(columnOid)
  const results: SnmpValue[] = []
  let currentOid = prefix

  for (let index = 0; index < maxRows; index += 1) {
    const response = await snmpGetNext(session, currentOid)
    if (response.kind === 'exception') {
      break
    }
    const responseOid = normalizeOid(response.oid)
    if (!responseOid.startsWith(`${prefix}.`) && responseOid !== prefix) {
      break
    }
    results.push({ ...response, oid: responseOid })
    currentOid = responseOid
  }

  return results
}

function snmpRequest(
  session: SnmpV1V2Session,
  oid: string,
  mode: 'get' | 'getNext',
): Promise<SnmpResponse> {
  const socket = dgram.createSocket('udp4')
  const requestId = randomInt(1, 0x7fffffff)
  const pduTag = mode === 'get' ? 0xa0 : 0xa1
  const timeoutMs = boundedSnmpTimeoutMs(session.timeoutMs)
  const message = buildSnmpRequest(
    session.version,
    session.community,
    oid,
    requestId,
    pduTag,
  )

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
        reject(
          new Error(
            `SNMP ${session.host}:${session.port} timed out from the Rackpad server.`,
          ),
        )
      })
    }, timeoutMs)

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

    socket.send(message, session.port, session.host, (error) => {
      if (error) {
        finish(() => reject(error))
      }
    })
  })
}

function buildSnmpRequest(
  version: '1' | '2c',
  community: string,
  oid: string,
  requestId: number,
  pduTag: number,
) {
  const variableBinding = berSequence(
    Buffer.concat([berObjectIdentifier(oid), Buffer.from([0x05, 0x00])]),
  )
  const variableBindings = berSequence(variableBinding)
  const pdu = berTlv(
    pduTag,
    Buffer.concat([
      berInteger(requestId),
      berInteger(0),
      berInteger(0),
      variableBindings,
    ]),
  )

  return berSequence(
    Buffer.concat([
      berInteger(version === '1' ? 0 : 1),
      berOctetString(community),
      pdu,
    ]),
  )
}

function parseSnmpResponse(packet: Buffer, expectedRequestId: number): SnmpResponse {
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
    throw new Error(
      `SNMP agent returned error status ${status} at index ${decodeInteger(errorIndex.value)}.`,
    )
  }

  const variableBindings = readTlv(packet, offset)
  if (variableBindings.tag !== 0x30) {
    throw new Error('SNMP response did not include variable bindings.')
  }
  const variableBinding = readTlv(packet, variableBindings.valueStart)
  if (variableBinding.tag !== 0x30) {
    throw new Error('SNMP variable binding was invalid.')
  }

  const oid = readTlv(packet, variableBinding.valueStart)
  if (oid.tag !== 0x06) throw new Error('SNMP variable binding did not include an OID.')
  const value = readTlv(packet, oid.nextOffset)
  return decodeSnmpResponseValue(
    decodeObjectIdentifier(oid.value),
    value.tag,
    value.value,
  )
}

export function normalizeOid(value: string) {
  return value.replace(/^\./, '')
}

export function oidSuffixIndex(oid: string, columnOid: string) {
  const normalized = normalizeOid(oid)
  const prefix = normalizeOid(columnOid)
  if (!normalized.startsWith(`${prefix}.`)) return null
  const suffix = normalized.slice(prefix.length + 1)
  if (!/^\d+$/.test(suffix)) return null
  return Number.parseInt(suffix, 10)
}

export function buildInterfaceOperStatusOid(ifIndex: number) {
  return `1.3.6.1.2.1.2.2.1.8.${ifIndex}`
}

export function berTlv(tag: number, value: Buffer) {
  return Buffer.concat([Buffer.from([tag]), berLength(value.length), value])
}

export function berSequence(value: Buffer) {
  return berTlv(0x30, value)
}

export function berInteger(value: number) {
  if (value === 0) return berTlv(0x02, Buffer.from([0]))
  const bytes: number[] = []
  let next = value
  while (next > 0) {
    bytes.unshift(next & 0xff)
    next >>= 8
  }
  if (bytes[0]! >= 0x80) bytes.unshift(0)
  return berTlv(0x02, Buffer.from(bytes))
}

export function berOctetString(value: string | Buffer) {
  return berTlv(0x04, typeof value === 'string' ? Buffer.from(value, 'utf8') : value)
}

export function berObjectIdentifier(value: string) {
  const parts = normalizeOid(value)
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

export function readTlv(packet: Buffer, offset: number) {
  if (offset >= packet.length) throw new Error('SNMP packet ended unexpectedly.')
  const tag = packet[offset]
  const lengthByte = packet[offset + 1]
  if (lengthByte == null) throw new Error('SNMP packet length was missing.')

  let length = lengthByte
  let valueStart = offset + 2
  if (lengthByte & 0x80) {
    const byteCount = lengthByte & 0x7f
    if (byteCount === 0 || byteCount > 4) {
      throw new Error('SNMP packet used an unsupported BER length.')
    }
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

export function decodeInteger(value: Buffer) {
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
    result = result * 256 + byte
  }
  return result
}

export function decodeObjectIdentifier(value: Buffer) {
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

export function decodeSnmpValue(tag: number, value: Buffer) {
  if (tag === 0x02) return String(decodeInteger(value))
  if (tag === 0x04) return value.toString('utf8')
  if (tag === 0x05) return 'null'
  if (tag === 0x06) return decodeObjectIdentifier(value)
  if (tag === 0x40) return [...value].join('.')
  if (tag === 0x41 || tag === 0x42 || tag === 0x43 || tag === 0x47) {
    return String(decodeUnsigned(value))
  }
  if (tag === 0x46) {
    return value.reduce((total, byte) => total * 256n + BigInt(byte), 0n).toString()
  }
  return value.toString('hex')
}

export function decodeSnmpResponseValue(
  oid: string,
  tag: number,
  value: Buffer,
): SnmpResponse {
  const exception = snmpExceptionType(tag)
  if (exception) {
    return {
      kind: 'exception',
      oid,
      exception,
    }
  }

  return {
    kind: 'value',
    oid,
    value: decodeSnmpValue(tag, value),
    type: snmpValueType(tag),
  }
}

function snmpExceptionType(tag: number): SnmpExceptionType | null {
  if (tag === 0x80) return 'noSuchObject'
  if (tag === 0x81) return 'noSuchInstance'
  if (tag === 0x82) return 'endOfMibView'
  return null
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

export function validateSnmpOid(value: string | null | undefined) {
  if (!value) return
  const parts = normalizeOid(value).split('.')
  if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error('SNMP OID must be a dotted numeric object identifier.')
  }
  const [rootRaw, branchRaw] = parts
  const root = Number.parseInt(rootRaw, 10)
  const branch = Number.parseInt(branchRaw, 10)
  if (root < 0 || root > 2 || branch < 0 || (root < 2 && branch > 39)) {
    throw new Error('SNMP OID root is invalid.')
  }
}
