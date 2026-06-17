import { randomBytes } from 'node:crypto'

export function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${randomBytes(6).toString('base64url')}`
}
