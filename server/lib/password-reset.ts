import { db } from '../db.js'
import { hashPassword } from './auth.js'
import { createId } from './ids.js'
import { ValidationError } from './validation.js'

export interface LocalPasswordResetResult {
  userId: string
  username: string
  sessionsInvalidated: number
}

interface UserPasswordRow {
  id: string
  username: string
  passwordHash: string
  oidcUserId: string | null
}

export function resetLocalUserPassword(input: {
  username: string
  password: string
  actor?: string
}): LocalPasswordResetResult {
  const username = input.username.trim().toLowerCase()
  if (!username) {
    throw new ValidationError('Username is required.')
  }

  const password = input.password
  if (password.length < 10) {
    throw new ValidationError('Password must be at least 10 characters long.')
  }
  if (password.length > 200) {
    throw new ValidationError('Password must be 200 characters or fewer.')
  }

  const row = db
    .prepare(
      `
      SELECT
        u.id,
        u.username,
        u.passwordHash,
        oi.userId AS oidcUserId
      FROM users u
      LEFT JOIN oidcIdentities oi ON oi.userId = u.id
      WHERE u.username = ?
    `,
    )
    .get(username) as UserPasswordRow | undefined

  if (!row) {
    throw new ValidationError('User not found.', 404)
  }
  if (row.oidcUserId) {
    throw new ValidationError(
      'OIDC-backed users must reset passwords in the identity provider.',
      409,
    )
  }
  if (!row.passwordHash.startsWith('scrypt:')) {
    throw new ValidationError(
      'Only local password accounts can be reset by this command.',
      409,
    )
  }

  const now = new Date().toISOString()
  const reset = db.transaction(() => {
    db.prepare('UPDATE users SET passwordHash = ? WHERE id = ?').run(
      hashPassword(password),
      row.id,
    )
    const sessions = db
      .prepare('DELETE FROM userSessions WHERE userId = ?')
      .run(row.id)
    db.prepare(
      `
      INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      createId('a'),
      now,
      input.actor?.trim() || 'system',
      'user.password_reset.cli',
      'User',
      row.id,
      `Reset local password for ${row.username} from the Rackpad CLI.`,
    )
    return Number(sessions.changes ?? 0)
  })

  return {
    userId: row.id,
    username: row.username,
    sessionsInvalidated: reset(),
  }
}
