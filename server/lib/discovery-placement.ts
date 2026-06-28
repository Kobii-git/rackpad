import { db } from '../db.js'
import { cidrContainsIp } from './ip-cidr.js'

const WIRED_DEVICE_TYPES = new Set([
  'switch',
  'router',
  'firewall',
  'server',
  'storage',
  'pdu',
  'ups',
  'patch_panel',
  'brush_panel',
  'blanking_panel',
  'kvm',
  'ap',
  'vm',
  'container',
  'rack_shelf',
])

const WIRED_HOSTNAME_PATTERN =
  /\b(pi|raspberry|esxi|proxmox|synology|qnap|nas|server|switch|router|firewall|unifi|ubnt|pfsense|opnsense|hyperv|vmhost|docker|k8s|kube)\b/i

export interface WifiClientPlacementResult {
  apDeviceId: string
  ssidId: string
  roomId: string | null
}

export { cidrContainsIp }


export function shouldSkipWifiAutoPlacement(input: {
  deviceType: string
  hostname?: string | null
  displayName?: string | null
  macAddress?: string | null
}) {
  if (WIRED_DEVICE_TYPES.has(input.deviceType)) return true
  const label = `${input.hostname ?? ''} ${input.displayName ?? ''}`.trim()
  if (label && WIRED_HOSTNAME_PATTERN.test(label)) return true
  return false
}

export function deviceExistsAtIp(labId: string, ipAddress: string, excludeDeviceId?: string) {
  const row = db
    .prepare(`
      SELECT id
      FROM devices
      WHERE labId = ? AND managementIp = ?
      LIMIT 1
    `)
    .get(labId, ipAddress) as { id: string } | undefined
  if (!row) return false
  if (excludeDeviceId && row.id === excludeDeviceId) return false
  return true
}

export function deviceHasDocumentedPorts(deviceId: string) {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM ports p
      LEFT JOIN portLinks pl ON pl.fromPortId = p.id OR pl.toPortId = p.id
      WHERE p.deviceId = ? AND pl.id IS NOT NULL
    `)
    .get(deviceId) as { count: number }
  return Number(row.count) > 0
}

export type WifiPlacementHint =
  | 'wifi-vlan-match'
  | 'loose-multiple-aps'
  | 'loose-no-wifi-vlan'
  | 'loose-wired-device-type'
  | 'loose-wired-hostname'
  | 'loose-existing-inventory'
  | 'loose-documented-ports'
  | null

export interface WifiPlacementExplanation {
  placement: 'wireless' | 'room'
  hint: WifiPlacementHint
  resolved: WifiClientPlacementResult | null
}

export function explainWifiClientPlacement(input: {
  labId: string
  ipAddress: string
  deviceType: string
  hostname?: string | null
  displayName?: string | null
  macAddress?: string | null
  excludeDeviceId?: string
}): WifiPlacementExplanation {
  if (shouldSkipWifiAutoPlacement(input)) {
    if (WIRED_DEVICE_TYPES.has(input.deviceType)) {
      return { placement: 'room', hint: 'loose-wired-device-type', resolved: null }
    }
    return { placement: 'room', hint: 'loose-wired-hostname', resolved: null }
  }
  if (deviceExistsAtIp(input.labId, input.ipAddress, input.excludeDeviceId)) {
    return { placement: 'room', hint: 'loose-existing-inventory', resolved: null }
  }

  const subnets = db
    .prepare('SELECT id, cidr, vlanId FROM subnets WHERE labId = ?')
    .all(input.labId) as Array<{ id: string; cidr: string; vlanId: string | null }>
  const match = subnets.find((entry) => cidrContainsIp(entry.cidr, input.ipAddress))
  if (!match?.vlanId) {
    return { placement: 'room', hint: 'loose-no-wifi-vlan', resolved: null }
  }

  const ssids = db
    .prepare(`
      SELECT id, name
      FROM wifiSsids
      WHERE labId = ? AND vlanId = ?
      ORDER BY name COLLATE NOCASE, id
    `)
    .all(input.labId, match.vlanId) as Array<{ id: string; name: string }>
  if (ssids.length === 0) {
    return { placement: 'room', hint: 'loose-no-wifi-vlan', resolved: null }
  }

  const apIds = new Set<string>()
  const ssidByAp = new Map<string, string>()

  for (const ssid of ssids) {
    const apRows = db
      .prepare(`
        SELECT DISTINCT r.apDeviceId AS apDeviceId
        FROM wifiRadioSsids rs
        JOIN wifiRadios r ON r.id = rs.radioId
        JOIN devices d ON d.id = r.apDeviceId
        WHERE rs.ssidId = ? AND d.labId = ?
      `)
      .all(ssid.id, input.labId) as Array<{ apDeviceId: string }>

    for (const apRow of apRows) {
      apIds.add(apRow.apDeviceId)
      if (!ssidByAp.has(apRow.apDeviceId)) {
        ssidByAp.set(apRow.apDeviceId, ssid.id)
      }
    }
  }

  if (apIds.size !== 1) {
    return { placement: 'room', hint: 'loose-multiple-aps', resolved: null }
  }

  const apDeviceId = [...apIds][0]!
  const ssidId = ssidByAp.get(apDeviceId)
  if (!ssidId) {
    return { placement: 'room', hint: 'loose-no-wifi-vlan', resolved: null }
  }

  const apDevice = db
    .prepare('SELECT roomId FROM devices WHERE id = ? AND labId = ?')
    .get(apDeviceId, input.labId) as { roomId: string | null } | undefined
  if (!apDevice) {
    return { placement: 'room', hint: 'loose-multiple-aps', resolved: null }
  }

  return {
    placement: 'wireless',
    hint: 'wifi-vlan-match',
    resolved: {
      apDeviceId,
      ssidId,
      roomId: apDevice.roomId ?? null,
    },
  }
}

export function resolveWifiClientPlacement(input: {
  labId: string
  ipAddress: string
  deviceType: string
  hostname?: string | null
  displayName?: string | null
  macAddress?: string | null
  excludeDeviceId?: string
}): WifiClientPlacementResult | null {
  return explainWifiClientPlacement(input).resolved
}

export function upsertWifiClientAssociation(input: {
  clientDeviceId: string
  apDeviceId: string
  ssidId?: string | null
  lastSeen?: string | null
}) {
  db.prepare(`
    INSERT INTO wifiClientAssociations
      (clientDeviceId, apDeviceId, radioId, ssidId, band, channel, signalDbm, lastSeen, lastRoamAt, notes)
    VALUES (?, ?, NULL, ?, NULL, NULL, NULL, ?, NULL, NULL)
    ON CONFLICT(clientDeviceId) DO UPDATE SET
      apDeviceId = excluded.apDeviceId,
      ssidId = excluded.ssidId,
      lastSeen = COALESCE(excluded.lastSeen, wifiClientAssociations.lastSeen)
  `).run(
    input.clientDeviceId,
    input.apDeviceId,
    input.ssidId ?? null,
    input.lastSeen ?? new Date().toISOString(),
  )
}

export function applyWifiDiscoveryPlacementToDevice(input: {
  labId: string
  deviceId: string
  ipAddress: string
  deviceType: string
  hostname?: string | null
  displayName?: string | null
  macAddress?: string | null
  existingPlacement?: string | null
  existingParentDeviceId?: string | null
  lastSeen?: string | null
}) {
  if (
    input.existingPlacement &&
    input.existingPlacement !== 'room' &&
    input.existingPlacement !== 'wireless'
  ) {
    return false
  }
  if (deviceHasDocumentedPorts(input.deviceId)) return false

  const resolved = resolveWifiClientPlacement({
    labId: input.labId,
    ipAddress: input.ipAddress,
    deviceType: input.deviceType,
    hostname: input.hostname,
    displayName: input.displayName,
    macAddress: input.macAddress,
    excludeDeviceId: input.deviceId,
  })
  if (!resolved) return false
  if (
    input.existingParentDeviceId &&
    input.existingParentDeviceId !== resolved.apDeviceId
  ) {
    return false
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE devices
      SET placement = 'wireless', parentDeviceId = ?, roomId = ?
      WHERE id = ? AND labId = ?
    `).run(resolved.apDeviceId, resolved.roomId, input.deviceId, input.labId)
    upsertWifiClientAssociation({
      clientDeviceId: input.deviceId,
      apDeviceId: resolved.apDeviceId,
      ssidId: resolved.ssidId,
      lastSeen: input.lastSeen,
    })
  })()

  return true
}

export function inferDiscoveryPlacement(input: {
  labId: string
  ipAddress: string
  deviceType: string
  hostname?: string | null
  displayName?: string | null
  macAddress?: string | null
}) {
  if (input.deviceType === 'ap') return 'wireless' as const
  if (input.deviceType === 'vm' || input.deviceType === 'container') {
    return 'virtual' as const
  }
  return explainWifiClientPlacement(input).placement
}

export function inferDiscoveryPlacementHint(input: {
  labId: string
  ipAddress: string
  deviceType: string
  hostname?: string | null
  displayName?: string | null
  macAddress?: string | null
}): WifiPlacementHint {
  if (input.deviceType === 'ap' || input.deviceType === 'vm' || input.deviceType === 'container') {
    return null
  }
  return explainWifiClientPlacement(input).hint
}
