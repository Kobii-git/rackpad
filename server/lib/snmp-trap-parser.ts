import {
  decodeInteger,
  decodeObjectIdentifier,
  decodeSnmpValue,
  normalizeOid,
  readTlv,
} from './snmp.js'

export interface SnmpTrapVarbind {
  oid: string
  value: string
}

export interface ParsedSnmpTrap {
  snmpVersion: '1' | '2c' | 'unknown'
  community?: string
  trapOid?: string
  genericTrap?: number
  ifIndex?: number
  varbinds: SnmpTrapVarbind[]
}

export const SNMP_TRAP_LINK_DOWN_OID = '1.3.6.1.6.3.1.1.5.3'
export const SNMP_TRAP_LINK_UP_OID = '1.3.6.1.6.3.1.1.5.4'
export const IF_INDEX_COLUMN_OID = '1.3.6.1.2.1.2.2.1.1'

export function parseSnmpTrapPacket(packet: Buffer): ParsedSnmpTrap {
  const root = readTlv(packet, 0)
  if (root.tag !== 0x30) {
    throw new Error('SNMP trap packet was not a sequence.')
  }

  let offset = root.valueStart
  const versionTlv = readTlv(packet, offset)
  offset = versionTlv.nextOffset
  const communityTlv = readTlv(packet, offset)
  offset = communityTlv.nextOffset

  const version = decodeInteger(versionTlv.value)
  const community = communityTlv.value.toString('utf8')
  const pdu = readTlv(packet, offset)

  if (pdu.tag === 0xa4) {
    return parseSnmpV1TrapPdu(version, community, packet, pdu)
  }

  if (pdu.tag === 0xa7) {
    return parseSnmpV2TrapPdu(version, community, packet, pdu)
  }

  throw new Error(`Unsupported SNMP trap PDU tag 0x${pdu.tag.toString(16)}.`)
}

function parseSnmpV1TrapPdu(
  version: number,
  community: string,
  packet: Buffer,
  pdu: ReturnType<typeof readTlv>,
): ParsedSnmpTrap {
  let offset = pdu.valueStart
  offset = readTlv(packet, offset).nextOffset
  offset = readTlv(packet, offset).nextOffset
  const genericTrap = readTlv(packet, offset)
  offset = genericTrap.nextOffset
  offset = readTlv(packet, offset).nextOffset
  offset = readTlv(packet, offset).nextOffset
  const varbindsTlv = readTlv(packet, offset)
  const varbinds = parseVarbinds(packet, varbindsTlv)

  const generic = decodeInteger(genericTrap.value)
  const trapOid =
    generic === 2
      ? SNMP_TRAP_LINK_DOWN_OID
      : generic === 3
        ? SNMP_TRAP_LINK_UP_OID
        : undefined

  return {
    snmpVersion: version === 0 ? '1' : 'unknown',
    community,
    trapOid,
    genericTrap: generic,
    ifIndex: extractIfIndex(varbinds),
    varbinds,
  }
}

function parseSnmpV2TrapPdu(
  version: number,
  community: string,
  packet: Buffer,
  pdu: ReturnType<typeof readTlv>,
): ParsedSnmpTrap {
  let offset = pdu.valueStart
  offset = readTlv(packet, offset).nextOffset
  offset = readTlv(packet, offset).nextOffset
  offset = readTlv(packet, offset).nextOffset
  const varbindsTlv = readTlv(packet, offset)
  const varbinds = parseVarbinds(packet, varbindsTlv)

  const trapVarbind = varbinds.find((entry) => entry.oid === '1.3.6.1.6.3.1.1.4.1.0')
  const trapOid = trapVarbind?.value ? normalizeOid(trapVarbind.value) : undefined

  return {
    snmpVersion: version === 1 ? '2c' : 'unknown',
    community,
    trapOid,
    ifIndex: extractIfIndex(varbinds),
    varbinds,
  }
}

function parseVarbinds(packet: Buffer, varbindsTlv: ReturnType<typeof readTlv>) {
  const varbinds: SnmpTrapVarbind[] = []
  let offset = varbindsTlv.valueStart

  while (offset < varbindsTlv.nextOffset) {
    const binding = readTlv(packet, offset)
    offset = binding.nextOffset
    if (binding.tag !== 0x30) continue

    const oidTlv = readTlv(packet, binding.valueStart)
    const valueTlv = readTlv(packet, oidTlv.nextOffset)
    varbinds.push({
      oid: decodeObjectIdentifier(oidTlv.value),
      value: decodeSnmpValue(valueTlv.tag, valueTlv.value),
    })
  }

  return varbinds
}

export function extractIfIndex(varbinds: SnmpTrapVarbind[]) {
  for (const entry of varbinds) {
    const normalized = normalizeOid(entry.oid)
    if (normalized.startsWith(`${IF_INDEX_COLUMN_OID}.`)) {
      const suffix = normalized.slice(IF_INDEX_COLUMN_OID.length + 1)
      if (/^\d+$/.test(suffix)) {
        return Number.parseInt(suffix, 10)
      }
    }
    if (normalized.startsWith('1.3.6.1.2.1.2.2.1.8.')) {
      const suffix = normalized.slice('1.3.6.1.2.1.2.2.1.8.'.length)
      if (/^\d+$/.test(suffix)) {
        return Number.parseInt(suffix, 10)
      }
    }
    if (normalized.startsWith('1.3.6.1.2.1.2.2.1.2.')) {
      const suffix = normalized.slice('1.3.6.1.2.1.2.2.1.2.'.length)
      if (/^\d+$/.test(suffix)) {
        return Number.parseInt(suffix, 10)
      }
    }
  }

  for (const entry of varbinds) {
    const parsed = Number.parseInt(entry.value, 10)
    if (
      entry.oid === '1.3.6.1.2.1.2.2.1.1.0' &&
      Number.isInteger(parsed) &&
      parsed >= 0
    ) {
      return parsed
    }
  }

  return undefined
}

export function trapOidToLinkResult(trapOid: string | undefined, genericTrap?: number) {
  const normalized = trapOid ? normalizeOid(trapOid) : ''
  if (
    normalized === SNMP_TRAP_LINK_DOWN_OID ||
    normalized.endsWith('.1.3.6.1.6.3.1.1.5.3') ||
    genericTrap === 2
  ) {
    return 'offline' as const
  }
  if (
    normalized === SNMP_TRAP_LINK_UP_OID ||
    normalized.endsWith('.1.3.6.1.6.3.1.1.5.4') ||
    genericTrap === 3
  ) {
    return 'online' as const
  }
  return null
}
