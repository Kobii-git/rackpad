import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
const directory = mkdtempSync(path.join(tmpdir(), 'rackpad-snmp-agent-'))
const config = path.join(directory, 'snmpd.conf')
mkdirSync('/var/lib/snmp', { recursive: true })
// Public synthetic credentials, confined to the disposable test network.
writeFileSync('/var/lib/snmp/snmpd.conf', ['SHA', 'MD5'].flatMap(protocol => [
  `createUser fixture-${protocol.toLowerCase()} ${protocol} maplesyrup AES priv-maplesyrup`,
  `createUser fixture-${protocol.toLowerCase()}-auth ${protocol} maplesyrup`,
]).join('\n') + '\n', { mode: 0o600 })
writeFileSync(config, [
  'agentaddress udp:161', 'sysName fixture-switch', 'sysLocation isolated-interop',
  ...['sha', 'md5'].flatMap(protocol => [`rouser fixture-${protocol} priv .1`, `rouser fixture-${protocol}-auth auth .1`]),
].join('\n') + '\n')
const child = spawn('snmpd', ['-f', '-Lo', '-p', path.join(directory, 'snmpd.pid'), '-C', '-c', `/var/lib/snmp/snmpd.conf,${config}`], { stdio: 'inherit' })
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal))
child.once('exit', code => { rmSync(directory, { recursive: true, force: true }); process.exitCode = code ?? 1 })
