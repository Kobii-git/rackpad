export function ipToInt(ipAddress: string) {
  const parts = ipAddress.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${ipAddress}`)
  }
  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  )
}

export function intToIp(value: number) {
  const normalized = value >>> 0
  return [
    (normalized >>> 24) & 255,
    (normalized >>> 16) & 255,
    (normalized >>> 8) & 255,
    normalized & 255,
  ].join('.')
}

export function cidrBounds(cidr: string) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(0|[1-9]|[12]\d|3[0-2])$/.exec(cidr.trim())
  if (!match) {
    throw new Error(`Invalid CIDR block: ${cidr}`)
  }
  const networkAddress = match[1]
  const prefix = Number.parseInt(match[2], 10)
  const address = ipToInt(networkAddress)
  const mask =
    prefix === 0
      ? 0
      : prefix === 32
        ? 0xffffffff
        : (0xffffffff << (32 - prefix)) >>> 0
  const network = (address & mask) >>> 0
  const size = 2 ** (32 - prefix)
  return {
    network,
    broadcast: network + size - 1,
    prefix,
    size,
  }
}

export function canonicalizeIpv4Cidr(cidr: string) {
  const { network, prefix } = cidrBounds(cidr)
  return `${intToIp(network)}/${prefix}`
}

export function cidrOverlaps(left: string, right: string) {
  const leftBounds = cidrBounds(left)
  const rightBounds = cidrBounds(right)
  return (
    leftBounds.network <= rightBounds.broadcast &&
    rightBounds.network <= leftBounds.broadcast
  )
}

export function cidrContainsIp(cidr: string, ipAddress: string) {
  try {
    const { network, broadcast } = cidrBounds(cidr)
    const target = ipToInt(ipAddress)
    return target >= network && target <= broadcast
  } catch {
    return false
  }
}

export function cidrHostBounds(cidr: string) {
  const { network, broadcast, prefix } = cidrBounds(cidr)
  if (prefix >= 31) {
    return { firstHost: network, lastHost: broadcast }
  }
  return { firstHost: network + 1, lastHost: broadcast - 1 }
}

export function cidrContainsHostIp(cidr: string, ipAddress: string) {
  try {
    const { firstHost, lastHost } = cidrHostBounds(cidr)
    const target = ipToInt(ipAddress)
    return target >= firstHost && target <= lastHost
  } catch {
    return false
  }
}

export function ipv4MaskToPrefix(mask: string) {
  const bits = ipToInt(mask)
  if (bits === 0) return 0
  let prefix = 0
  let value = bits
  while (value & 0x80000000) {
    prefix += 1
    value = (value << 1) >>> 0
  }
  if (value !== 0) return null
  return prefix
}

export function networkAddress(ipAddress: string, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return intToIp(ipToInt(ipAddress) & mask)
}

export function buildIpv4Cidr(ipAddress: string, netmask: string) {
  const prefix = ipv4MaskToPrefix(netmask)
  if (prefix == null) return null
  const network = networkAddress(ipAddress, prefix)
  return `${network}/${prefix}`
}

export function oidSuffixToIpv4(oid: string, columnOid: string) {
  const normalized = oid.replace(/^\./, '')
  const prefix = columnOid.replace(/^\./, '')
  if (!normalized.startsWith(`${prefix}.`)) return null
  const suffix = normalized.slice(prefix.length + 1)
  const parts = suffix.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return null
  }
  return parts.join('.')
}
