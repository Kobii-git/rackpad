import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const suffix = randomUUID().slice(0, 8)
const image = 'rackpad-snmp-interop:local'
const network = `rackpad-snmp-interop-${suffix}`
const agent = `${network}-agent`
const runner = `${network}-runner`
function docker(args, timeout = 600000) {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit', timeout })
  if (result.error || result.status !== 0) throw new Error(`SNMP interoperability Docker ${args[0]} failed`)
}
try {
  docker(['build', '--pull', '-t', image, '-f', 'scripts/fixtures/snmp-interop/Dockerfile', '.'])
  docker(['network', 'create', '--internal', network], 30000)
  docker(['run', '-d', '--name', agent, '--network', network, '--network-alias', 'snmp-agent', '--cap-drop=ALL', '--security-opt=no-new-privileges', image, 'node', 'scripts/fixtures/snmp-interop/agent.mjs'], 30000)
  // Readiness is a bounded authenticated query; nothing is published to the host.
  docker(['exec', agent, 'node', '-e', `const {spawnSync}=require('node:child_process'); for(let i=0;i<30;i++){ const r=spawnSync('snmpget',['-v3','-l','authPriv','-u','fixture-sha','-a','SHA','-A','maplesyrup','-x','AES','-X','priv-maplesyrup','-t','1','-r','0','127.0.0.1','1.3.6.1.2.1.1.5.0'],{stdio:'ignore',timeout:1500}); if(r.status===0)process.exit(0); } process.exit(1)`], 50000)
  docker(['run', '--rm', '--name', runner, '--network', network, '--cap-drop=ALL', '--security-opt=no-new-privileges', image], 120000)
} finally {
  for (const name of [runner, agent]) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 30000 })
  spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore', timeout: 30000 })
}
