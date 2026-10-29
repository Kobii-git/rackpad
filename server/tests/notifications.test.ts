import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, test } from 'node:test'

const directory = mkdtempSync(path.join(os.tmpdir(), 'rackpad-notifications-'))
process.env.DATABASE_PATH = path.join(directory, 'fixture.db')
process.env.NODE_ENV = 'test'
process.env.RACKPAD_SECRET_KEY = 'synthetic-notification-key'
const { db } = await import('../db.js')
const { saveAlertSettings, loadAlertSettings, DEFAULT_ALERT_SETTINGS, sendTestAlert, sendMonitorTransitionAlert, invalidateNotificationAttempts } = await import('../lib/alerts.js')
const { recordMonitorResult, runMonitorCheck } = await import('../lib/monitoring.js')
const { setNetworkHostLookupForTests, setPinnedRequestTransportForTests } = await import('../lib/net-guard.js')
const { getJsonSetting, putJsonSetting } = await import('../lib/app-settings.js')
const { validateRackpadSqliteDatabase } = await import('../lib/native-backup-validation.js')
const { parsePendingAlertState } = await import('../lib/notification-state.js')
let calls: Array<{ host: string; body?: string; authorization?: string }> = []
let fail = false
const start = Date.parse('2026-10-23T12:00:00.000Z')

db.prepare("INSERT INTO labs(id,name) VALUES('lab','Fixture')").run()
db.prepare("INSERT INTO devices(id,labId,hostname,deviceType) VALUES('device','lab','fixture','server')").run()
beforeEach(() => {
  invalidateNotificationAttempts()
  process.env.RACKPAD_SECRET_KEY = 'synthetic-notification-key'
  saveAlertSettings({ ...DEFAULT_ALERT_SETTINGS, ntfyToken: null })
  db.prepare('DELETE FROM deviceMonitors').run()
  db.prepare("INSERT INTO deviceMonitors(id,deviceId,type,target,enabled,intervalMs) VALUES('monitor','device','http','10.20.30.40',1,120000)").run()
  db.prepare('DELETE FROM auditLog').run()
  calls = []; fail = false
  setNetworkHostLookupForTests(async () => [{ address: '10.20.30.40', family: 4 }])
  setPinnedRequestTransportForTests(async (url, _resolved, options) => {
    calls.push({ host: url.hostname, body: options.body, authorization: options.headers.Authorization })
    return { statusCode: fail || url.hostname === 'failed.example.test' ? 503 : 200 }
  })
})
after(() => {
  setNetworkHostLookupForTests(null); setPinnedRequestTransportForTests(null)
  db.close(); rmSync(directory, { recursive: true, force: true })
})

function state() { return db.prepare("SELECT * FROM deviceMonitors WHERE id='monitor'").get() as Record<string, unknown> }
async function observe(result: 'offline' | 'online' | 'unknown', elapsed = 0) {
  const previous = state()
  const checkedAt = new Date(start + elapsed).toISOString()
  db.prepare("UPDATE deviceMonitors SET lastResult=?,lastCheckAt=? WHERE id='monitor'").run(result, checkedAt)
  return sendMonitorTransitionAlert(previous.lastResult as string | null, previous.lastAlertAt as string | null,
    { monitorId: 'monitor', deviceId: 'device', hostname: 'fixture', monitorType: 'http', result, message: 'fixture', checkedAt })
}

test('total failure retains an event, throttles retries and advances lastAlertAt only on success', async () => {
  saveAlertSettings({ enabled: true, discordWebhookUrl: 'https://notify.example.test/fixture' })
  await observe('offline')
  const successfulAt = state().lastAlertAt
  await observe('online', 1000)
  fail = true
  await observe('offline', 2000)
  assert.equal(state().lastAlertAt, new Date(start + 1000).toISOString())
  assert.notEqual(state().lastAlertAt, successfulAt)
  assert.equal(state().pendingAlertKind, 'down')
  const count = calls.length
  await observe('offline', 62000)
  assert.equal(calls.length, count, 'configured 120-second interval throttles even manual checks')
  fail = false
  await observe('offline', 122000)
  assert.equal(calls.length, count + 1)
  assert.equal(state().pendingAlertKind, null)
  assert.equal(state().lastAlertAt, new Date(start + 122000).toISOString())
})

test('partial success reports every channel and does not retry successful events', async () => {
  saveAlertSettings({ enabled: true, discordWebhookUrl: 'https://failed.example.test/fixture', ntfyTopicUrl: 'https://ntfy.example.test/topic' })
  const result = await observe('offline')
  assert.deepEqual(result, { delivered: true, channels: [
    { channel: 'discord', delivered: false, code: 'notification_delivery' }, { channel: 'ntfy', delivered: true },
  ] })
  assert.equal(state().pendingAlertKind, null)
  await observe('offline', 180000)
  assert.equal(calls.length, 2)
  assert.match(String((db.prepare("SELECT summary FROM auditLog WHERE action='alert.down'").get() as { summary: string })?.summary), /some channels failed/)
})

test('unknown postpones pending delivery; recovery supersedes outage; disabled categories clear it', async () => {
  saveAlertSettings({ enabled: true, discordWebhookUrl: 'https://notify.example.test/fixture' })
  fail = true
  await observe('offline')
  await observe('unknown', 180000)
  assert.equal(calls.length, 1)
  assert.equal(state().pendingAlertKind, 'down')
  await observe('online', 181000)
  assert.equal(state().pendingAlertKind, 'recovery')
  fail = false
  await observe('online', 301000)
  assert.equal(state().pendingAlertKind, null)
  fail = true
  await observe('offline', 302000)
  saveAlertSettings({ notifyOnDown: false })
  assert.equal(state().pendingAlertKind, null)
  await observe('offline', 600000)
  assert.equal(calls.length, 4)
})

test('repeat events retain their identity across failure and retry', async () => {
  saveAlertSettings({ enabled: true, repeatWhileOffline: true, repeatIntervalMinutes: 1, discordWebhookUrl: 'https://notify.example.test/fixture' })
  await observe('offline')
  fail = true
  await observe('offline', 60000)
  assert.equal(state().pendingAlertKind, 'repeat')
  fail = false
  await observe('offline', 180000)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM auditLog WHERE action='alert.repeat'").get() as { n: number })?.n, 1)
})

test('overlapping delivery does not duplicate attempts or let stale success clear recovery', async () => {
  saveAlertSettings({ enabled: true, ntfyTopicUrl: 'https://ntfy.example.test/topic' })
  let release!: () => void
  setPinnedRequestTransportForTests(async () => { calls.push({ host: 'fixture' }); await new Promise<void>(resolve => { release = resolve }); return { statusCode: 200 } })
  const outage = observe('offline')
  await new Promise(resolve => setImmediate(resolve))
  await observe('offline', 1000)
  await observe('online', 2000)
  assert.equal(calls.length, 1)
  release(); await outage
  assert.equal(state().pendingAlertKind, 'recovery')
  assert.equal(state().lastAlertAt, null)
  setPinnedRequestTransportForTests(async () => ({ statusCode: 200 }))
  await observe('online', 3000)
  assert.equal(state().pendingAlertKind, null)
})

test('probe generations reject older completions even in the same millisecond', async context => {
  const fixed = new Date('2026-10-23T14:00:00.000Z')
  context.mock.timers.enable({ apis: ['Date'], now: fixed })
  const pending: Array<(value: { statusCode: number }) => void> = []
  setPinnedRequestTransportForTests(() => new Promise(resolve => pending.push(resolve)))
  const first = runMonitorCheck('monitor')
  const second = runMonitorCheck('monitor')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 2)
  pending[1]({ statusCode: 200 }); await second
  pending[0]({ statusCode: 503 }); await first
  assert.equal(state().lastResult, 'online')
  const third = runMonitorCheck('monitor')
  await new Promise(resolve => setImmediate(resolve))
  await recordMonitorResult('monitor', { result: 'offline', message: 'new observation' })
  pending[2]({ statusCode: 200 }); await third
  assert.equal(state().lastResult, 'offline')
})

test('ntfy encrypts a write-only token, preserves omission and safely bounds UTF-8', async () => {
  const token = 'synthetic-private-token'
  const saved = saveAlertSettings({ enabled: true, ntfyTopicUrl: 'https://ntfy.example.test/topic', ntfyToken: token })
  assert.equal(saved.ntfyTokenConfigured, true)
  assert.doesNotMatch(JSON.stringify(saved), new RegExp(token))
  const stored = db.prepare("SELECT value FROM appSettings WHERE key='alertSettings'").get() as { value: string }
  assert.doesNotMatch(stored.value, new RegExp(token))
  saveAlertSettings({ ntfyTopicUrl: undefined })
  assert.equal(loadAlertSettings().ntfyTopicUrl, saved.ntfyTopicUrl)
  await sendTestAlert()
  assert.equal(calls[0].authorization, `Bearer ${token}`)
  const { sendNtfyAlert } = await import('../lib/ntfy.js')
  await sendNtfyAlert(saved.ntfyTopicUrl!, null, 'a'.repeat(4095) + '😀')
  assert.equal(Buffer.byteLength(calls[1].body!), 4095)
  assert.ok(!calls[1].body!.includes('\uFFFD'))
  for (const topic of ['https://user:pass@example.test/topic', 'https://example.test/topic?secret=x', 'https://example.test/topic#x', 'file:///topic', 'https://example.test/'])
    assert.throws(() => saveAlertSettings({ ntfyTopicUrl: topic }), /ntfy/)
  assert.throws(() => saveAlertSettings({ ntfyTopicUrl: 'http://ntfy.example.test/topic' }), /HTTPS/)
  assert.throws(() => saveAlertSettings({ ntfyToken: '' }), /Invalid/)
  delete process.env.RACKPAD_SECRET_KEY
  await assert.rejects(sendTestAlert(), error => error instanceof Error && !JSON.stringify(error).includes(token) && /encryption key/.test(error.message))
  saveAlertSettings({ discordWebhookUrl: 'https://notify.example.test/fixture' })
  assert.deepEqual(await sendTestAlert(), { delivered: true, channels: [
    { channel: 'discord', delivered: true }, { channel: 'ntfy', delivered: false, code: 'ntfy_configuration' },
  ] })
  saveAlertSettings({ ntfyToken: null })
  assert.equal(loadAlertSettings().ntfyTokenConfigured, false)
})

test('ntfy failures are classified without leaking target, token or response data', async () => {
  saveAlertSettings({ enabled: true, ntfyTopicUrl: 'https://ntfy.example.test/private-topic', ntfyToken: 'synthetic-private-token' })
  for (const [statusCode, expected] of [[401, 'ntfy_rejection'], [429, 'ntfy_rate_limit'], [503, 'ntfy_rejection']] as const) {
    setPinnedRequestTransportForTests(async () => ({ statusCode, bodyText: 'synthetic-private-response' }))
    await assert.rejects(sendTestAlert(), error => (error as { code: string }).code === expected && !JSON.stringify(error).includes('private'))
  }
  setPinnedRequestTransportForTests(async () => ({ statusCode: 302, location: 'https://other.example.test/private' }))
  await assert.rejects(sendTestAlert(), { code: 'ntfy_connection' })
  setPinnedRequestTransportForTests(async () => { throw new Error('timeout private-topic') })
  await assert.rejects(sendTestAlert(), { code: 'ntfy_timeout' })
  setNetworkHostLookupForTests(async () => [{ address: '127.0.0.1', family: 4 }])
  await assert.rejects(sendTestAlert(), { code: 'ntfy_connection' })
  const settings = getJsonSetting<Record<string, unknown>>('alertSettings', {})
  putJsonSetting('alertSettings', { ...settings, ntfyTokenEnc: 'enc:v1:corrupt' })
  await assert.rejects(sendTestAlert(), { code: 'ntfy_configuration' })
  assert.doesNotMatch(JSON.stringify(db.prepare('SELECT summary FROM auditLog').all()), /private-topic|synthetic-private/)
})

test('pending state validation rejects malformed kinds, timestamps and pairs', () => {
  const at = new Date(start).toISOString()
  for (const bad of [{ pendingAlertKind: ['down'], pendingAlertAt: at }, { pendingAlertKind: 'down' },
    { pendingAlertKind: null, pendingAlertAt: at }, { pendingAlertKind: 'down', pendingAlertAt: 'not-a-date' },
    { pendingAlertKind: 'down', pendingAlertAt: at, lastAlertAttemptAt: new Date(start - 1).toISOString() }])
    assert.throws(() => parsePendingAlertState(bad), /Invalid pending/)
  assert.equal(validateRackpadSqliteDatabase(db, 'Fixture'), 57)
})

test('notification settings and category cancellation commit atomically', async context => {
  saveAlertSettings({enabled:true,discordWebhookUrl:'https://notify.example.test/fixture'})
  fail=true;await observe('offline')
  db.exec("CREATE TRIGGER notification_fixture_failure BEFORE UPDATE ON deviceMonitors BEGIN SELECT RAISE(ABORT,'fixture cancellation failure'); END")
  context.after(()=>db.exec('DROP TRIGGER notification_fixture_failure'))
  assert.throws(()=>saveAlertSettings({enabled:false}), /fixture cancellation failure/)
  assert.equal(loadAlertSettings().enabled,true)
  assert.equal(state().pendingAlertKind,'down')
})

test('logical restore preserves pending events, redacts ntfy only, and rejects invalid state atomically', async context => {
  const { createApp } = await import('../app.js')
  const app = await createApp(); context.after(() => app.close())
  const password = 'synthetic-administrator-password'
  const auth = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'admin', password, displayName: 'Admin', loadDemoData: false } })
  assert.equal(auth.statusCode, 201)
  let headers = { authorization: `Bearer ${auth.json().token}` }
  saveAlertSettings({ enabled: true, ntfyTopicUrl: 'https://ntfy.example.test/topic', ntfyToken: 'synthetic-private-token' })
  const update = await app.inject({ method: 'PUT', url: '/api/admin/alert-settings', headers, payload: { enabled: true } })
  assert.equal(update.statusCode, 200, update.body)
  assert.equal(update.json().ntfyTokenConfigured, true)
  assert.equal(update.json().ntfyTopicUrl, 'https://ntfy.example.test/topic')
  fail = true; await observe('offline')
  const pending = parsePendingAlertState(state())
  const backup = (await app.inject({ url: '/api/admin/export', headers })).json()
  const setting = backup.data.appSettings.find((row: { key: string }) => row.key === 'alertSettings')
  assert.equal(JSON.parse(setting.value).ntfyTokenEnc, null)
  const restore = async (value: Record<string, unknown>) => {
    const result = await app.inject({ method: 'POST', url: '/api/admin/restore', headers, payload: value })
    if (result.statusCode === 200) {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password } })
      headers = { authorization: `Bearer ${login.json().token}` }
    }
    return result
  }
  const before = state()
  let finishProbe!: (value: { statusCode: number }) => void
  setPinnedRequestTransportForTests(() => new Promise(resolve => { finishProbe = resolve }))
  const oldProbe = runMonitorCheck('monitor')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await restore(backup)).statusCode, 200)
  finishProbe({ statusCode: 503 }); await oldProbe
  assert.deepEqual(state(), before, 'probe started before restore cannot overwrite the restored observation')
  for (const invalid of [['down'], 'bad']) {
    const broken = structuredClone(backup)
    broken.data.deviceMonitors[0].pendingAlertKind = invalid
    assert.equal((await restore(broken)).statusCode, 400)
    assert.deepEqual(state(), before)
  }
  const legacyCredentials = JSON.parse(setting.value)
  legacyCredentials.smtpPassword = 'synthetic-legacy-smtp-password'
  legacyCredentials.ntfyTokenEnc = 'enc:v1:untrusted'
  setting.value = JSON.stringify(legacyCredentials)
  assert.equal((await restore(backup)).statusCode, 200)
  assert.deepEqual(parsePendingAlertState(state()), pending)
  assert.equal(loadAlertSettings().ntfyTokenConfigured, false)
  assert.equal(loadAlertSettings().smtpPassword, 'synthetic-legacy-smtp-password')
  for (const row of backup.data.deviceMonitors) {
    delete row.pendingAlertKind; delete row.pendingAlertAt; delete row.lastAlertAttemptAt
  }
  backup.schemaVersion = 56
  assert.equal((await restore(backup)).statusCode, 200)
  assert.deepEqual(parsePendingAlertState(state()), { pendingAlertKind: null, pendingAlertAt: null, lastAlertAttemptAt: null })
})
