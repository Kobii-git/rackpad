import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
const root = fileURLToPath(new URL('../', import.meta.url))
const suffix = randomUUID().slice(0, 8)
const image = 'rackpad-snmp-interop:local'
const network = `rackpad-snmp-interop-${suffix}`
const agent = `${network}-agent`
const runner = `${network}-runner`
const probe = ['node', 'scripts/fixtures/snmp-interop/healthcheck.mjs']
function docker(args, timeout = 600000) {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit', timeout })
  if (result.error || result.status !== 0) throw new Error(`SNMP interoperability Docker ${args[0]} failed`)
}
function probeMustFail(args) {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'ignore', timeout: 15000 })
  if (result.error || result.status !== 1) throw new Error('SNMP fixture healthcheck must fail closed')
}
try {
  docker(['build', '--pull', '-t', image, '-f', 'scripts/fixtures/snmp-interop/Dockerfile', '.'])
  docker(['network', 'create', '--internal', network], 30000)
  docker(['run', '-d', '--name', agent, '--network', network, '--network-alias', 'snmp-agent', '--cap-drop=ALL', '--security-opt=no-new-privileges', image, 'node', 'scripts/fixtures/snmp-interop/agent.mjs'], 30000)
  // Readiness is a bounded authenticated query; nothing is published to the host.
  docker(['exec', agent, 'node', '-e', `const {spawnSync}=require('node:child_process'); for(let i=0;i<30;i++){ const r=spawnSync('snmpget',['-v3','-l','authPriv','-u','fixture-sha','-a','SHA','-A','maplesyrup','-x','AES','-X','priv-maplesyrup','-t','1','-r','0','127.0.0.1','1.3.6.1.2.1.1.5.0'],{stdio:'ignore',timeout:1500}); if(r.status===0)process.exit(0); } process.exit(1)`], 50000)
  docker(['exec', agent, ...probe], 15000)
  let healthy = false
  for (let attempt = 0; attempt < 30; attempt++) {
    const status = spawnSync('docker', ['inspect', '--format', '{{.State.Health.Status}}', agent], { encoding: 'utf8', timeout: 2000 })
    if (status.error || status.status !== 0) throw new Error('Cannot inspect SNMP fixture health')
    if (status.stdout.trim() === 'healthy') { healthy = true; break }
    await delay(500)
  }
  if (!healthy) throw new Error('SNMP fixture Docker HEALTHCHECK did not become healthy')
  // The shared image probes the same agent from a separate runner container.
  docker(['run', '--rm', '--network', network, '--cap-drop=ALL', '--security-opt=no-new-privileges', image, ...probe], 15000)
  probeMustFail(['exec', agent, ...probe, 'snmp-agent', 'invalid-fixture-user'])
  probeMustFail(['run', '--rm', '--network', 'none', '--cap-drop=ALL', '--security-opt=no-new-privileges', image, ...probe])
  docker(['run', '--rm', '--name', runner, '--network', network, '--cap-drop=ALL', '--security-opt=no-new-privileges', image], 120000)
  docker(['stop', '-t', '5', agent], 15000)
  probeMustFail(['run', '--rm', '--network', network, '--cap-drop=ALL', '--security-opt=no-new-privileges', image, ...probe])
  console.log('SNMP fixture healthcheck: both roles ready; wrong credentials, missing network and stopped agent rejected')
} finally {
  for (const name of [runner, agent]) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 30000 })
  spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore', timeout: 30000 })
}
