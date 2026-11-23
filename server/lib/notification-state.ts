import { ValidationError } from './validation.js'

export const PENDING_ALERT_FIELDS = ['pendingAlertKind', 'pendingAlertAt', 'lastAlertAttemptAt'] as const
export type AlertKind = 'down' | 'recovery' | 'repeat'
export interface PendingAlertState {
  pendingAlertKind: AlertKind | null
  pendingAlertAt: string | null
  lastAlertAttemptAt: string | null
}

/** One validator for logical restore and native snapshots, with legacy defaults. */
export function parsePendingAlertState(row: Record<string, unknown>): PendingAlertState {
  const kind = row.pendingAlertKind ?? null
  const at = row.pendingAlertAt ?? null
  const attempt = row.lastAlertAttemptAt ?? null
  const timestamp = (value: unknown) => typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  if (kind === null ? at !== null || attempt !== null :
    typeof kind !== 'string' || !['down', 'recovery', 'repeat'].includes(kind) || !timestamp(at) ||
    (attempt !== null && (!timestamp(attempt) || String(attempt) < String(at)))) {
    throw new ValidationError('Invalid pending notification state.')
  }
  return { pendingAlertKind: kind as AlertKind | null, pendingAlertAt: at as string | null, lastAlertAttemptAt: attempt as string | null }
}
