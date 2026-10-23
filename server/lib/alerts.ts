import nodemailer from 'nodemailer'
import { encryptNtfyToken, validateNtfyConfiguration, sendNtfyAlert } from './ntfy.js'
import { NotificationDeliveryError, type NotificationChannelResult } from './notification-delivery.js'
import type { AlertKind, PendingAlertState } from './notification-state.js'
import { SmtpDeliveryError, smtpDeliveryError } from './smtp-error.js'
import { db } from '../db.js'
import { createId } from './ids.js'
import { getJsonSetting, putJsonSetting } from './app-settings.js'
import { requestPinnedUrl } from './net-guard.js'

export interface AlertSettings {
  ntfyTopicUrl: string | null
  ntfyTokenConfigured: boolean
  enabled: boolean
  notifyOnDown: boolean
  notifyOnRecovery: boolean
  repeatWhileOffline: boolean
  repeatIntervalMinutes: number
  discordWebhookUrl: string | null
  telegramBotToken: string | null
  telegramChatId: string | null
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: boolean
  smtpUsername: string | null
  smtpPassword: string | null
  smtpFrom: string | null
  smtpTo: string | null
}

export interface MonitorAlertPayload {
  deviceId: string
  monitorId: string
  hostname: string
  displayName?: string | null
  deviceType?: string | null
  managementIp?: string | null
  monitorName?: string | null
  monitorType: string
  target?: string | null
  result: 'online' | 'offline' | 'unknown'
  message: string
  checkedAt: string
}

interface StoredAlertSettings extends Omit<AlertSettings, 'ntfyTokenConfigured'> {
  ntfyTokenEnc: string | null
}

interface AlertDispatchResult {
  delivered: boolean
  channels: NotificationChannelResult[]
}

const ALERT_SETTINGS_KEY = 'alertSettings'

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  ntfyTopicUrl: null,
  ntfyTokenConfigured: false,
  enabled: false,
  notifyOnDown: true,
  notifyOnRecovery: true,
  repeatWhileOffline: false,
  repeatIntervalMinutes: 60,
  discordWebhookUrl: null,
  telegramBotToken: null,
  telegramChatId: null,
  smtpHost: null,
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: null,
  smtpPassword: null,
  smtpFrom: null,
  smtpTo: null,
}

function loadStoredAlertSettings(): StoredAlertSettings {
  const settings = getJsonSetting<Partial<StoredAlertSettings>>(ALERT_SETTINGS_KEY, {})
  return {
    ...normalizeAlertSettings(settings),
    ntfyTokenEnc: typeof settings.ntfyTokenEnc === 'string' ? settings.ntfyTokenEnc : null,
  }
}

function publicAlertSettings(settings: StoredAlertSettings): AlertSettings {
  const { ntfyTokenEnc, ...publicSettings } = settings
  return { ...publicSettings, ntfyTokenConfigured: Boolean(ntfyTokenEnc) }
}

export function loadAlertSettings() {
  return publicAlertSettings(loadStoredAlertSettings())
}

export const saveAlertSettings = db.transaction((value: Partial<AlertSettings> & { ntfyToken?: string | null }) => {
  const current = loadStoredAlertSettings()
  const supplied = { ...value }
  if (supplied.ntfyTopicUrl === undefined) delete supplied.ntfyTopicUrl
  const next = normalizeAlertSettings({ ...current, ...supplied })
  const ntfyTokenEnc = value.ntfyToken === undefined ? current.ntfyTokenEnc :
    value.ntfyToken === null ? null : encryptNtfyToken(value.ntfyToken)
  validateNtfyConfiguration(next.ntfyTopicUrl, Boolean(ntfyTokenEnc))
  const stored: StoredAlertSettings = { ...next, ntfyTokenEnc }
  putJsonSetting(ALERT_SETTINGS_KEY, stored)
  // Disabling a category must invalidate an in-flight event immediately.
  if (!stored.enabled) db.prepare('UPDATE deviceMonitors SET pendingAlertKind=NULL, pendingAlertAt=NULL, lastAlertAttemptAt=NULL').run()
  else {
    if (!stored.notifyOnDown) db.prepare("UPDATE deviceMonitors SET pendingAlertKind=NULL, pendingAlertAt=NULL, lastAlertAttemptAt=NULL WHERE pendingAlertKind IN ('down','repeat')").run()
    else if (!stored.repeatWhileOffline) db.prepare("UPDATE deviceMonitors SET pendingAlertKind=NULL, pendingAlertAt=NULL, lastAlertAttemptAt=NULL WHERE pendingAlertKind='repeat'").run()
    if (!stored.notifyOnRecovery) db.prepare("UPDATE deviceMonitors SET pendingAlertKind=NULL, pendingAlertAt=NULL, lastAlertAttemptAt=NULL WHERE pendingAlertKind='recovery'").run()
  }
  return publicAlertSettings(stored)
})

export async function sendTestAlert(actor = 'system') {
  const settings = loadStoredAlertSettings()
  if (!settings.enabled) {
    throw new Error('Enable notifications before sending a test alert.')
  }

  try {
    const result = await dispatchAlert(
      settings,
      [
        'Rackpad test alert',
        '',
        'This confirms notification delivery is working for your configured alert channels.',
        `Sent at: ${new Date().toISOString()}`,
      ].join('\n'),
    )

    recordAlertAudit({
      action: 'alert.test',
      actor,
      summary: `Test alert ${result.delivered ? 'delivered' : 'attempted'} via ${formatChannelList(result.channels)}`,
    })

    return result
  } catch (error) {
    recordAlertAudit({
      action: 'alert.error',
      actor,
      summary: `Test alert failed: ${error instanceof Error ? truncate(error.message, 260) : 'Unknown error'}`,
    })
    if (error instanceof SmtpDeliveryError) console.error('[rackpad] SMTP test failed', error.category)
    throw error
  }
}

const activeMonitorDeliveries = new Set<string>()
let notificationEpoch = 0

/** Restoring a logical backup invalidates async completions from its old state. */
export function invalidateNotificationAttempts() { notificationEpoch++ }

export async function sendMonitorTransitionAlert(
  previousResult: string | null | undefined,
  _previousAlertAt: string | null | undefined,
  payload: MonitorAlertPayload,
) {
  const settings = loadStoredAlertSettings()
  const row = db.prepare('SELECT * FROM deviceMonitors WHERE id=?').get(payload.monitorId) as
    (PendingAlertState & { intervalMs: number | null; lastAlertAt: string | null; lastCheckAt: string | null; enabled: number }) | undefined
  if (!row) return null
  // A newer observation has already superseded this callback.
  if (row.lastCheckAt && row.lastCheckAt !== payload.checkedAt) return null
  let kind = row.pendingAlertKind
  let eventAt = row.pendingAlertAt
  let attemptAt = row.lastAlertAttemptAt
  const setEvent = (next: AlertKind | null) => {
    kind = next; eventAt = next ? payload.checkedAt : null; attemptAt = null
  }
  if (!settings.enabled || !row.enabled) setEvent(null)
  else {
    if (payload.result === 'offline' && previousResult !== 'offline' &&
      !(previousResult === 'unknown' && (kind === 'down' || kind === 'repeat'))) {
      setEvent(settings.notifyOnDown ? 'down' : null)
    } else if (payload.result === 'online' &&
      (previousResult === 'offline' || kind === 'down' || kind === 'repeat')) {
      setEvent(settings.notifyOnRecovery ? 'recovery' : null)
    }
    if ((kind === 'down' || kind === 'repeat') && !settings.notifyOnDown ||
      kind === 'repeat' && !settings.repeatWhileOffline ||
      kind === 'recovery' && !settings.notifyOnRecovery) setEvent(null)
    if (!kind && payload.result === 'offline' && settings.notifyOnDown &&
      settings.repeatWhileOffline && row.lastAlertAt &&
      minutesSince(row.lastAlertAt, payload.checkedAt) >= settings.repeatIntervalMinutes) setEvent('repeat')
  }
  db.prepare('UPDATE deviceMonitors SET pendingAlertKind=?, pendingAlertAt=?, lastAlertAttemptAt=? WHERE id=?')
    .run(kind, eventAt, attemptAt, payload.monitorId)
  if (!kind || !eventAt || payload.result === 'unknown' ||
    (kind === 'recovery' ? payload.result !== 'online' : payload.result !== 'offline') ||
    activeMonitorDeliveries.has(payload.monitorId)) return null
  const minimumInterval = Math.max(row.intervalMs ?? 60000, 60000)
  if (attemptAt && Date.parse(payload.checkedAt) - Date.parse(attemptAt) < minimumInterval) return null
  const epoch = notificationEpoch
  const selectedKind = kind
  const selectedAt = eventAt
  activeMonitorDeliveries.add(payload.monitorId)
  db.prepare('UPDATE deviceMonitors SET lastAlertAttemptAt=? WHERE id=?').run(payload.checkedAt, payload.monitorId)
  const stillCurrent = () => epoch === notificationEpoch && Boolean(db.prepare(`SELECT id FROM deviceMonitors
    WHERE id=? AND pendingAlertKind=? AND pendingAlertAt=? AND lastAlertAttemptAt=? AND enabled=1`)
    .get(payload.monitorId, selectedKind, selectedAt, payload.checkedAt))

  const heading =
    kind === 'recovery'
      ? 'Rackpad recovery alert'
      : kind === 'repeat'
        ? 'Rackpad outage reminder'
        : 'Rackpad outage alert'
  const monitorLabel = payload.monitorName
    ? `${payload.monitorName} (${payload.monitorType}${payload.target ? ` -> ${payload.target}` : ''})`
    : `${payload.monitorType}${payload.target ? ` -> ${payload.target}` : ''}`
  const details = [
    heading,
    '',
    `${payload.hostname}${payload.displayName ? ` (${payload.displayName})` : ''}`,
    `Type: ${payload.deviceType ?? 'device'}`,
    `Monitor: ${monitorLabel}`,
    `Management IP: ${payload.managementIp ?? 'n/a'}`,
    `Result: ${payload.result}`,
    `Message: ${payload.message}`,
    `Checked at: ${payload.checkedAt}`,
  ]

  try {
    const dispatch = await dispatchAlert(settings, details.join('\n'))
    if (!stillCurrent()) return null
    db.prepare(`UPDATE deviceMonitors SET lastAlertAt=?, pendingAlertKind=NULL,
      pendingAlertAt=NULL, lastAlertAttemptAt=NULL WHERE id=?`).run(payload.checkedAt, payload.monitorId)
    recordAlertAudit({
      action: kind === 'recovery' ? 'alert.recovery' : kind === 'repeat' ? 'alert.repeat' : 'alert.down',
      actor: 'system',
      summary: `${heading} for ${payload.hostname} / ${payload.monitorName ?? payload.monitorType} delivered via ${formatChannelList(dispatch.channels)}${dispatch.channels.some(channel => !channel.delivered) ? '; some channels failed' : ''}`,
    })
    return dispatch
  } catch (error) {
    if (!stillCurrent()) return null
    recordAlertAudit({ action: 'alert.error', actor: 'system',
      summary: `Alert delivery failed for ${payload.hostname} / ${payload.monitorName ?? payload.monitorType}: ${error instanceof Error ? error.message : 'Unknown error'}` })
    console.error('[rackpad] failed to send alert notification', error instanceof SmtpDeliveryError ? error.category : error instanceof NotificationDeliveryError ? error.code : 'notification_delivery')
    return null
  } finally {
    activeMonitorDeliveries.delete(payload.monitorId)
  }
}

function normalizeAlertSettings(value: Partial<AlertSettings>): Omit<AlertSettings, 'ntfyTokenConfigured'> {
  return {
    ntfyTopicUrl: normalizeText(value.ntfyTopicUrl),
    enabled: Boolean(value.enabled),
    notifyOnDown: value.notifyOnDown ?? true,
    notifyOnRecovery: value.notifyOnRecovery ?? true,
    repeatWhileOffline: value.repeatWhileOffline ?? false,
    repeatIntervalMinutes: normalizePositiveInteger(value.repeatIntervalMinutes, 60),
    discordWebhookUrl: normalizeText(value.discordWebhookUrl),
    telegramBotToken: normalizeText(value.telegramBotToken),
    telegramChatId: normalizeText(value.telegramChatId),
    smtpHost: normalizeText(value.smtpHost),
    smtpPort: normalizePort(value.smtpPort, 587),
    smtpSecure: Boolean(value.smtpSecure),
    smtpUsername: normalizeText(value.smtpUsername),
    smtpPassword: normalizeText(value.smtpPassword),
    smtpFrom: normalizeText(value.smtpFrom),
    smtpTo: normalizeText(value.smtpTo),
  }
}

function normalizeText(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.trim()
  return normalized || null
}

function normalizePositiveInteger(value: number | null | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return fallback
  return value
}

function normalizePort(value: number | null | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) return fallback
  return value
}

async function dispatchAlert(settings: StoredAlertSettings, message: string): Promise<AlertDispatchResult> {
  const tasks: Array<{ channel: string; task: Promise<{ channel: string; delivered: boolean }> }> = []

  if (settings.discordWebhookUrl) {
    tasks.push({ channel: 'discord', task: sendDiscordAlert(settings.discordWebhookUrl, message) })
  }

  if (settings.telegramBotToken && settings.telegramChatId) {
    tasks.push({ channel: 'telegram', task: sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, message) })
  }

  if (settings.smtpHost && settings.smtpFrom && settings.smtpTo) {
    tasks.push({ channel: 'email', task: sendEmailAlert(settings, message) })
  }

  if (settings.ntfyTopicUrl || settings.ntfyTokenEnc) {
    tasks.push({ channel: 'ntfy', task: sendNtfyAlert(settings.ntfyTopicUrl ?? '', settings.ntfyTokenEnc, message) })
  }

  if (tasks.length === 0) {
    if (settings.smtpHost || settings.smtpFrom || settings.smtpTo) throw new SmtpDeliveryError('configuration')
    throw new NotificationDeliveryError('notification_delivery')
  }

  const settled = await Promise.allSettled(tasks.map(entry => entry.task))
  const channels: NotificationChannelResult[] = settled.map((result, index) => {
    if (result.status === 'fulfilled') return result.value
    const error: unknown = result.reason
    const code = error instanceof SmtpDeliveryError ? `smtp_${error.category}` :
      error instanceof NotificationDeliveryError ? error.code : 'notification_delivery'
    return { channel: tasks[index].channel, delivered: false, code }
  })
  if (!channels.some(channel => channel.delivered)) {
    const only = settled[0]
    if (settled.length === 1 && only.status === 'rejected' && only.reason instanceof SmtpDeliveryError) {
      throw Object.assign(only.reason, { channels })
    }
    if (settled.length === 1 && only.status === 'rejected' && only.reason instanceof NotificationDeliveryError) {
      throw new NotificationDeliveryError(only.reason.code, channels)
    }
    throw new NotificationDeliveryError('notification_delivery', channels)
  }
  return { delivered: true, channels }
}

async function sendDiscordAlert(webhookUrl: string, content: string) {
  const response = await requestPinnedUrl(new URL(webhookUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    timeoutMs: 8000,
  })

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Discord webhook failed with status ${response.statusCode}.`)
  }

  return { channel: 'discord', delivered: true }
}

async function sendTelegramAlert(botToken: string, chatId: string, text: string) {
  const response = await requestPinnedUrl(new URL(`https://api.telegram.org/bot${botToken}/sendMessage`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
    timeoutMs: 8000,
  })

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Telegram sendMessage failed with status ${response.statusCode}.`)
  }

  return { channel: 'telegram', delivered: true }
}

async function sendEmailAlert(settings: StoredAlertSettings, text: string) {
  try {
    if (!settings.smtpHost || !settings.smtpFrom || !settings.smtpTo) {
      throw new SmtpDeliveryError('configuration')
    }

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort ?? (settings.smtpSecure ? 465 : 587),
      secure: settings.smtpSecure,
      auth:
        settings.smtpUsername || settings.smtpPassword
          ? {
              user: settings.smtpUsername ?? '',
              pass: settings.smtpPassword ?? '',
            }
          : undefined,
    })

    const recipients = splitRecipients(settings.smtpTo)
    if (recipients.length === 0) {
      throw new SmtpDeliveryError('configuration')
    }

    await transporter.sendMail({
      from: settings.smtpFrom,
      to: recipients.join(', '),
      subject: firstLine(text) ?? 'Rackpad alert',
      text,
    })

    return { channel: 'email', delivered: true }
  } catch (error) {
    throw smtpDeliveryError(error)
  }
}

function splitRecipients(value: string) {
  return value
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function firstLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

function minutesSince(isoTimestamp: string | null | undefined, now: string) {
  if (!isoTimestamp) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(isoTimestamp)
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY
  return (Date.parse(now) - parsed) / 60000
}

function formatChannelList(channels: NotificationChannelResult[]) {
  const delivered = channels.filter((channel) => channel.delivered).map((channel) => channel.channel)
  const attempted = channels.map((channel) => channel.channel)
  return (delivered.length > 0 ? delivered : attempted).join(', ')
}

function recordAlertAudit(input: { action: string; actor: string; summary: string }) {
  db.prepare(`
    INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    createId('a'),
    new Date().toISOString(),
    input.actor,
    input.action,
    'Alert',
    createId('alert'),
    truncate(input.summary, 500),
  )
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}
