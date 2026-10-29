import { decryptSecret, encryptSecret } from './secret-crypto.js'
import { requestPinnedUrlWithBody } from './net-guard.js'
import { NotificationDeliveryError } from './notification-delivery.js'
import { ValidationError } from './validation.js'

export function validateNtfyConfiguration(topic: string | null, hasToken: boolean) {
  if (!topic) {
    if (hasToken) throw new ValidationError('An ntfy topic URL is required when a token is configured.')
    return
  }
  let url: URL
  try { url = new URL(topic) } catch { throw new ValidationError('Invalid ntfy topic URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.search || url.hash || url.pathname === '/' || (hasToken && url.protocol !== 'https:')) {
    throw new ValidationError('Use an HTTP/HTTPS ntfy topic URL without credentials, query or fragment; tokens require HTTPS.')
  }
}

export function encryptNtfyToken(token: string) {
  if (!token.trim() || /[\r\n]/.test(token)) throw new ValidationError('Invalid ntfy access token.')
  try { return encryptSecret(token.trim()) } catch {
    throw new ValidationError('Configure RACKPAD_SECRET_KEY before saving an ntfy access token.')
  }
}

export async function sendNtfyAlert(topic: string, tokenEnc: string | null, message: string) {
  let token: string | null = null
  try {
    validateNtfyConfiguration(topic, Boolean(tokenEnc))
    if (tokenEnc) token = decryptSecret(tokenEnc)
    if (token !== null && (!token.trim() || /[\r\n]/.test(token))) throw new Error('Invalid token')
  } catch { throw new NotificationDeliveryError('ntfy_configuration') }
  try {
    // Topic names and response bodies can be sensitive. Never retain raw errors.
    const response = await requestPinnedUrlWithBody(new URL(topic), {
      method: 'POST', timeoutMs: 8000, maxRedirects: 0, maxResponseBytes: 8192,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: truncateNtfyMessage(message),
    })
    if (response.statusCode === 429) throw new NotificationDeliveryError('ntfy_rate_limit')
    if (response.statusCode < 200 || response.statusCode >= 300) throw new NotificationDeliveryError('ntfy_rejection')
    return { channel: 'ntfy', delivered: true }
  } catch (error) {
    if (error instanceof NotificationDeliveryError) throw error
    throw new NotificationDeliveryError(error instanceof Error && /timed? ?out|timeout/i.test(error.message) ? 'ntfy_timeout' : 'ntfy_connection')
  }
}

/** Avoid splitting a UTF-8 code point at ntfy's 4096-byte message limit. */
function truncateNtfyMessage(message: string) {
  const encoded = Buffer.from(message)
  let end = Math.min(encoded.length, 4096)
  while (end < encoded.length && (encoded[end] & 0xc0) === 0x80) end--
  return encoded.subarray(0, end).toString('utf8')
}
