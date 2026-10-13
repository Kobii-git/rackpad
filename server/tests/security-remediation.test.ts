import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startOidcTestProvider } from './helpers/oidc-provider.js'

const directory = mkdtempSync(path.join(os.tmpdir(), 'rackpad-security-'))
process.env.DATABASE_PATH = path.join(directory, 'test.db')
process.env.NODE_ENV = 'test'
process.env.RACKPAD_RATE_LIMIT_DISABLED = '1'
process.env.RACKPAD_SECRET_KEY = 'synthetic-security-test-key'
const { createApp } = await import('../app.js')
const { db } = await import('../db.js')
const { setBootstrapState } = await import('../lib/auth.js')
const { decryptSecret } = await import('../lib/secret-crypto.js')
const { handleTrapPacket } = await import('../lib/snmp-traps.js')
const { buildSnmpV2TrapPacket } = await import('../lib/snmp-trap-build.js')
const provider = await startOidcTestProvider()
let app: Awaited<ReturnType<typeof createApp>>
let adminToken: string
let sequence = 0

beforeEach(async () => {
  for (const key of Object.keys(process.env)) if (key.startsWith('OIDC_')) delete process.env[key]
  process.env.OIDC_ENABLED = '1'
  process.env.OIDC_ISSUER_URL = provider.issuer
  process.env.OIDC_CLIENT_ID = 'rackpad-test'
  process.env.TRUST_PROXY = '0'
  process.env.NODE_ENV = 'test'
  delete process.env.APP_URL
  delete process.env.PUBLIC_URL
  delete process.env.TRUSTED_HOSTS
  db.pragma('foreign_keys = OFF')
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schemaVersion'").all() as { name: string }[]) {
    db.exec(`DELETE FROM "${name}"`)
  }
  db.pragma('foreign_keys = ON')
  setBootstrapState(null)
  app = await createApp()
  const response = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'admin', password: 'synthetic-password-123' } })
  assert.equal(response.statusCode, 201)
  adminToken = response.json().token
  provider.setClaims({ sub: `subject-${++sequence}`, preferred_username: 'test-user', email: 'user@example.test', email_verified: true })
})
afterEach(async () => { await app.close() })
after(async () => { await provider.close(); db.close(); rmSync(directory, { recursive: true, force: true }) })
const admin = () => ({ authorization: `Bearer ${adminToken}` })
const cookieFrom = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';')[0]!
async function startLogin(cookie?: string) {
  const start = await app.inject({ method: 'GET', url: '/api/auth/oidc/start?returnTo=%2Flabs', headers: cookie ? { cookie } : {} })
  assert.equal(start.statusCode, 302, start.body)
  const authorization = await fetch(String(start.headers.location), { redirect: 'manual' })
  const callback = new URL(authorization.headers.get('location')!)
  return { cookie: cookieFrom(start), callback: callback.pathname + callback.search, start }
}
async function completeLogin(flow: Awaited<ReturnType<typeof startLogin>>) {
  const callback = await app.inject({ url: flow.callback, headers: { cookie: flow.cookie } })
  const session = new URL(String(callback.headers.location), 'http://localhost').searchParams.get('session')
  assert.ok(session, callback.headers.location)
  return app.inject({ method: 'POST', url: '/api/auth/oidc/session', headers: { cookie: flow.cookie }, payload: { session } })
}
async function createDevice(labId = 'lab_home') {
  const response = await app.inject({ method: 'POST', url: '/api/devices', headers: admin(), payload: { labId, hostname: `switch-${++sequence}`, deviceType: 'switch', managementIp: '10.0.0.50', status: 'unknown' } })
  assert.equal(response.statusCode, 201, response.body)
  return response.json() as { id: string }
}
async function createViewer(labId = 'lab_home') {
  const response = await app.inject({ method: 'POST', url: '/api/users', headers: admin(), payload: { username: `viewer-${++sequence}`, displayName: 'Viewer', password: 'synthetic-viewer-password', role: 'viewer', labAccess: [{ labId, role: 'viewer' }] } })
  assert.equal(response.statusCode, 201, response.body)
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: response.json().username, password: 'synthetic-viewer-password' } })
  assert.equal(login.statusCode, 200, login.body)
  return { authorization: `Bearer ${login.json().token}` }
}

test('encoded API routes retain authentication and role guards', async () => {
  const viewer = await createViewer()
  for (const url of ['/api/device-types', '/%61pi/device-types', '/a%70i/hardware-templates', '/%61pi/ports/templates', '/%61pi/storage/drive-bay-templates']) {
    assert.equal((await app.inject({ url })).statusCode, 401, url)
    const allowed = await app.inject({ url, headers: viewer })
    assert.equal(allowed.statusCode, 200, url)
    assert.equal(allowed.headers['cache-control'], 'no-store')
  }
  assert.equal((await app.inject({ url: '/%61pi/users', headers: viewer })).statusCode, 403)
  assert.equal((await app.inject({ url: '/%61pi/auth/status' })).statusCode, 200)
})

test('NetBox preview cannot disclose devices outside readable labs or broaden wildcard names', async () => {
  const other = await app.inject({ method: 'POST', url: '/api/labs', headers: admin(), payload: { name: 'Private' } })
  const hidden = await createDevice(other.json().id)
  db.prepare("UPDATE devices SET notes = 'netbox-device:cisco::c9300 | NetBox device type library import.' WHERE id = ?").run(hidden.id)
  const viewer = await createViewer()
  const yaml = 'manufacturer: Cisco\nmodel: C9300\nu_height: 1\ninterfaces:\n  - name: eth0\n    type: 1000base-t'
  for (const input of [yaml, yaml.replace('Cisco', '"%"').replace('C9300', '"%"'), yaml.replace('C9300', '"_"')]) {
    const response = await app.inject({ method: 'POST', url: '/api/imports/netbox-device-type/preview', headers: viewer, payload: { yaml: input } })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().existingDevice, null)
    assert.ok(!response.body.includes(hidden.id))
  }
  const response = await app.inject({ method: 'POST', url: '/api/imports/netbox-device-type/preview', headers: admin(), payload: { yaml } })
  assert.equal(response.json().existingDevice.id, hidden.id)
  for (const model of ['"%"', '"C930_"']) {
    const wildcard = await app.inject({ method: 'POST', url: '/api/imports/netbox-device-type/preview', headers: admin(), payload: { yaml: yaml.replace('C9300', model) } })
    assert.equal(wildcard.statusCode, 200, wildcard.body)
    assert.equal(wildcard.json().existingDevice, null, 'wildcards must stay literal even inside readable labs')
  }
})

test('OIDC authorization and completion are bound to the initiating browser and single-use', async () => {
  const flow = await startLogin()
  assert.match(String(flow.start.headers['set-cookie']), /HttpOnly; SameSite=Lax/)
  const mismatch = await app.inject({ url: flow.callback })
  assert.match(String(mismatch.headers.location), /error=/)
  const callback = await app.inject({ url: flow.callback, headers: { cookie: flow.cookie } })
  const session = new URL(String(callback.headers.location), 'http://localhost').searchParams.get('session')
  assert.ok(session)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM userSessions').get() as { n: number }).n, 1)
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/oidc/session', payload: { session } })).statusCode, 403)
  const complete = await app.inject({ method: 'POST', url: '/api/auth/oidc/session', headers: { cookie: flow.cookie }, payload: { session } })
  assert.equal(complete.statusCode, 200, complete.body)
  assert.match(String(complete.headers['set-cookie']), /Max-Age=0/)
  assert.equal(complete.json().returnTo, '/labs')
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/oidc/session', headers: { cookie: flow.cookie }, payload: { session } })).statusCode, 400)
  assert.match(String((await app.inject({ url: flow.callback, headers: { cookie: flow.cookie } })).headers.location), /error=/)
})

test('starting a replacement login invalidates the previous browser flow', async () => {
  const first = await startLogin()
  const second = await startLogin(first.cookie)
  assert.match(String((await app.inject({ url: first.callback, headers: { cookie: first.cookie } })).headers.location), /error=/)
  assert.equal((await completeLogin(second)).statusCode, 200)
})

test('OIDC email admission and email role aliases require a verified email', async () => {
  process.env.OIDC_ALLOWED_DOMAINS = 'trusted.example'
  process.env.OIDC_ADMIN_USERS = 'privileged@trusted.example'
  for (const email_verified of [false, undefined, 'true']) {
    provider.setClaims({ sub: `unverified-${++sequence}`, email: 'privileged@trusted.example', email_verified, preferred_username: 'privileged@trusted.example' })
    assert.equal((await completeLogin(await startLogin())).statusCode, 403)
  }
  delete process.env.OIDC_ALLOWED_DOMAINS
  for (const email_verified of [false, undefined, true]) {
    provider.setClaims({ sub: `role-${++sequence}`, email: 'privileged@trusted.example', email_verified, preferred_username: 'privileged@trusted.example' })
    const response = await completeLogin(await startLogin())
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().user.role, email_verified === true ? 'admin' : 'viewer')
  }
  delete process.env.OIDC_ADMIN_USERS
  process.env.OIDC_ADMIN_GROUPS = 'privileged@trusted.example'
  process.env.OIDC_ROLE_CLAIM = 'email'
  provider.setClaims({ sub: `group-${++sequence}`, email: 'privileged@trusted.example', email_verified: false })
  assert.equal((await completeLogin(await startLogin())).json().user.role, 'viewer')
})

test('OIDC subjects are case-sensitive and existing roles are recomputed only once', async () => {
  process.env.OIDC_ADMIN_USERS = 'AdminSubject'
  provider.setClaims({ sub: 'adminsubject', preferred_username: 'ADMINSUBJECT' })
  const response = await completeLogin(await startLogin())
  assert.equal(response.json().user.role, 'viewer')
  const id = response.json().user.id
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(id)
  db.prepare('UPDATE oidcIdentities SET roleRecheckRequired = 1 WHERE userId = ?').run(id)
  assert.equal((await completeLogin(await startLogin())).json().user.role, 'viewer')
  db.prepare("UPDATE users SET role = 'editor' WHERE id = ?").run(id)
  assert.equal((await completeLogin(await startLogin())).json().user.role, 'editor')
  const flow = await startLogin()
  const callback = await app.inject({ url: flow.callback, headers: { cookie: flow.cookie } })
  const session = new URL(String(callback.headers.location), 'http://localhost').searchParams.get('session')
  assert.ok(session)
  const before = db.prepare('SELECT COUNT(*) AS n FROM userSessions').get()
  db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(id)
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/oidc/session', headers: { cookie: flow.cookie }, payload: { session } })).statusCode, 403)
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS n FROM userSessions').get(), before)
})

test('canonical HTTPS callback sets a Secure cookie despite an untrusted HTTP peer', async () => {
  process.env.APP_URL = 'https://rackpad.example'
  const response = await app.inject({ url: '/api/auth/oidc/start', headers: { 'x-forwarded-proto': 'http', 'x-forwarded-host': 'attacker.example' } })
  assert.match(String(response.headers['set-cookie']), /; Secure/)
  assert.equal(new URL(String(response.headers.location)).searchParams.get('redirect_uri'), 'https://rackpad.example/api/auth/oidc/callback')
})

test('SNMP communities are encrypted, redacted, and write-only across partial updates', async () => {
  const device = await createDevice()
  const response = await app.inject({ method: 'POST', url: '/api/device-monitors', headers: admin(), payload: { deviceId: device.id, type: 'snmp', target: '10.0.0.50', snmpOid: '1.3.6.1.2.1.2.2.1.8.1', snmpCommunity: 'synthetic-community', enabled: false } })
  assert.equal(response.statusCode, 200, response.body)
  const monitor = response.json()
  assert.equal(monitor.snmpCommunity, null)
  assert.equal(monitor.hasSnmpCommunity, true)
  assert.ok(!response.body.includes('synthetic-community'))
  const stored = () => db.prepare('SELECT snmpCommunity, snmpCommunityEnc FROM deviceMonitors WHERE id = ?').get(monitor.id) as { snmpCommunity: null; snmpCommunityEnc: string | null }
  assert.equal(stored().snmpCommunity, null)
  assert.equal(decryptSecret(stored().snmpCommunityEnc!), 'synthetic-community')
  const before = stored().snmpCommunityEnc
  await app.inject({ method: 'PATCH', url: `/api/device-monitors/${monitor.id}`, headers: admin(), payload: { name: 'Renamed' } })
  assert.equal(stored().snmpCommunityEnc, before)
  const list = await app.inject({ url: `/api/device-monitors?deviceId=${device.id}`, headers: await createViewer() })
  assert.equal(list.statusCode, 200)
  assert.ok(!list.body.includes('synthetic-community') && !list.body.includes('enc:v1:'))
  await app.inject({ method: 'PATCH', url: `/api/device-monitors/${monitor.id}`, headers: admin(), payload: { snmpCommunity: null } })
  assert.equal(stored().snmpCommunityEnc, null)
})

test('untrusted traps cannot poison the next packet or expose communities', async () => {
  const device = await createDevice()
  const response = await app.inject({ method: 'POST', url: '/api/device-monitors', headers: admin(), payload: { deviceId: device.id, type: 'snmp', target: '10.0.0.50', snmpOid: '1.3.6.1.2.1.2.2.1.8.1', snmpIfIndex: 1, snmpCommunity: 'synthetic-valid', enabled: true } })
  assert.equal(response.statusCode, 200, response.body)
  const id = response.json().id
  db.prepare("UPDATE deviceMonitors SET lastResult = 'offline' WHERE id = ?").run(id)
  for (const ending of [3, 4]) await handleTrapPacket(buildSnmpV2TrapPacket({ community: 'synthetic-attacker', trapOid: `1.3.6.1.6.3.1.1.5.${ending}`, ifIndex: 1 }), '10.0.0.50')
  assert.equal((db.prepare('SELECT lastResult FROM deviceMonitors WHERE id = ?').get(id) as { lastResult: string }).lastResult, 'offline')
  const source = db.prepare('SELECT community, credentialId FROM snmpTrapSources WHERE sourceIp = ?').get('10.0.0.50')
  assert.deepEqual(source, { community: null, credentialId: null })
  const list = await app.inject({ url: '/api/snmp-traps/sources?labId=lab_home', headers: await createViewer() })
  assert.equal(list.statusCode, 200, list.body)
  assert.ok(!list.body.includes('synthetic-attacker'))
  await handleTrapPacket(buildSnmpV2TrapPacket({ community: 'synthetic-valid', trapOid: '1.3.6.1.6.3.1.1.5.4', ifIndex: 1 }), '10.0.0.50')
  assert.equal((db.prepare('SELECT lastResult FROM deviceMonitors WHERE id = ?').get(id) as { lastResult: string }).lastResult, 'online')
})

test('only explicit trusted proxies affect Host, HSTS, and fallback OIDC callback URLs', async () => {
  await app.close()
  process.env.TRUST_PROXY = '10.44.0.2'
  process.env.TRUSTED_HOSTS = 'rackpad.example'
  process.env.NODE_ENV = 'production'
  app = await createApp()
  const spoofed = { host: 'attacker.example', 'x-forwarded-host': 'rackpad.example', 'x-forwarded-proto': 'https' }
  const direct = await app.inject({ url: '/api/health', remoteAddress: '10.44.0.3', headers: spoofed })
  assert.equal(direct.statusCode, 400)
  assert.equal(direct.headers['strict-transport-security'], undefined)
  const proxied = await app.inject({ url: '/api/auth/oidc/start', remoteAddress: '10.44.0.2', headers: spoofed })
  assert.equal(proxied.statusCode, 302)
  assert.ok(proxied.headers['strict-transport-security'])
  assert.match(String(proxied.headers['set-cookie']), /; Secure/)
  assert.equal(new URL(String(proxied.headers.location)).searchParams.get('redirect_uri'), 'https://rackpad.example/api/auth/oidc/callback')
  const directLogin = await app.inject({ url: '/api/auth/oidc/start', remoteAddress: '10.44.0.3', headers: { ...spoofed, host: 'rackpad.example', 'x-forwarded-host': 'attacker.example' } })
  assert.equal(new URL(String(directLogin.headers.location)).searchParams.get('redirect_uri'), 'http://rackpad.example/api/auth/oidc/callback')
  assert.equal(directLogin.headers['strict-transport-security'], undefined)
})

test('OIDC expiry rejects both stale state and stale session completion', async () => {
  const now = Date.now
  const first = await startLogin()
  try {
    const future = now() + 601_000
    Date.now = () => future
    const response = await app.inject({ url: first.callback, headers: { cookie: first.cookie } })
    assert.match(String(response.headers.location), /expired/)
  } finally { Date.now = now }
  const second = await startLogin()
  const callback = await app.inject({ url: second.callback, headers: { cookie: second.cookie } })
  const session = new URL(String(callback.headers.location), 'http://localhost').searchParams.get('session')
  try {
    const future = now() + 121_000
    Date.now = () => future
    const response = await app.inject({ method: 'POST', url: '/api/auth/oidc/session', headers: { cookie: second.cookie }, payload: { session } })
    assert.equal(response.statusCode, 400)
    assert.match(response.body, /expired/)
  } finally { Date.now = now }
})

test('OIDC rejects custom email aliases but preserves independently asserted groups and exact subjects', async () => {
  process.env.OIDC_USERNAME_CLAIM = 'custom.username'
  process.env.OIDC_ADMIN_USERS = 'privileged@trusted.example'
  provider.setClaims({ sub: `custom-${++sequence}`, custom: { username: 'privileged@trusted.example' }, email: 'other@trusted.example', email_verified: true })
  assert.equal((await completeLogin(await startLogin())).json().user.role, 'viewer')
  delete process.env.OIDC_ADMIN_USERS
  process.env.OIDC_ROLE_CLAIM = 'email'
  process.env.OIDC_ADMIN_GROUPS = 'rackpad-admins'
  provider.setClaims({ sub: `group-${++sequence}`, email: 'unverified@example.test', email_verified: false, groups: ['rackpad-admins'] })
  assert.equal((await completeLogin(await startLogin())).json().user.role, 'admin')
  delete process.env.OIDC_ADMIN_GROUPS
  process.env.OIDC_ADMIN_USERS = 'ExactSubject'
  provider.setClaims({ sub: 'ExactSubject' })
  assert.equal((await completeLogin(await startLogin())).json().user.role, 'admin')
})

test('legacy restore normalizes SNMP secrets and OIDC roles atomically; current backups preserve encrypted fields', async () => {
  const device = await createDevice()
  const login = await completeLogin(await startLogin())
  assert.equal(login.statusCode, 200)
  const oidcId = login.json().user.id
  const monitor = await app.inject({ method: 'POST', url: '/api/device-monitors', headers: admin(), payload: { deviceId: device.id, type: 'snmp', target: '10.0.0.50', snmpOid: '1.3.6.1.2.1.2.2.1.8.1', snmpCommunity: 'synthetic-current-secret', enabled: false } })
  assert.equal(monitor.statusCode, 200)
  const credential = await app.inject({ method: 'POST', url: '/api/snmp-credentials', headers: admin(), payload: { labId: 'lab_home', name: 'Synthetic trap trust', version: '2c', community: 'synthetic-trap-secret' } })
  assert.equal(credential.statusCode, 201, credential.body)
  const credentialId = credential.json().id
  db.prepare('INSERT INTO snmpTrapSources (id, labId, deviceId, sourceIp, credentialId) VALUES (?, ?, ?, ?, ?)').run('explicit-source', 'lab_home', device.id, '10.0.0.50', credentialId)
  const backup = (await app.inject({ url: '/api/admin/export', headers: admin() })).json()
  const currentCiphertext = backup.data.deviceMonitors[0].snmpCommunityEnc
  assert.equal(backup.data.deviceMonitors[0].snmpCommunity, null)
  const legacy = structuredClone(backup)
  legacy.schemaVersion = 49
  delete legacy.data.deviceMonitors[0].snmpCommunityEnc
  legacy.data.deviceMonitors[0].snmpCommunity = 'synthetic-legacy-secret'
  legacy.data.snmpTrapSources = [{ id: 'legacy-source', labId: 'lab_home', deviceId: device.id, sourceIp: '10.0.0.50', community: 'synthetic-observed-secret', credentialId }]
  process.env.RACKPAD_SECRET_KEY = ''
  const denied = await app.inject({ method: 'POST', url: '/api/admin/restore', headers: admin(), payload: legacy })
  process.env.RACKPAD_SECRET_KEY = 'synthetic-security-test-key'
  assert.equal(denied.statusCode, 400, denied.body)
  assert.equal((db.prepare('SELECT snmpCommunityEnc FROM deviceMonitors').get() as { snmpCommunityEnc: string }).snmpCommunityEnc, currentCiphertext)
  assert.equal((await app.inject({ url: '/api/auth/me', headers: admin() })).statusCode, 200)
  const malformed = structuredClone(backup)
  malformed.data.deviceMonitors[0].snmpCommunityEnc = 'enc:v1:invalid'
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/restore', headers: admin(), payload: malformed })).statusCode, 400)
  const restored = await app.inject({ method: 'POST', url: '/api/admin/restore', headers: admin(), payload: legacy })
  assert.equal(restored.statusCode, 200, restored.body)
  const row = db.prepare('SELECT snmpCommunity, snmpCommunityEnc FROM deviceMonitors').get() as { snmpCommunity: null; snmpCommunityEnc: string }
  assert.equal(row.snmpCommunity, null)
  assert.equal(decryptSecret(row.snmpCommunityEnc), 'synthetic-legacy-secret')
  assert.deepEqual(db.prepare('SELECT roleRecheckRequired FROM oidcIdentities WHERE userId = ?').get(oidcId), { roleRecheckRequired: 1 })
  assert.deepEqual(db.prepare('SELECT community, credentialId FROM snmpTrapSources').get(), { community: null, credentialId: null })
  assert.equal((await app.inject({ url: '/api/auth/me', headers: admin() })).statusCode, 401)
  const local = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'synthetic-password-123' } })
  adminToken = local.json().token
  const current = await app.inject({ method: 'POST', url: '/api/admin/restore', headers: admin(), payload: backup })
  assert.equal(current.statusCode, 200, current.body)
  assert.equal((db.prepare('SELECT snmpCommunityEnc FROM deviceMonitors').get() as { snmpCommunityEnc: string }).snmpCommunityEnc, currentCiphertext)
  assert.deepEqual(db.prepare('SELECT roleRecheckRequired FROM oidcIdentities WHERE userId = ?').get(oidcId), { roleRecheckRequired: 0 })
  assert.deepEqual(db.prepare('SELECT community, credentialId FROM snmpTrapSources').get(), { community: null, credentialId })
})

test('interface imports retain credential references and reuse stored inline communities without disclosure', async () => {
  const { EventEmitter } = await import('node:events')
  const { setSnmpSocketFactoryForTests } = await import('../lib/snmp-transport.js')
  const { readTlv, decodeObjectIdentifier, berSequence, berTlv, berInteger, berObjectIdentifier } = await import('../lib/snmp.js')
  const device = await createDevice()
  const credentialResponse = await app.inject({ method: 'POST', url: '/api/snmp-credentials', headers: admin(), payload: { labId: 'lab_home', name: 'Synthetic IF-MIB', version: '2c', community: 'synthetic-interface-secret' } })
  assert.equal(credentialResponse.statusCode, 201, credentialResponse.body)
  const credentialId = credentialResponse.json().id
  const columns = new Set(['1.3.6.1.2.1.2.2.1.2', '1.3.6.1.2.1.2.2.1.8', '1.3.6.1.2.1.31.1.1.1.1', '1.3.6.1.2.1.31.1.1.1.18', '1.3.6.1.2.1.31.1.1.1.15'])
  const children = (buffer: Buffer) => {
    const result: ReturnType<typeof readTlv>[] = []
    for (let offset = 0; offset < buffer.length;) { const value = readTlv(buffer, offset); result.push(value); offset = value.nextOffset }
    return result
  }
  setSnmpSocketFactoryForTests(() => {
    const socket = new EventEmitter()
    return Object.assign(socket, {
      close: () => {},
      send: (packet: Buffer, _port: number, address: string) => {
        assert.equal(address, '10.0.0.50')
        const message = children(readTlv(packet, 0).value)
        assert.equal(message[1]!.value.toString(), 'synthetic-interface-secret')
        const pdu = children(message[2]!.value)
        const binding = children(readTlv(pdu[3]!.value, 0).value)
        const requestedOid = decodeObjectIdentifier(binding[0]!.value)
        const first = columns.has(requestedOid)
        const response = berSequence(Buffer.concat([
          berTlv(2, message[0]!.value), berTlv(4, message[1]!.value),
          berTlv(0xa2, Buffer.concat([berTlv(2, pdu[0]!.value), berInteger(0), berInteger(0),
            berSequence(berSequence(Buffer.concat([berObjectIdentifier(first ? `${requestedOid}.1` : requestedOid), first ? berInteger(1) : berTlv(0x82, Buffer.alloc(0))])))])),
        ]))
        queueMicrotask(() => socket.emit('message', response))
      },
    }) as unknown as import('node:dgram').Socket
  })
  try {
    const body = { deviceId: device.id, target: '10.0.0.50', snmpCredentialId: credentialId, skipExisting: false }
    const imported = await app.inject({ method: 'POST', url: '/api/device-monitors/snmp/import-interfaces', headers: admin(), payload: body })
    assert.equal(imported.statusCode, 200, imported.body)
    assert.equal(imported.json().createdCount, 1)
    assert.ok(!imported.body.includes('synthetic-interface-secret'))
    assert.deepEqual(db.prepare('SELECT snmpCommunity, snmpCommunityEnc, snmpCredentialId FROM deviceMonitors').get(), { snmpCommunity: null, snmpCommunityEnc: null, snmpCredentialId: credentialId })
    const inline = await app.inject({ method: 'POST', url: '/api/device-monitors', headers: admin(), payload: { deviceId: device.id, type: 'snmp', target: '10.0.0.50', snmpOid: '1.3.6.1.2.1.1.1.0', snmpCommunity: 'synthetic-interface-secret', enabled: false } })
    assert.equal(inline.statusCode, 200)
    const monitorId = inline.json().id
    const discovered = await app.inject({ method: 'POST', url: '/api/device-monitors/snmp/discover-interfaces', headers: admin(), payload: { deviceId: device.id, monitorId } })
    assert.equal(discovered.statusCode, 200, discovered.body)
    assert.equal(discovered.json().interfaces.length, 1)
    const other = await createDevice()
    const invalid = await app.inject({ method: 'POST', url: '/api/device-monitors/snmp/discover-interfaces', headers: admin(), payload: { deviceId: other.id, monitorId } })
    assert.equal(invalid.statusCode, 400)
    const forbidden = await app.inject({ method: 'POST', url: '/api/device-monitors/snmp/discover-interfaces', headers: await createViewer(), payload: { deviceId: device.id, monitorId } })
    assert.equal(forbidden.statusCode, 403)
  } finally { setSnmpSocketFactoryForTests(null) }
})
