import nodemailer from 'nodemailer'
import { db } from '../db.js'
import { createId } from './ids.js'
import { getJsonSetting, putJsonSetting } from './app-settings.js'
import { requestPinnedUrl } from './net-guard.js'

export interface AlertSettings {
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

interface AlertDispatchResult {
  delivered: boolean
  channels: Array<{ channel: string; delivered: boolean }>
}

const ALERT_SETTINGS_KEY = 'alertSettings'

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
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

export function loadAlertSettings() {
  const settings = getJsonSetting(ALERT_SETTINGS_KEY, DEFAULT_ALERT_SETTINGS)
  return normalizeAlertSettings(settings)
}

export function saveAlertSettings(value: Partial<AlertSettings>) {
  const next = normalizeAlertSettings({
    ...loadAlertSettings(),
    ...value,
  })
  putJsonSetting(ALERT_SETTINGS_KEY, next)
  return next
}

export async function sendTestAlert(actor = 'system') {
  const settings = loadAlertSettings()
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
    throw error
  }
}

export async function sendMonitorTransitionAlert(
  previousResult: string | null | undefined,
  previousAlertAt: string | null | undefined,
  payload: MonitorAlertPayload,
) {
  const settings = loadAlertSettings()
  if (!settings.enabled) return null

  const shouldNotifyDown = settings.notifyOnDown && payload.result === 'offline' && previousResult !== 'offline'
  const shouldRetryUnsentDown =
    settings.notifyOnDown &&
    payload.result === 'offline' &&
    previousResult === 'offline' &&
    !previousAlertAt
  const shouldNotifyRecovery =
    settings.notifyOnRecovery &&
    previousResult === 'offline' &&
    payload.result === 'online'
  const shouldNotifyRepeat =
    settings.notifyOnDown &&
    settings.repeatWhileOffline &&
    payload.result === 'offline' &&
    previousResult === 'offline' &&
    minutesSince(previousAlertAt) >= settings.repeatIntervalMinutes

  if (!shouldNotifyDown && !shouldRetryUnsentDown && !shouldNotifyRecovery && !shouldNotifyRepeat) {
    return null
  }

  const kind = shouldNotifyRecovery
    ? 'recovery'
    : shouldNotifyRepeat && previousAlertAt
      ? 'repeat'
      : 'down'

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
    db.prepare('UPDATE deviceMonitors SET lastAlertAt = ? WHERE id = ?').run(payload.checkedAt, payload.monitorId)

    recordAlertAudit({
      action: kind === 'recovery' ? 'alert.recovery' : kind === 'repeat' ? 'alert.repeat' : 'alert.down',
      actor: 'system',
      summary: `${heading} for ${payload.hostname} / ${payload.monitorName ?? payload.monitorType} ${dispatch.delivered ? `delivered via ${formatChannelList(dispatch.channels)}` : 'attempted with no successful delivery'}`,
    })

    return dispatch
  } catch (error) {
    db.prepare('UPDATE deviceMonitors SET lastAlertAt = ? WHERE id = ?').run(payload.checkedAt, payload.monitorId)
    recordAlertAudit({
      action: 'alert.error',
      actor: 'system',
      summary: `Alert delivery failed for ${payload.hostname} / ${payload.monitorName ?? payload.monitorType}: ${error instanceof Error ? truncate(error.message, 260) : 'Unknown error'}`,
    })
    console.error('[rackpad] failed to send alert notification', error)
    return null
  }
}

function normalizeAlertSettings(value: Partial<AlertSettings> | AlertSettings): AlertSettings {
  return {
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

async function dispatchAlert(settings: AlertSettings, message: string): Promise<AlertDispatchResult> {
  const tasks: Promise<{ channel: string; delivered: boolean }>[] = []

  if (settings.discordWebhookUrl) {
    tasks.push(sendDiscordAlert(settings.discordWebhookUrl, message))
  }

  if (settings.telegramBotToken && settings.telegramChatId) {
    tasks.push(sendTelegramAlert(settings.telegramBotToken, settings.telegramChatId, message))
  }

  if (settings.smtpHost && settings.smtpFrom && settings.smtpTo) {
    tasks.push(sendEmailAlert(settings, message))
  }

  if (tasks.length === 0) {
    throw new Error('Configure at least one notification target first.')
  }

  const results = await Promise.all(tasks)
  return {
    delivered: results.some((result) => result.delivered),
    channels: results,
  }
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

async function sendEmailAlert(settings: AlertSettings, text: string) {
  if (!settings.smtpHost || !settings.smtpFrom || !settings.smtpTo) {
    throw new Error('SMTP host, from, and recipient fields are required for email alerts.')
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
    throw new Error('Add at least one SMTP recipient before sending email alerts.')
  }

  await transporter.sendMail({
    from: settings.smtpFrom,
    to: recipients.join(', '),
    subject: firstLine(text) ?? 'Rackpad alert',
    text,
  })

  return { channel: 'email', delivered: true }
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

function minutesSince(isoTimestamp: string | null | undefined) {
  if (!isoTimestamp) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(isoTimestamp)
  if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY
  return (Date.now() - parsed) / 60000
}

function formatChannelList(channels: Array<{ channel: string; delivered: boolean }>) {
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
