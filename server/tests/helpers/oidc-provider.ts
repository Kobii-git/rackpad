import http from 'node:http'
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'

// Synthetic provider shared by API and real-browser security regressions.
export async function startOidcTestProvider() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  let issuer = ''
  let claims: Record<string, unknown> = { sub: 'test-subject', email: 'user@example.test', email_verified: true, preferred_username: 'test-user' }
  const codes = new Map<string, { nonce: string; claims: Record<string, unknown> }>()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer)
    res.setHeader('Content-Type', 'application/json')
    if (url.pathname === '/.well-known/openid-configuration') {
      res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }))
    } else if (url.pathname === '/jwks') {
      res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] }))
    } else if (url.pathname === '/authorize') {
      const code = randomUUID()
      codes.set(code, { nonce: url.searchParams.get('nonce')!, claims: { ...claims } })
      const redirect = new URL(url.searchParams.get('redirect_uri')!)
      redirect.searchParams.set('code', code)
      redirect.searchParams.set('state', url.searchParams.get('state')!)
      res.writeHead(302, { Location: redirect.toString() })
      res.end()
    } else if (url.pathname === '/token') {
      let body = ''
      for await (const chunk of req) body += String(chunk)
      const code = new URLSearchParams(body).get('code') ?? ''
      const entry = codes.get(code)
      codes.delete(code)
      if (!entry) { res.writeHead(400); res.end('{}'); return }
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: 'rackpad-test', exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), nonce: entry.nonce, ...entry.claims })).toString('base64url')
      const message = `${header}.${payload}`
      res.end(JSON.stringify({ id_token: `${message}.${sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64url')}` }))
    } else { res.writeHead(404); res.end('{}') }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test provider failed to listen')
  issuer = `http://127.0.0.1:${address.port}`
  return {
    issuer,
    setClaims(next: Record<string, unknown>) { claims = next },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}
