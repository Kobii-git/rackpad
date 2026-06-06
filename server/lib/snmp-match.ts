import type { DiscoveredSnmpInterface } from './snmp-if-mib.js'

export const SNMP_MATCH_MODES = ['any', 'equals', 'notEquals', 'in'] as const
export type SnmpMatchMode = (typeof SNMP_MATCH_MODES)[number]

export function evaluateSnmpMatch(
  mode: SnmpMatchMode | null | undefined,
  actual: string,
  expected: string | null | undefined,
): boolean {
  const normalizedMode = mode ?? (expected?.trim() ? 'equals' : 'any')
  const expectedValue = expected?.trim() ?? ''

  if (normalizedMode === 'any') {
    return true
  }

  if (!expectedValue) {
    return false
  }

  if (normalizedMode === 'equals') {
    return actual === expectedValue
  }

  if (normalizedMode === 'notEquals') {
    return actual !== expectedValue
  }

  if (normalizedMode === 'in') {
    const allowed = expectedValue
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    return allowed.includes(actual)
  }

  return actual === expectedValue
}

export function normalizePortLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^ge-?/i, '')
    .replace(/^gi-?/i, '')
    .replace(/^eth-?/i, '')
    .replace(/^port-?/i, '')
    .replace(/[^a-z0-9]/g, '')
}

export function matchPortForInterface(
  ports: Array<{ id: string; name: string; snmpIfIndex?: number | null }>,
  entry: DiscoveredSnmpInterface,
) {
  const byIndex = ports.find((port) => port.snmpIfIndex === entry.ifIndex)
  if (byIndex) return byIndex.id

  const candidates = [
    entry.name,
    entry.alias,
    entry.descr,
    `eth${entry.ifIndex}`,
    `port${entry.ifIndex}`,
    String(entry.ifIndex),
  ]
    .filter((value): value is string => !!value?.trim())
    .map(normalizePortLabel)

  for (const port of ports) {
    const normalizedPortName = normalizePortLabel(port.name)
    if (!normalizedPortName) continue
    if (candidates.some((candidate) => candidate === normalizedPortName)) {
      return port.id
    }
    if (
      candidates.some(
        (candidate) =>
          candidate.length >= 2 &&
          (normalizedPortName.includes(candidate) || candidate.includes(normalizedPortName)),
      )
    ) {
      return port.id
    }
  }

  return null
}

export const IF_OPER_STATUS_OID_PREFIX = '1.3.6.1.2.1.2.2.1.8'

export function isIfOperStatusOid(oid: string | null | undefined) {
  if (!oid) return false
  return oid.replace(/^\./, '').startsWith(IF_OPER_STATUS_OID_PREFIX)
}

export function operStatusToLinkState(result: 'online' | 'offline' | 'unknown') {
  if (result === 'online') return 'up'
  if (result === 'offline') return 'down'
  return 'unknown'
}
