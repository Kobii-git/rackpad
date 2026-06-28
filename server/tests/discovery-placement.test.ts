import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, test } from 'node:test'

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'rackpad-discovery-placement-'))
process.env.DATABASE_PATH = path.join(tempDir, 'rackpad-test.db')
process.env.NODE_ENV = 'test'
process.env.RACKPAD_SECRET_KEY = 'rackpad-test-secret-key'

const { db } = await import('../db.js')
const {
  applyWifiDiscoveryPlacementToDevice,
  cidrContainsIp,
  explainWifiClientPlacement,
  inferDiscoveryPlacement,
  resolveWifiClientPlacement,
  shouldSkipWifiAutoPlacement,
} = await import('../lib/discovery-placement.js')

after(() => {
  db.close()
  rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  db.exec(`
    DELETE FROM wifiClientAssociations;
    DELETE FROM wifiRadioSsids;
    DELETE FROM wifiRadios;
    DELETE FROM wifiAccessPoints;
    DELETE FROM wifiSsids;
    DELETE FROM wifiControllers;
    DELETE FROM portLinks;
    DELETE FROM ports;
    DELETE FROM ipAssignments;
    DELETE FROM discoveredDevices;
    DELETE FROM subnets;
    DELETE FROM vlans;
    DELETE FROM devices;
    DELETE FROM rooms;
    DELETE FROM labs;
  `)
  db.prepare(`
    INSERT INTO labs (id, name, description, location)
    VALUES ('lab_home', 'Home Lab', NULL, NULL)
  `).run()
})

function seedWifiVlanSubnet(input?: { secondAp?: boolean }) {
  db.prepare(`
    INSERT INTO vlans (id, labId, vlanId, name, description, color)
    VALUES ('vlan_wifi', 'lab_home', 30, 'WiFi VLAN', NULL, NULL)
  `).run()
  db.prepare(`
    INSERT INTO subnets (id, labId, cidr, name, description, vlanId)
    VALUES ('subnet_wifi', 'lab_home', '192.168.30.0/24', 'WiFi subnet', NULL, 'vlan_wifi')
  `).run()
  db.prepare(`
    INSERT INTO wifiSsids (id, labId, name, purpose, security, hidden, vlanId, color)
    VALUES ('ssid_guest', 'lab_home', 'Guest WiFi', NULL, NULL, 0, 'vlan_wifi', NULL)
  `).run()
  db.prepare(`
    INSERT INTO devices
      (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
       serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId, cpuCores, memoryGb, storageGb, specs,
       startU, heightU, face, tags, notes, lastSeen)
    VALUES ('ap_main', 'lab_home', NULL, 'ap-main', NULL, 'ap', NULL, NULL,
       NULL, '192.168.1.10', NULL, 'online', 'wireless', NULL, 'normal', NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL)
  `).run()
  db.prepare(`
    INSERT INTO wifiRadios (id, apDeviceId, slotName, band, channel, channelWidth, txPower, notes)
    VALUES ('radio_main', 'ap_main', 'radio0', '5GHz', '36', NULL, NULL, NULL)
  `).run()
  db.prepare(`
    INSERT INTO wifiRadioSsids (radioId, ssidId)
    VALUES ('radio_main', 'ssid_guest')
  `).run()

  if (input?.secondAp) {
    db.prepare(`
      INSERT INTO devices
        (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
         serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId, cpuCores, memoryGb, storageGb, specs,
         startU, heightU, face, tags, notes, lastSeen)
      VALUES ('ap_secondary', 'lab_home', NULL, 'ap-secondary', NULL, 'ap', NULL, NULL,
         NULL, '192.168.1.11', NULL, 'online', 'wireless', NULL, 'normal', NULL, NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL, NULL, NULL)
    `).run()
    db.prepare(`
      INSERT INTO wifiRadios (id, apDeviceId, slotName, band, channel, channelWidth, txPower, notes)
      VALUES ('radio_secondary', 'ap_secondary', 'radio0', '5GHz', '40', NULL, NULL, NULL)
    `).run()
    db.prepare(`
      INSERT INTO wifiRadioSsids (radioId, ssidId)
      VALUES ('radio_secondary', 'ssid_guest')
    `).run()
  }
}

test('cidrContainsIp matches subnet membership', () => {
  assert.equal(cidrContainsIp('192.168.30.0/24', '192.168.30.42'), true)
  assert.equal(cidrContainsIp('192.168.30.0/24', '192.168.31.1'), false)
  assert.equal(cidrContainsIp('192.168.30.42/24', '192.168.30.55'), true)
  assert.equal(cidrContainsIp('192.168.30.42/24', '192.168.31.1'), false)
})

test('resolveWifiClientPlacement picks the sole AP on a WiFi VLAN subnet', () => {
  seedWifiVlanSubnet()
  const resolved = resolveWifiClientPlacement({
    labId: 'lab_home',
    ipAddress: '192.168.30.55',
    deviceType: 'endpoint',
    hostname: 'phone-01',
  })
  assert.ok(resolved)
  assert.equal(resolved.apDeviceId, 'ap_main')
  assert.equal(resolved.ssidId, 'ssid_guest')
})

test('resolveWifiClientPlacement stays loose when multiple APs broadcast the SSID', () => {
  seedWifiVlanSubnet({ secondAp: true })
  const resolved = resolveWifiClientPlacement({
    labId: 'lab_home',
    ipAddress: '192.168.30.55',
    deviceType: 'endpoint',
  })
  assert.equal(resolved, null)
})

test('wired inventory and hostname heuristics skip WiFi auto placement', () => {
  seedWifiVlanSubnet()
  db.prepare(`
    INSERT INTO devices
      (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
       serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId, cpuCores, memoryGb, storageGb, specs,
       startU, heightU, face, tags, notes, lastSeen)
    VALUES ('pi_wired', 'lab_home', NULL, 'raspberry-pi', NULL, 'endpoint', NULL, NULL,
       NULL, '192.168.30.20', NULL, 'online', 'room', NULL, 'normal', NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL)
  `).run()

  assert.equal(
    resolveWifiClientPlacement({
      labId: 'lab_home',
      ipAddress: '192.168.30.20',
      deviceType: 'endpoint',
    }),
    null,
  )
  assert.equal(
    resolveWifiClientPlacement({
      labId: 'lab_home',
      ipAddress: '192.168.30.25',
      deviceType: 'endpoint',
      hostname: 'raspberry-pi',
    }),
    null,
  )
  assert.ok(
    resolveWifiClientPlacement({
      labId: 'lab_home',
      ipAddress: '192.168.30.21',
      deviceType: 'endpoint',
    }),
  )
  assert.equal(shouldSkipWifiAutoPlacement({ deviceType: 'server' }), true)
})

test('applyWifiDiscoveryPlacementToDevice updates device and association', () => {
  seedWifiVlanSubnet()
  db.prepare(`
    INSERT INTO devices
      (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
       serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId, cpuCores, memoryGb, storageGb, specs,
       startU, heightU, face, tags, notes, lastSeen)
    VALUES ('client_new', 'lab_home', NULL, 'guest-phone', NULL, 'endpoint', NULL, NULL,
       NULL, '192.168.30.88', NULL, 'online', 'room', NULL, 'normal', NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL)
  `).run()

  const applied = applyWifiDiscoveryPlacementToDevice({
    labId: 'lab_home',
    deviceId: 'client_new',
    ipAddress: '192.168.30.88',
    deviceType: 'endpoint',
    existingPlacement: 'room',
    existingParentDeviceId: null,
  })
  assert.equal(applied, true)

  const device = db
    .prepare('SELECT placement, parentDeviceId FROM devices WHERE id = ?')
    .get('client_new') as { placement: string; parentDeviceId: string }
  assert.equal(device.placement, 'wireless')
  assert.equal(device.parentDeviceId, 'ap_main')

  const association = db
    .prepare('SELECT apDeviceId, ssidId FROM wifiClientAssociations WHERE clientDeviceId = ?')
    .get('client_new') as { apDeviceId: string; ssidId: string }
  assert.equal(association.apDeviceId, 'ap_main')
  assert.equal(association.ssidId, 'ssid_guest')
})

test('applyWifiDiscoveryPlacementToDevice fills SSID when AP is already attached', () => {
  seedWifiVlanSubnet()
  db.prepare(`
    INSERT INTO devices
      (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model,
       serial, managementIp, macAddress, status, placement, parentDeviceId, networkMode, roomId, cpuCores, memoryGb, storageGb, specs,
       startU, heightU, face, tags, notes, lastSeen)
    VALUES ('client_attached', 'lab_home', NULL, 'ssid-phone', NULL, 'endpoint', NULL, NULL,
       NULL, '192.168.30.89', NULL, 'online', 'wireless', 'ap_main', 'normal', NULL, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, NULL, NULL)
  `).run()

  const applied = applyWifiDiscoveryPlacementToDevice({
    labId: 'lab_home',
    deviceId: 'client_attached',
    ipAddress: '192.168.30.89',
    deviceType: 'endpoint',
    existingPlacement: 'wireless',
    existingParentDeviceId: 'ap_main',
  })
  assert.equal(applied, true)

  const association = db
    .prepare('SELECT apDeviceId, ssidId FROM wifiClientAssociations WHERE clientDeviceId = ?')
    .get('client_attached') as { apDeviceId: string; ssidId: string }
  assert.equal(association.apDeviceId, 'ap_main')
  assert.equal(association.ssidId, 'ssid_guest')
})

test('explainWifiClientPlacement reports vlan match and multiple AP ambiguity', () => {
  seedWifiVlanSubnet()
  const match = explainWifiClientPlacement({
    labId: 'lab_home',
    ipAddress: '192.168.30.55',
    deviceType: 'endpoint',
  })
  assert.equal(match.placement, 'wireless')
  assert.equal(match.hint, 'wifi-vlan-match')
  assert.ok(match.resolved)
})

test('explainWifiClientPlacement leaves loose when multiple APs match', () => {
  seedWifiVlanSubnet({ secondAp: true })
  const ambiguous = explainWifiClientPlacement({
    labId: 'lab_home',
    ipAddress: '192.168.30.55',
    deviceType: 'endpoint',
  })
  assert.equal(ambiguous.placement, 'room')
  assert.equal(ambiguous.hint, 'loose-multiple-aps')
})

test('inferDiscoveryPlacement returns wireless for WiFi VLAN clients', () => {
  seedWifiVlanSubnet()
  assert.equal(
    inferDiscoveryPlacement({
      labId: 'lab_home',
      ipAddress: '192.168.30.70',
      deviceType: 'endpoint',
    }),
    'wireless',
  )
})
