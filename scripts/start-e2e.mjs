import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

// Each browser run owns disposable data outside the working tree.
const directory = mkdtempSync(path.join(os.tmpdir(), 'rackpad-e2e-'))
const nativeDirectory = path.join(directory, 'native')
mkdirSync(nativeDirectory)
const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:all'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_PATH: path.join(directory, 'test.db'),
    RACKPAD_NATIVE_BACKUP_DIR: nativeDirectory,
    RACKPAD_SECRET_KEY: 'synthetic-e2e-integration-key',
    NODE_ENV: 'test',
    OIDC_ENABLED: '0',
    SNMP_TRAP_ENABLED: '0',
    RACKPAD_RATE_LIMIT_DISABLED: '1',
  },
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
child.once('error', () => { process.exitCode = 1 })
child.once('close', (code) => {
  rmSync(directory, { recursive: true, force: true })
  process.exitCode = code ?? 0
})
