export interface NotificationChannelResult {
  channel: string
  delivered: boolean
  code?: string
}

export const NOTIFICATION_ERRORS = {
  ntfy_configuration: 'Check the ntfy topic URL, access token and encryption key.',
  ntfy_connection: 'Cannot deliver to ntfy. Check the URL, network access and TLS certificate.',
  ntfy_timeout: 'ntfy timed out. Try again later.',
  ntfy_rejection: 'ntfy rejected the message. Check topic permissions and authentication.',
  ntfy_rate_limit: 'ntfy rate limit reached. Try again later.',
  notification_delivery: 'Notification delivery failed. Check the configured channels.',
} as const

export class NotificationDeliveryError extends Error {
  constructor(readonly code: keyof typeof NOTIFICATION_ERRORS, readonly channels: NotificationChannelResult[] = []) {
    super(NOTIFICATION_ERRORS[code])
    this.name = 'NotificationDeliveryError'
  }
}
