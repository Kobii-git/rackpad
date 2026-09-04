import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startOidcTestProvider } from '../server/tests/helpers/oidc-provider.js'

let origin: string
let stop: () => Promise<void>
test.beforeAll(async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rackpad-oidc-browser-'))
  const provider = await startOidcTestProvider()
  provider.setClaims({ sub: 'browser-subject', preferred_username: 'browser-user', email: 'browser@example.test', email_verified: true })
  process.env.DATABASE_PATH = path.join(directory, 'test.db')
  process.env.NODE_ENV = 'test'
  process.env.RACKPAD_SECRET_KEY = 'synthetic-browser-key'
  process.env.RACKPAD_RATE_LIMIT_DISABLED = '1'
  process.env.TRUST_PROXY = '0'
  process.env.OIDC_ENABLED = '1'
  process.env.OIDC_ISSUER_URL = provider.issuer
  process.env.OIDC_CLIENT_ID = 'rackpad-test'
  for (const key of ['OIDC_REDIRECT_URI', 'APP_URL', 'PUBLIC_URL', 'OIDC_ALLOWED_DOMAINS', 'OIDC_ADMIN_USERS', 'OIDC_ADMIN_GROUPS']) delete process.env[key]
  process.env.OIDC_ADMIN_USERS = 'browser-subject'
  const { createApp } = await import('../server/app.js')
  const { db } = await import('../server/db.js')
  const app = await createApp()
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('Test API did not listen')
  origin = `http://127.0.0.1:${address.port}`
  const bootstrap = await app.inject({ method: 'POST', url: '/api/auth/bootstrap', payload: { username: 'browser-admin', password: 'synthetic-browser-password' } })
  expect(bootstrap.statusCode).toBe(201)
  stop = async () => { await app.close(); db.close(); await provider.close(); rmSync(directory, { recursive: true, force: true }) }
})
test.afterAll(async () => { await stop?.() })

test('a real browser completes OIDC and the temporary cookie is removed', async ({ page, context }) => {
  await page.goto(`${origin}/api/auth/oidc/start`)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('rackpad.auth.token'))).toBeTruthy()
  await expect(page).not.toHaveURL(/auth\/oidc\/callback/)
  expect((await context.cookies()).some((cookie) => cookie.name === 'rackpad_oidc_flow')).toBe(false)
  const user = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${localStorage.getItem('rackpad.auth.token')}` } })
    return response.json()
  })
  expect(user.user.username).toBe('browser-user')
})

test('a completion link from another browser cannot sign the victim into the attacker account', async ({ browser }) => {
  const initiator = await browser.newContext()
  const victim = await browser.newContext()
  try {
    const start = await initiator.request.get(`${origin}/api/auth/oidc/start`, { maxRedirects: 0 })
    const provider = await initiator.request.get(start.headers().location!, { maxRedirects: 0 })
    const callback = await initiator.request.get(provider.headers().location!, { maxRedirects: 0 })
    const completion = new URL(callback.headers().location!, origin).toString()
    expect(completion).toContain('session=')
    const page = await victim.newPage()
    const refused = page.waitForResponse((response) => response.url().endsWith('/api/auth/oidc/session'))
    await page.goto(completion)
    expect((await refused).status()).toBe(403)
    await expect(page.getByRole('heading', { name: 'OIDC sign-in failed' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('rackpad.auth.token'))).toBeNull()
    // A mismatched browser must not consume the initiator's legitimate completion.
    const original = await initiator.newPage()
    await original.goto(completion)
    await expect.poll(() => original.evaluate(() => localStorage.getItem('rackpad.auth.token'))).toBeTruthy()
  } finally { await initiator.close(); await victim.close() }
})
