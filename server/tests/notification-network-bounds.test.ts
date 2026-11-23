import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { requestPinnedUrlWithBody, setNetworkHostLookupForTests, setPinnedRequestTransportForTests } from '../lib/net-guard.js'

for (const scenario of ['oversized', 'streaming'] as const) {
  test(`notification transport terminates ${scenario} responses`, async context => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200)
      if (scenario === 'oversized') response.end('x'.repeat(1000))
      else {
        response.write('x')
        const interval = setInterval(() => response.write('x'), 5)
        response.once('close', () => clearInterval(interval))
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    context.after(async () => {
      setNetworkHostLookupForTests(null); setPinnedRequestTransportForTests(null)
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    })
    const port = (server.address() as { port: number }).port
    const original = http.request
    // The test alone maps a validated numeric LAN target to its loopback peer.
    context.mock.method(http, 'request', ((options: http.RequestOptions) => original({ ...options, hostname: '127.0.0.1', port, lookup: undefined })) as typeof http.request)
    setNetworkHostLookupForTests(async () => [{ address: '10.20.30.40', family: 4 }])
    setPinnedRequestTransportForTests(null)
    const started = Date.now()
    await assert.rejects(requestPinnedUrlWithBody(new URL('http://fixture.example.test/topic'),
      { timeoutMs: 100, maxResponseBytes: scenario === 'oversized' ? 32 : 8192 }),
    scenario === 'oversized' ? /allowed size/ : /timed out/)
    assert.ok(Date.now() - started < 2000, 'active response traffic must not defeat the deadline')
  })
}
