import {
  constants,
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
  type KeyObject,
} from 'node:crypto'
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify'
import { db } from '../db.js'
import { ensureDefaultLab } from '../seed.js'
import { createId } from './ids.js'
import {
  createSession,
  type UserRole,
  USER_ROLES,
  parsePublicUser,
  setBootstrapState,
} from './auth.js'
import { ValidationError } from './validation.js'

type OidcDiscovery = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

type OidcJwks = {
  keys: Array<Record<string, unknown>>
}

type OidcState = {
  browserHash: string
  codeVerifier: string
  nonce: string
  redirectUri: string
  returnTo: string
  createdAt: number
}

type OidcCallbackInput = {
  code?: string
  state?: string
  error?: string
  errorDescription?: string
}

type ValidOidcCallback = {
  code: string
  state: string
}

type PendingSession = {
  browserHash: string
  claims: OidcClaims
  clientId: string
  returnTo: string
  createdAt: number
}

type OidcClaims = Record<string, unknown> & {
  iss?: string
  sub?: string
  aud?: string | string[]
  azp?: string
  exp?: number
  iat?: number
  nonce?: string
  email?: string
  email_verified?: boolean
  name?: string
  preferred_username?: string
}

type OidcLogger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn'>

const DEFAULT_SCOPES = 'openid profile email'
const STATE_TTL_MS = 10 * 60 * 1000
const SESSION_CODE_TTL_MS = 2 * 60 * 1000
const BROWSER_COOKIE = 'rackpad_oidc_flow'
const DISCOVERY_TTL_MS = 60 * 60 * 1000
const JWKS_TTL_MS = 60 * 60 * 1000
const oidcStates = new Map<string, OidcState>()
const pendingSessions = new Map<string, PendingSession>()
let discoveryCache: {
  issuer: string
  value: OidcDiscovery
  fetchedAt: number
} | null = null
let jwksCache: { uri: string; value: OidcJwks; fetchedAt: number } | null = null

function envFlag(name: string, fallback = false) {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw)
}

function oidcDebugEnabled() {
  return envFlag('OIDC_DEBUG')
}

function logOidcDebug(
  log: OidcLogger | undefined,
  payload: Record<string, unknown>,
  message: string,
) {
  if (!oidcDebugEnabled()) return
  if (log?.info) {
    log.info(payload, message)
    return
  }
  console.info(message, payload)
}

function callbackValue(value: string | undefined) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function callbackProviderError(input: OidcCallbackInput) {
  return callbackValue(input.errorDescription) ?? callbackValue(input.error)
}

function parseOidcCallback(input: OidcCallbackInput): ValidOidcCallback {
  const code = callbackValue(input.code)
  const state = callbackValue(input.state)
  if (!code || !state) {
    throw new ValidationError(
      callbackProviderError(input) ||
        'OIDC callback is missing code or state.',
    )
  }
  return { code, state }
}

function splitEnv(name: string) {
  return (process.env[name] ?? '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function normalizeIssuer(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function oidcConfig() {
  const issuer = process.env.OIDC_ISSUER_URL
    ? normalizeIssuer(process.env.OIDC_ISSUER_URL)
    : ''
  const clientId = process.env.OIDC_CLIENT_ID?.trim() ?? ''
  const enabled = envFlag('OIDC_ENABLED') && Boolean(issuer && clientId)
  return {
    enabled,
    issuer,
    clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET?.trim() ?? '',
    clientAuthMethod: (
      process.env.OIDC_CLIENT_AUTH_METHOD?.trim() || 'client_secret_basic'
    ).toLowerCase(),
    scopes: process.env.OIDC_SCOPES?.trim() || DEFAULT_SCOPES,
    label: process.env.OIDC_LABEL?.trim() || 'OIDC',
    defaultRole: normalizeRole(process.env.OIDC_DEFAULT_ROLE) ?? 'viewer',
    usernameClaim:
      process.env.OIDC_USERNAME_CLAIM?.trim() || 'preferred_username',
    displayNameClaim: process.env.OIDC_DISPLAY_NAME_CLAIM?.trim() || 'name',
    roleClaim: process.env.OIDC_ROLE_CLAIM?.trim() || 'groups',
    redirectUri: process.env.OIDC_REDIRECT_URI?.trim() || '',
    allowedDomains: lowerSet(splitEnv('OIDC_ALLOWED_DOMAINS')),
    adminUsers: new Set(splitEnv('OIDC_ADMIN_USERS')),
    editorUsers: new Set(splitEnv('OIDC_EDITOR_USERS')),
    viewerUsers: new Set(splitEnv('OIDC_VIEWER_USERS')),
    adminGroups: lowerSet(splitEnv('OIDC_ADMIN_GROUPS')),
    editorGroups: lowerSet(splitEnv('OIDC_EDITOR_GROUPS')),
    viewerGroups: lowerSet(splitEnv('OIDC_VIEWER_GROUPS')),
  }
}

function lowerSet(values: string[]) {
  return new Set(values.map((value) => value.toLowerCase()))
}

function normalizeRole(value: string | undefined) {
  const role = value?.trim().toLowerCase()
  return USER_ROLES.includes(role as UserRole) ? (role as UserRole) : null
}

export function getOidcPublicConfig() {
  const config = oidcConfig()
  return {
    enabled: config.enabled,
    label: config.label,
  }
}

export function isOidcEnabled() {
  return oidcConfig().enabled
}

export async function createOidcAuthorizationUrl(
  req: FastifyRequest,
  reply: FastifyReply,
  returnTo: string | undefined,
) {
  const config = oidcConfig()
  if (!config.enabled) {
    throw new ValidationError(
      'OIDC is not enabled for this Rackpad deployment.',
      404,
    )
  }

  cleanupExpired()
  const discovery = await loadDiscovery(config.issuer, req.log)
  const previousBrowser = readBrowserVerifier(req)
  if (previousBrowser) {
    const previousHash = hashBrowserVerifier(previousBrowser)
    for (const [key, flow] of oidcStates) {
      if (flow.browserHash === previousHash) oidcStates.delete(key)
    }
    for (const [key, flow] of pendingSessions) {
      if (flow.browserHash === previousHash) pendingSessions.delete(key)
    }
  }
  const browserVerifier = randomToken()
  writeBrowserCookie(req, reply, browserVerifier)
  const state = randomToken()
  const nonce = randomToken()
  const codeVerifier = base64Url(randomBytes(48))
  const codeChallenge = base64Url(
    createHash('sha256').update(codeVerifier).digest(),
  )
  const redirectUri = getRedirectUri(req, config.redirectUri)
  logOidcDebug(
    req.log,
    {
      issuer: config.issuer,
      discoveryUrl: discoveryUrlForIssuer(config.issuer),
      redirectUri,
      clientId: config.clientId,
      scopes: config.scopes,
    },
    'OIDC authorization start',
  )

  oidcStates.set(state, {
    browserHash: hashBrowserVerifier(browserVerifier),
    codeVerifier,
    nonce,
    redirectUri,
    returnTo: safeReturnTo(returnTo),
    createdAt: Date.now(),
  })

  const url = new URL(discovery.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', config.scopes)
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function handleOidcCallback(
  input: OidcCallbackInput,
  req: FastifyRequest,
  log?: OidcLogger,
) {
  const config = oidcConfig()
  if (!config.enabled) {
    throw new ValidationError(
      'OIDC is not enabled for this Rackpad deployment.',
      404,
    )
  }
  const callback = parseOidcCallback(input)

  cleanupExpired()
  const state = oidcStates.get(callback.state)
  if (!state || Date.now() - state.createdAt > STATE_TTL_MS) {
    throw new ValidationError(
      'OIDC sign-in state expired. Start sign-in again.',
    )
  }
  assertBrowserBinding(req, state.browserHash)
  oidcStates.delete(callback.state)

  const discovery = await loadDiscovery(config.issuer, log)
  const tokenResponse = await exchangeCodeForTokens(
    discovery,
    config,
    callback.code,
    state,
    log,
  )
  const idToken = tokenResponse.id_token
  if (!idToken) {
    throw new ValidationError('OIDC provider did not return an ID token.')
  }

  const claims = await verifyIdToken(
    idToken,
    discovery,
    config.clientId,
    state.nonce,
    log,
  )
  const sessionCode = randomToken()
  pendingSessions.set(sessionCode, {
    browserHash: state.browserHash,
    claims,
    clientId: config.clientId,
    returnTo: state.returnTo,
    createdAt: Date.now(),
  })

  return {
    sessionCode,
    returnTo: state.returnTo,
  }
}

export function consumeOidcSession(sessionCode: string, req: FastifyRequest, reply: FastifyReply) {
  cleanupExpired()
  const pending = pendingSessions.get(sessionCode)
  if (!pending || Date.now() - pending.createdAt > SESSION_CODE_TTL_MS) {
    throw new ValidationError('OIDC session expired. Start sign-in again.')
  }
  assertBrowserBinding(req, pending.browserHash)
  pendingSessions.delete(sessionCode)
  const config = oidcConfig()
  if (!config.enabled || config.issuer !== normalizeIssuer(String(pending.claims.iss)) ||
      config.clientId !== pending.clientId || Number(pending.claims.exp) * 1000 <= Date.now()) {
    throw new ValidationError('OIDC session expired. Start sign-in again.')
  }
  const { user, session } = db.transaction(() => {
    const user = upsertOidcUser(config, pending.claims)
    return { user, session: createSession(user.id) }
  })()
  writeBrowserCookie(req, reply, '')
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    user,
    returnTo: pending.returnTo,
  }
}

function readBrowserVerifier(req: FastifyRequest) {
  const matches = (req.headers.cookie ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith(`${BROWSER_COOKIE}=`))
  if (matches.length !== 1) return null
  const value = matches[0]!.slice(BROWSER_COOKIE.length + 1)
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
}

function hashBrowserVerifier(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function assertBrowserBinding(req: FastifyRequest, expectedHash: string) {
  const value = readBrowserVerifier(req)
  if (!value || !timingSafeEqual(Buffer.from(hashBrowserVerifier(value), 'hex'), Buffer.from(expectedHash, 'hex'))) {
    throw new ValidationError('OIDC sign-in must finish in the browser that started it.', 403)
  }
}

function writeBrowserCookie(req: FastifyRequest, reply: FastifyReply, value: string) {
  // The cookie carries only the flow verifier, never an authentication session.
  // Its maximum lifetime covers authorization followed by the completion window.
  const maxAge = value ? (STATE_TTL_MS + SESSION_CODE_TTL_MS) / 1000 : 0
  const secure = req.protocol === 'https' || new URL(getRedirectUri(req, oidcConfig().redirectUri)).protocol === 'https:'
  reply.header('Set-Cookie', `${BROWSER_COOKIE}=${value}; Path=/api/auth/oidc; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`)
}

function getRedirectUri(req: FastifyRequest, configured: string) {
  if (configured) return configured
  const appUrl = (process.env.APP_URL || process.env.PUBLIC_URL || '')
    .trim()
    .replace(/\/+$/, '')
  if (appUrl) return `${appUrl}/api/auth/oidc/callback`

  return `${req.protocol}://${req.host}/api/auth/oidc/callback`
}

function safeReturnTo(value: string | undefined) {
  if (!value) return '/'
  try {
    const decoded = decodeURIComponent(value)
    if (
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.startsWith('/api/')
    )
      return '/'
    return decoded.slice(0, 200)
  } catch {
    return '/'
  }
}

function discoveryUrlForIssuer(issuer: string) {
  return `${issuer}/.well-known/openid-configuration`
}

async function loadDiscovery(
  issuer: string,
  log?: OidcLogger,
): Promise<OidcDiscovery> {
  if (
    discoveryCache?.issuer === issuer &&
    Date.now() - discoveryCache.fetchedAt < DISCOVERY_TTL_MS
  ) {
    return discoveryCache.value
  }
  const url = discoveryUrlForIssuer(issuer)
  logOidcDebug(log, { issuer, url }, 'Fetching OIDC discovery document')
  const response = await fetchJson(url, 'OIDC discovery document', log)
  const discovery = response as Partial<OidcDiscovery>
  if (
    !discovery.issuer ||
    !discovery.authorization_endpoint ||
    !discovery.token_endpoint ||
    !discovery.jwks_uri
  ) {
    throw new ValidationError(
      'OIDC discovery document is missing required endpoints.',
      502,
    )
  }
  const normalized = {
    issuer: normalizeIssuer(discovery.issuer),
    authorization_endpoint: discovery.authorization_endpoint,
    token_endpoint: discovery.token_endpoint,
    jwks_uri: discovery.jwks_uri,
  }
  logOidcDebug(
    log,
    {
      issuer: normalized.issuer,
      authorizationEndpoint: normalized.authorization_endpoint,
      tokenEndpoint: normalized.token_endpoint,
      jwksUri: normalized.jwks_uri,
    },
    'Loaded OIDC discovery document',
  )
  discoveryCache = { issuer, value: normalized, fetchedAt: Date.now() }
  return normalized
}

async function loadJwks(uri: string, log?: OidcLogger): Promise<OidcJwks> {
  if (
    jwksCache?.uri === uri &&
    Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.value
  }
  logOidcDebug(log, { uri }, 'Fetching OIDC JWKS')
  const value = (await fetchJson(uri, 'OIDC JWKS', log)) as OidcJwks
  if (!Array.isArray(value.keys)) {
    throw new ValidationError('OIDC JWKS document is invalid.', 502)
  }
  jwksCache = { uri, value, fetchedAt: Date.now() }
  return value
}

async function fetchJson(url: string, label: string, log?: OidcLogger) {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'request failed'
    logOidcDebug(log, { url, error: detail }, `${label} request failed`)
    throw new ValidationError(`${label} request to ${url} failed: ${detail}`, 502)
  }
  logOidcDebug(log, { url, status: response.status }, `${label} response`)
  if (!response.ok) {
    throw new ValidationError(
      `${label} request to ${url} failed with HTTP ${response.status}. Check OIDC_ISSUER_URL; Rackpad appends /.well-known/openid-configuration to the issuer.`,
      502,
    )
  }
  return response.json()
}

async function exchangeCodeForTokens(
  discovery: OidcDiscovery,
  config: ReturnType<typeof oidcConfig>,
  code: string,
  state: OidcState,
  log?: OidcLogger,
) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: state.redirectUri,
    client_id: config.clientId,
    code_verifier: state.codeVerifier,
  })
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  }

  if (config.clientSecret && config.clientAuthMethod === 'client_secret_post') {
    body.set('client_secret', config.clientSecret)
  } else if (config.clientSecret && config.clientAuthMethod !== 'none') {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
  }

  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  })
  logOidcDebug(
    log,
    { tokenEndpoint: discovery.token_endpoint, status: response.status },
    'OIDC token endpoint response',
  )
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >
  if (!response.ok) {
    const message =
      typeof payload.error_description === 'string'
        ? payload.error_description
        : `OIDC token exchange failed with HTTP ${response.status}.`
    throw new ValidationError(message, 502)
  }
  return payload as {
    id_token?: string
    access_token?: string
    token_type?: string
  }
}

async function verifyIdToken(
  token: string,
  discovery: OidcDiscovery,
  clientId: string,
  nonce: string,
  log?: OidcLogger,
): Promise<OidcClaims> {
  const parts = token.split('.')
  if (parts.length !== 3)
    throw new ValidationError('OIDC ID token is malformed.')

  const header = decodeJwtPart(parts[0]) as Record<string, unknown>
  const claims = decodeJwtPart(parts[1]) as OidcClaims
  const alg = typeof header.alg === 'string' ? header.alg : ''
  const kid = typeof header.kid === 'string' ? header.kid : null
  if (!alg || alg === 'none')
    throw new ValidationError(
      'OIDC ID token uses an unsupported signing algorithm.',
    )

  const jwks = await loadJwks(discovery.jwks_uri, log)
  const jwk = jwks.keys.find((entry) => {
    if (kid && entry.kid !== kid) return false
    return !entry.alg || entry.alg === alg
  })
  if (!jwk) throw new ValidationError('OIDC signing key was not found.', 502)

  const key = createPublicKey({ key: jwk as never, format: 'jwk' })
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`)
  const signature = Buffer.from(parts[2], 'base64url')
  if (!verifyJwtSignature(alg, key, signingInput, signature)) {
    throw new ValidationError('OIDC ID token signature is invalid.')
  }

  if (normalizeIssuer(String(claims.iss ?? '')) !== discovery.issuer) {
    throw new ValidationError(
      'OIDC ID token issuer does not match this provider.',
    )
  }
  if (!claims.sub)
    throw new ValidationError('OIDC ID token is missing a subject.')
  if (!audienceMatches(claims.aud, clientId)) {
    throw new ValidationError('OIDC ID token audience does not match Rackpad.')
  }
  if (
    Array.isArray(claims.aud) &&
    claims.aud.length > 1 &&
    claims.azp &&
    claims.azp !== clientId
  ) {
    throw new ValidationError(
      'OIDC ID token authorized party does not match Rackpad.',
    )
  }
  if (!claims.exp || claims.exp * 1000 <= Date.now() - 30_000) {
    throw new ValidationError('OIDC ID token is expired.')
  }
  if (claims.nonce !== nonce) {
    throw new ValidationError(
      'OIDC ID token nonce does not match this sign-in attempt.',
    )
  }
  return claims
}

function verifyJwtSignature(
  alg: string,
  key: KeyObject,
  data: Buffer,
  signature: Buffer,
) {
  switch (alg) {
    case 'RS256':
      return verifySignature('RSA-SHA256', data, key, signature)
    case 'RS384':
      return verifySignature('RSA-SHA384', data, key, signature)
    case 'RS512':
      return verifySignature('RSA-SHA512', data, key, signature)
    case 'PS256':
      return verifySignature(
        'RSA-SHA256',
        data,
        {
          key,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
        },
        signature,
      )
    case 'ES256':
      return verifySignature(
        'SHA256',
        data,
        { key, dsaEncoding: 'ieee-p1363' },
        signature,
      )
    case 'ES384':
      return verifySignature(
        'SHA384',
        data,
        { key, dsaEncoding: 'ieee-p1363' },
        signature,
      )
    case 'ES512':
      return verifySignature(
        'SHA512',
        data,
        { key, dsaEncoding: 'ieee-p1363' },
        signature,
      )
    case 'EdDSA':
      return verifySignature(null, data, key, signature)
    default:
      throw new ValidationError(
        `OIDC ID token signing algorithm ${alg} is not supported.`,
      )
  }
}

function decodeJwtPart(value: string) {
  try {
    return JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown
  } catch {
    throw new ValidationError('OIDC ID token contains invalid JSON.')
  }
}

function audienceMatches(
  audience: string | string[] | undefined,
  clientId: string,
) {
  if (typeof audience === 'string') return audience === clientId
  if (Array.isArray(audience)) return audience.includes(clientId)
  return false
}

function upsertOidcUser(
  config: ReturnType<typeof oidcConfig>,
  claims: OidcClaims,
) {
  const issuer = normalizeIssuer(String(claims.iss))
  const subject = String(claims.sub)
  const email =
    typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : null
  if (config.allowedDomains.size > 0) {
    const domain = email?.split('@')[1]?.toLowerCase()
    if (claims.email_verified !== true || !email || email.split('@').length !== 2 || !domain || !config.allowedDomains.has(domain)) {
      throw new ValidationError(
        'This OIDC account is not allowed to access Rackpad.',
        403,
      )
    }
  }

  const now = new Date().toISOString()
  const existing = db
    .prepare(
      `
    SELECT u.*, i.roleRecheckRequired
    FROM oidcIdentities i
    JOIN users u ON u.id = i.userId
    WHERE i.issuer = ? AND i.subject = ?
  `,
    )
    .get(issuer, subject) as Record<string, unknown> | undefined

  if (existing) {
    if (Number(existing.disabled ?? 0) === 1) {
      throw new ValidationError('This Rackpad account is disabled.', 403)
    }
    const displayName = displayNameFromClaims(config, claims)
    const role = Number(existing.roleRecheckRequired) === 1 ? roleFromClaims(config, claims) : existing.role
    db.prepare(
      `
      UPDATE oidcIdentities
      SET email = ?, displayName = ?, updatedAt = ?, roleRecheckRequired = 0
      WHERE issuer = ? AND subject = ?
    `,
    ).run(email, displayName, now, issuer, subject)
    db.prepare(
      'UPDATE users SET displayName = ?, lastLoginAt = ?, role = ? WHERE id = ?',
    ).run(displayName, now, role, existing.id)
    return parsePublicUser({ ...existing, displayName, role, lastLoginAt: now })
  }

  const firstUser = needsFirstUser()
  const userId = createId('u')
  const username = uniqueUsername(usernameFromClaims(config, claims, subject))
  const displayName = displayNameFromClaims(config, claims)
  const role = firstUser ? 'admin' : roleFromClaims(config, claims)

  const createUser = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO users (id, username, displayName, passwordHash, role, disabled, createdAt, lastLoginAt)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `,
    ).run(
      userId,
      username,
      displayName,
      oidcPasswordMarker(issuer, subject),
      role,
      now,
      now,
    )
    db.prepare(
      `
      INSERT INTO oidcIdentities (issuer, subject, userId, email, displayName, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(issuer, subject, userId, email, displayName, now, now)
    if (firstUser) {
      ensureDefaultLab()
      setBootstrapState(false)
    }
  })
  createUser()

  return {
    id: userId,
    username,
    displayName,
    role,
    disabled: false,
    createdAt: now,
    lastLoginAt: now,
  }
}

function needsFirstUser() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as {
    count: number
  }
  return row.count === 0
}

function oidcPasswordMarker(issuer: string, subject: string) {
  return `oidc:${hashShort(issuer)}:${hashShort(subject)}`
}

function usernameFromClaims(
  config: ReturnType<typeof oidcConfig>,
  claims: OidcClaims,
  subject: string,
) {
  const claimValue = claimAsString(claims, config.usernameClaim)
  const fallback =
    claims.preferred_username || claims.email?.split('@')[0] || subject
  const raw = (claimValue || fallback || subject).toString()
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/@.*/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return normalized || `oidc-${hashShort(subject)}`
}

function displayNameFromClaims(
  config: ReturnType<typeof oidcConfig>,
  claims: OidcClaims,
) {
  return (
    claimAsString(claims, config.displayNameClaim) ||
    claims.name ||
    claims.preferred_username ||
    claims.email ||
    claims.sub ||
    'OIDC user'
  )
    .toString()
    .trim()
    .slice(0, 80)
}

function roleFromClaims(
  config: ReturnType<typeof oidcConfig>,
  claims: OidcClaims,
): UserRole {
  const usernames = [
    claims.preferred_username,
    ...(['sub', 'email'].includes(config.usernameClaim) ? [] : [claimAsString(claims, config.usernameClaim)]),
  ]
    .filter(
      (value): value is string =>
        typeof value === 'string' && Boolean(value.trim()) && !value.includes('@') && value.trim().toLowerCase() !== claims.sub?.toLowerCase(),
    )
    .map((value) => value.trim().toLowerCase())

  const matchesUser = (allowlist: Set<string>) => [...allowlist].some((entry) => {
    if (entry.includes('@')) {
      return claims.email_verified === true && typeof claims.email === 'string' &&
        claims.email.trim().toLowerCase() === entry.toLowerCase()
    }
    return entry === claims.sub || usernames.includes(entry.toLowerCase())
  })

  if (matchesUser(config.adminUsers)) return 'admin'
  if (matchesUser(config.editorUsers))
    return 'editor'
  if (matchesUser(config.viewerUsers))
    return 'viewer'

  const roleValue = claimAsString(claims, config.roleClaim)
  const roleUsesEmail = config.roleClaim === 'email' || (roleValue != null &&
    typeof claims.email === 'string' && roleValue.toLowerCase() === claims.email.trim().toLowerCase())
  const groups = claimAsStringArray(claims, config.roleClaim, !roleUsesEmail || claims.email_verified === true)
  if (groups.some((value) => config.adminGroups.has(value))) return 'admin'
  if (groups.some((value) => config.editorGroups.has(value))) return 'editor'
  if (groups.some((value) => config.viewerGroups.has(value))) return 'viewer'

  return config.defaultRole
}

function claimAsString(claims: Record<string, unknown>, path: string) {
  const value = claimValue(claims, path)
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function claimAsStringArray(claims: Record<string, unknown>, path: string, includePrimary = true) {
  const value = claimValue(claims, path)
  const values = !includePrimary ? [] : Array.isArray(value)
    ? [...value]
    : typeof value === 'string'
      ? [value]
      : []
  const extraGroups = claimValue(claims, 'groups')
  if (Array.isArray(extraGroups) && extraGroups !== value)
    values.push(...extraGroups)
  const extraRoles =
    claimValue(claims, 'roles') ?? claimValue(claims, 'realm_access.roles')
  if (Array.isArray(extraRoles) && extraRoles !== value)
    values.push(...extraRoles)
  return values
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' && Boolean(entry.trim()),
    )
    .map((entry) => entry.trim().toLowerCase())
}

function claimValue(claims: Record<string, unknown>, path: string) {
  let current: unknown = claims
  for (const part of path.split('.').filter(Boolean)) {
    if (!current || typeof current !== 'object' || Array.isArray(current))
      return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function uniqueUsername(base: string) {
  let candidate = base.slice(0, 40)
  let suffix = 1
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(candidate)) {
    const tail = `-${hashShort(`${base}:${suffix}`)}`
    candidate = `${base.slice(0, 40 - tail.length)}${tail}`
    suffix += 1
  }
  return candidate
}

function cleanupExpired() {
  const now = Date.now()
  for (const [key, value] of oidcStates.entries()) {
    if (now - value.createdAt > STATE_TTL_MS) oidcStates.delete(key)
  }
  for (const [key, value] of pendingSessions.entries()) {
    if (now - value.createdAt > SESSION_CODE_TTL_MS) pendingSessions.delete(key)
  }
}

function randomToken() {
  return base64Url(randomBytes(32))
}

function base64Url(value: Buffer) {
  return value.toString('base64url')
}

function hashShort(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 10)
}
