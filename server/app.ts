import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticPlugin from '@fastify/static'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { authRoutes } from './routes/auth.js'
import { usersRoutes } from './routes/users.js'
import { labsRoutes } from './routes/labs.js'
import { roomsRoutes } from './routes/rooms.js'
import { racksRoutes } from './routes/racks.js'
import { devicesRoutes } from './routes/devices.js'
import { deviceTypesRoutes } from './routes/device-types.js'
import { portsRoutes } from './routes/ports.js'
import { cablesRoutes } from './routes/cables.js'
import { vlansRoutes } from './routes/vlans.js'
import { ipamRoutes } from './routes/ipam.js'
import { auditRoutes } from './routes/audit.js'
import { monitoringRoutes } from './routes/monitoring.js'
import { adminRoutes } from './routes/admin.js'
import { discoveryRoutes } from './routes/discovery.js'
import { wifiRoutes } from './routes/wifi.js'
import { virtualSwitchesRoutes } from './routes/virtual-switches.js'
import { getAuthToken, lookupSession, needsBootstrap } from './lib/auth.js'
import { ValidationError } from './lib/validation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(__dirname, '../dist')
const HYPERV_COLLECTOR_PATH = path.resolve(__dirname, '../scripts/collect-hyperv.ps1')
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function envFlag(name: string, fallback = false) {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

function parseDelimitedEnv(name: string) {
  const raw = process.env[name]
  if (!raw) return []
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value.trim()).origin.toLowerCase()
  } catch {
    return null
  }
}

function normalizeHost(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).host.toLowerCase()
    } catch {
      return null
    }
  }
  return trimmed.toLowerCase()
}

function stripHostPort(host: string) {
  if (host.startsWith('[')) {
    const match = host.match(/^\[[^\]]+\]/)
    return match ? match[0].toLowerCase() : host.toLowerCase()
  }
  return host.split(':')[0].toLowerCase()
}

function getRequestHost(headers: Record<string, unknown>) {
  const forwarded = headers['x-forwarded-host']
  const hostHeader = forwarded ?? headers.host
  if (!hostHeader) return null
  const firstValue = String(hostHeader).split(',')[0]?.trim()
  return firstValue ? normalizeHost(firstValue) : null
}

function hostAllowed(host: string | null, trustedHosts: Set<string>) {
  if (!host) return false
  const hostOnly = stripHostPort(host)
  if (LOOPBACK_HOSTS.has(hostOnly)) return true
  for (const allowed of trustedHosts) {
    if (allowed === host) return true
    if (stripHostPort(allowed) === hostOnly) return true
  }
  return false
}

function getRequestOrigin(headers: Record<string, unknown>) {
  const raw = headers.origin
  if (!raw) return null
  return normalizeOrigin(String(raw))
}

export async function createApp() {
  const trustedHosts = new Set(
    parseDelimitedEnv('TRUSTED_HOSTS')
      .map(normalizeHost)
      .filter((value): value is string => Boolean(value)),
  )
  const trustedOrigins = new Set(
    parseDelimitedEnv('TRUSTED_ORIGINS')
      .map(normalizeOrigin)
      .filter((value): value is string => Boolean(value)),
  )

  const app = Fastify({
    bodyLimit: 20 * 1024 * 1024,
    trustProxy: envFlag('TRUST_PROXY'),
    logger: process.env.NODE_ENV === 'production'
      ? true
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        },
  })

  app.decorateRequest('authUser', null)
  app.decorateRequest('sessionId', null)

  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production'
      ? (origin, callback) => {
          if (!origin) {
            callback(null, true)
            return
          }
          const normalized = normalizeOrigin(origin)
          callback(null, normalized ? trustedOrigins.has(normalized) : false)
        }
      : [...DEV_ORIGINS],
  })

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Frame-Options', 'DENY')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Cross-Origin-Opener-Policy', 'same-origin')
    reply.header('Cross-Origin-Resource-Policy', 'same-origin')
    reply.header('X-DNS-Prefetch-Control', 'off')
    reply.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=()')
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    )
    if (req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store')
    }
    if (req.protocol === 'https' || (req.headers['x-forwarded-proto'] ?? '').toString().includes('https')) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    return payload
  })

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ValidationError) {
      reply.status(error.statusCode).send({ error: error.message })
      return
    }

    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      reply.status(409).send({ error: 'That record conflicts with an existing value.' })
      return
    }

    // A referenced FK record (labId, subnetId, etc.) does not exist.
    if (error instanceof Error && /FOREIGN KEY constraint failed/i.test(error.message)) {
      reply.status(422).send({ error: 'A referenced record does not exist.' })
      return
    }

    // Catches any NOT NULL violation that slips past route-level guards.
    if (error instanceof Error && /NOT NULL constraint failed/i.test(error.message)) {
      reply.status(400).send({ error: 'A required field is missing.' })
      return
    }

    reply.status(500).send({ error: 'Internal server error.' })
  })

  app.get('/api/health', async () => ({ ok: true }))
  app.get('/api/imports/hyperv-collector', async (_req, reply) => {
    if (!existsSync(HYPERV_COLLECTOR_PATH)) {
      reply.status(404).send({
        error: 'Hyper-V collector script is not available in this build.',
      })
      return
    }

    reply
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="collect-hyperv.ps1"')
      .send(readFileSync(HYPERV_COLLECTOR_PATH, 'utf8'))
  })

  const publicPaths = new Set([
    '/api/health',
    '/api/imports/hyperv-collector',
    '/api/auth/status',
    '/api/auth/bootstrap',
    '/api/auth/login',
    '/api/auth/oidc/start',
    '/api/auth/oidc/callback',
    '/api/auth/oidc/session',
  ])
  const readOnlyMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
  const writeWhitelist = new Set(['/api/auth/logout'])

  app.addHook('onRequest', async (req, reply) => {
    if (process.env.NODE_ENV === 'production' && trustedHosts.size > 0) {
      const requestHost = getRequestHost(req.headers as Record<string, unknown>)
      if (!hostAllowed(requestHost, trustedHosts)) {
        return reply.status(400).send({ error: 'Request host is not allowed by this Rackpad deployment.' })
      }
    }

    if (process.env.NODE_ENV === 'production' && trustedOrigins.size > 0) {
      const requestOrigin = getRequestOrigin(req.headers as Record<string, unknown>)
      if (requestOrigin && !trustedOrigins.has(requestOrigin)) {
        return reply.status(403).send({ error: 'Request origin is not allowed by this Rackpad deployment.' })
      }
    }

    if (!req.url.startsWith('/api/')) return
    const urlPath = req.url.split('?')[0]
    if (publicPaths.has(urlPath)) return

    if (needsBootstrap()) {
      return reply.status(503).send({ error: 'Authentication is not configured yet. Create the initial admin account first.' })
    }

    const token = getAuthToken(req)
    if (!token) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const session = lookupSession(token)
    if (!session) {
      return reply.status(401).send({ error: 'Session expired or invalid.' })
    }

    req.authUser = session
    req.sessionId = session.sessionId

    const method = req.method.toUpperCase()

    if (!readOnlyMethods.has(method) && !writeWhitelist.has(urlPath) && req.authUser.role === 'viewer') {
      return reply.status(403).send({ error: 'Viewer accounts are read-only.' })
    }
  })

  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(usersRoutes, { prefix: '/api/users' })
  await app.register(labsRoutes, { prefix: '/api/labs' })
  await app.register(roomsRoutes, { prefix: '/api/rooms' })
  await app.register(racksRoutes, { prefix: '/api/racks' })
  await app.register(devicesRoutes, { prefix: '/api/devices' })
  await app.register(deviceTypesRoutes, { prefix: '/api/device-types' })
  await app.register(portsRoutes, { prefix: '/api/ports' })
  await app.register(cablesRoutes, { prefix: '/api/port-links' })
  await app.register(vlansRoutes, { prefix: '/api/vlans' })
  await app.register(ipamRoutes, { prefix: '/api' })
  await app.register(auditRoutes, { prefix: '/api/audit-log' })
  await app.register(monitoringRoutes, { prefix: '/api/device-monitors' })
  await app.register(discoveryRoutes, { prefix: '/api/discovery' })
  await app.register(wifiRoutes, { prefix: '/api/wifi' })
  await app.register(virtualSwitchesRoutes, { prefix: '/api/virtual-switches' })
  await app.register(adminRoutes, { prefix: '/api/admin' })

  if (existsSync(DIST_DIR)) {
    await app.register(staticPlugin, {
      root: DIST_DIR,
      prefix: '/',
    })

    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html', DIST_DIR)
      }
      reply.status(404).send({ error: 'Not found' })
    })
  } else {
    app.get('/', async () => ({ message: 'Rackpad API running. Frontend served by Vite on :5173' }))
  }

  return app
}
