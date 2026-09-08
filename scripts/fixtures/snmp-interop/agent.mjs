import { mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
mkdirSync('/var/lib/snmp', { recursive: true })
// Public synthetic credentials, confined to the disposable test network.
writeFileSync('/var/lib/snmp/snmpd.conf', ['SHA', 'MD5'].flatMap(protocol => [
  `createUser fixture-${protocol.toLowerCase()} ${protocol} maplesyrup AES priv-maplesyrup`,
  `createUser fixture-${protocol.toLowerCase()}-auth ${protocol} maplesyrup`,
]).join('\n') + '\n', { mode: 0o600 })
writeFileSync('/tmp/snmpd.conf', [
  'agentaddress udp:161', 'sysName fixture-switch', 'sysLocation isolated-interop',
  ...['sha', 'md5'].flatMap(protocol => [`rouser fixture-${protocol} priv .1`, `rouser fixture-${protocol}-auth auth .1`]),
].join('\n') + '\n')
const child = spawn('snmpd', ['-f', '-Lo', '-p', '/tmp/snmpd.pid', '-C', '-c', '/var/lib/snmp/snmpd.conf,/tmp/snmpd.conf'], { stdio: 'inherit' })
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => child.kill(signal))
child.once('exit', code => { process.exitCode = code ?? 1 })
