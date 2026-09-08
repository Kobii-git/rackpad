import { spawnSync } from 'node:child_process'
for (const fixture of ['fresh', 'upgrade']) {
  console.log(`Storage browser compatibility: ${fixture} database`)
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.storage.config.ts'], {
    stdio: 'inherit', env: { ...process.env, RACKPAD_TEST_STORAGE_UPGRADE: fixture === 'upgrade' ? '1' : '0' },
  })
  if (result.error || result.status !== 0) { process.exitCode = 1; break }
}
