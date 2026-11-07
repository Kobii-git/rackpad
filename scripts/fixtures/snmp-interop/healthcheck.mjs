import { spawnSync } from 'node:child_process'

// Public synthetic credentials, confined to the disposable fixture network.
// The alias resolves to the agent from both roles that use this image.
const result = spawnSync('snmpget', [
  '-v3', '-l', 'authPriv', '-u', process.argv[3] ?? 'fixture-sha',
  '-a', 'SHA', '-A', 'maplesyrup', '-x', 'AES', '-X', 'priv-maplesyrup',
  '-t', '1', '-r', '0', process.argv[2] ?? 'snmp-agent', '1.3.6.1.2.1.1.5.0',
], { encoding: 'utf8', timeout: 1500, maxBuffer: 4096 })
process.exitCode = !result.error && result.status === 0 && result.stdout.includes('fixture-switch') ? 0 : 1
