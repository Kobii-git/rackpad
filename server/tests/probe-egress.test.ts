import assert from 'node:assert/strict'
import { after, afterEach, test, mock } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import type dgram from 'node:dgram'
import type { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

const directory = mkdtempSync(path.join(os.tmpdir(), 'rackpad-egress-'))
process.env.DATABASE_PATH = path.join(directory, 'test.db')
process.env.NODE_ENV = 'test'
const { db } = await import('../db.js')
const { runMonitorCheck, runIcmpProbe, setProbeTransportsForTests } = await import('../lib/monitoring.js')
const { snmpGet, snmpGetNext } = await import('../lib/snmp.js')
const { snmpV3Request } = await import('../lib/snmp-v3.js')
const { resolveRoutableHost, setNetworkHostLookupForTests } = await import('../lib/net-guard.js')
const { setSnmpSocketFactoryForTests } = await import('../lib/snmp-transport.js')
db.exec("INSERT INTO labs (id, name) VALUES ('lab', 'Test'); INSERT INTO devices (id, labId, hostname, deviceType) VALUES ('device', 'lab', 'test', 'server')")
let sequence = 0
const v2 = (host: string) => ({ host, port: 161, version: '2c' as const, community: 'synthetic', timeoutMs: 1000 })
const v3 = (host: string) => ({ host, port: 161, version: '3' as const, user: 'synthetic', authProtocol: 'SHA' as const, authPassword: 'synthetic-password', privProtocol: 'none' as const, privPassword: '', timeoutMs: 1000 })
const oid = '1.3.6.1.2.1.1.1.0'
async function tcp(host: string) {
  const id = `monitor-${++sequence}`
  db.prepare("INSERT INTO deviceMonitors (id, deviceId, type, target, port, enabled) VALUES (?, 'device', 'tcp', ?, 443, 1)").run(id, host)
  return runMonitorCheck(id)
}
afterEach(() => { setProbeTransportsForTests(null); setSnmpSocketFactoryForTests(null); setNetworkHostLookupForTests(null); mock.timers.reset() })
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })

test('TCP, ICMP and every SNMP entry point reject dangerous literal and mixed DNS destinations before transport', async () => {
  let opened = 0
  const forbidden = () => { opened++; throw new Error('Transport must not open') }
  setProbeTransportsForTests({ connect: forbidden as typeof net.connect, spawn: forbidden as typeof spawn })
  setSnmpSocketFactoryForTests(forbidden)
  const targets = ['127.0.0.1', '169.254.169.254', '224.0.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', 'fe80::1', 'ff02::1']
  for (const host of targets) {
    assert.match((await tcp(host))!.lastMessage!, /reserved ranges/)
    await assert.rejects(runIcmpProbe(host), /reserved ranges/)
    await assert.rejects(snmpGet(v2(host), oid), /reserved ranges/)
    await assert.rejects(snmpGetNext(v2(host), oid), /reserved ranges/)
    await assert.rejects(snmpV3Request(v3(host), oid, 'get'), /reserved ranges/)
  }
  setNetworkHostLookupForTests(async () => [{ address: '10.10.0.5', family: 4 }, { address: '::1', family: 6 }])
  assert.match((await tcp('mixed.example'))!.lastMessage!, /reserved ranges/)
  await assert.rejects(runIcmpProbe('mixed.example'), /reserved ranges/)
  await assert.rejects(snmpGet(v2('mixed.example'), oid), /reserved ranges/)
  await assert.rejects(snmpV3Request(v3('mixed.example'), oid, 'getNext'), /reserved ranges/)
  assert.equal(opened, 0)
})

test('TCP and ICMP pin allowed DNS results, including IPv6 LAN destinations', async () => {
  for (const [address, family] of [['10.10.0.5', 4], ['fd00::5', 6]] as const) {
    let lookups = 0
    setNetworkHostLookupForTests(async () => { lookups++; return [{ address, family }] })
    let connectedSocket: net.Socket | undefined
    setProbeTransportsForTests({
      connect: ((options: net.NetConnectOpts) => {
        assert.equal((options as net.TcpNetConnectOpts).host, address)
        const socket = new net.Socket()
        connectedSocket = socket
        queueMicrotask(() => socket.emit('connect'))
        return socket
      }) as typeof net.connect,
      spawn: ((_command: string, args: string[]) => {
        assert.equal(args.at(-1), address)
        const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true })
        queueMicrotask(() => child.emit('close', 0))
        return child
      }) as unknown as typeof spawn,
    })
    assert.equal((await tcp('allowed.example'))!.lastResult, 'online')
    assert.equal(connectedSocket?.destroyed, true)
    assert.equal((await runIcmpProbe('allowed.example')).result, 'online')
    assert.equal(lookups, 2)
  }
})

test('SNMP v1/v2 and v3 discovery use pinned addresses and close failed sockets', async () => {
  for (const [address, family] of [['10.10.0.5', 4], ['fd00::5', 6]] as const) {
    let closed = 0
    let lookups = 0
    setNetworkHostLookupForTests(async () => { lookups++; return [{ address, family }] })
    setSnmpSocketFactoryForTests((type) => {
      assert.equal(type, family === 6 ? 'udp6' : 'udp4')
      return Object.assign(new EventEmitter(), {
        send: (_message: Buffer, _port: number, host: string, callback: (error: Error) => void) => {
          assert.equal(host, address)
          queueMicrotask(() => callback(new Error('Synthetic send failure')))
        },
        close: () => { closed++ },
      }) as unknown as dgram.Socket
    })
    await assert.rejects(snmpGet(v2('allowed.example'), oid), /Synthetic send failure/)
    await assert.rejects(snmpGet({ ...v2('allowed.example'), version: '1' }, oid), /Synthetic send failure/)
    await assert.rejects(snmpV3Request(v3('allowed.example'), oid, 'get'), /Synthetic send failure/)
    assert.equal(closed, 3)
    assert.equal(lookups, 3)
  }
})

test('DNS is revalidated on subsequent probes and a hanging lookup is bounded', async () => {
  let lookups = 0
  setNetworkHostLookupForTests(async () => [{ address: ++lookups === 1 ? '10.10.0.5' : '127.0.0.1', family: 4 }])
  assert.equal((await resolveRoutableHost('changing.example')).address, '10.10.0.5')
  await assert.rejects(snmpGet(v2('changing.example'), oid), /reserved ranges/)
  setNetworkHostLookupForTests(() => new Promise(() => {}))
  await assert.rejects(resolveRoutableHost('hung.example', undefined, 10), /DNS timeout/)
})

test('SNMP, TCP and ICMP timeouts close or terminate the transport', async () => {
  setNetworkHostLookupForTests(async () => [{ address: '10.10.0.5', family: 4 }])
  let closed = 0
  setSnmpSocketFactoryForTests(() => Object.assign(new EventEmitter(), { send: () => {}, close: () => { closed++ } }) as unknown as dgram.Socket)
  mock.timers.enable({ apis: ['setTimeout'] })
  const snmp = snmpGet(v2('allowed.example'), oid)
  const rejected = assert.rejects(snmp, /timed out/)
  await new Promise<void>((resolve) => setImmediate(resolve))
  mock.timers.tick(1001)
  await rejected
  assert.equal(closed, 1)
  let destroyed = false
  let killed = false
  setProbeTransportsForTests({
    connect: (() => Object.assign(new EventEmitter(), { destroy: () => { destroyed = true }, end: () => {} })) as unknown as typeof net.connect,
    spawn: (() => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => { killed = true; return true } })) as unknown as typeof spawn,
  })
  const tcpResult = tcp('allowed.example')
  const pingResult = runIcmpProbe('allowed.example')
  await new Promise<void>((resolve) => setImmediate(resolve))
  mock.timers.tick(6001)
  assert.equal((await tcpResult)!.lastResult, 'offline')
  assert.equal((await pingResult).result, 'offline')
  assert.ok(destroyed && killed)
})

test('SNMPv3 keeps the pinned address through engine discovery and the authenticated request', async () => {
  const { buildSnmpV3TrapPacket } = await import('../lib/snmp-trap-build.js')
  let lookups = 0
  let sends = 0
  let closed = 0
  setNetworkHostLookupForTests(async () => [{ address: ++lookups === 1 ? '10.10.0.6' : '127.0.0.1', family: 4 }])
  setSnmpSocketFactoryForTests(() => {
    const socket = new EventEmitter()
    return Object.assign(socket, {
      close: () => { closed++ },
      send: (_message: Buffer, _port: number, address: string, callback: (error: Error) => void) => {
        assert.equal(address, '10.10.0.6')
        sends++
        if (sends === 1) queueMicrotask(() => socket.emit('message', buildSnmpV3TrapPacket({ user: 'synthetic', authPassword: 'synthetic-password' })))
        else queueMicrotask(() => callback(new Error('Synthetic authenticated request failure')))
      },
    }) as unknown as dgram.Socket
  })
  await assert.rejects(snmpV3Request(v3('changing.example'), oid, 'get'), /Synthetic authenticated request failure/)
  assert.equal(lookups, 1)
  assert.equal(sends, 2)
  assert.equal(closed, 2)
})
