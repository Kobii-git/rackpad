import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { hashPassword, parsePublicUser, requireAdmin, USER_ROLES } from '../lib/auth.js'
import { createId } from '../lib/ids.js'
import {
  asObject,
  optionalBoolean,
  optionalString,
  requiredEnum,
  requiredString,
  ValidationError,
} from '../lib/validation.js'

function auditUserChange(actor: string, action: string, entityId: string, summary: string) {
  db.prepare(`
    INSERT INTO auditLog (id, ts, user, action, entityType, entityId, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    createId('a'),
    new Date().toISOString(),
    actor,
    action,
    'User',
    entityId,
    summary,
  )
}

function userSelectSql(where = '') {
  return `
    SELECT
      u.id,
      u.username,
      u.displayName,
      u.role,
      u.disabled,
      u.createdAt,
      u.lastLoginAt,
      CASE WHEN oi.userId IS NULL THEN 'local' ELSE 'oidc' END AS authProvider,
      oi.issuer AS oidcIssuer
    FROM users u
    LEFT JOIN (
      SELECT userId, MIN(issuer) AS issuer
      FROM oidcIdentities
      GROUP BY userId
    ) oi ON oi.userId = u.id
    ${where}
  `
}

function parseAdminUser(row: Record<string, unknown>) {
  return {
    ...parsePublicUser(row),
    authProvider: row.authProvider === 'oidc' ? 'oidc' : 'local',
    oidcIssuer: row.oidcIssuer ? String(row.oidcIssuer) : null,
  }
}

export const usersRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const rows = db.prepare(`${userSelectSql()} ORDER BY u.username`).all() as Record<string, unknown>[]
    return rows.map(parseAdminUser)
  })

  app.post('/', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const body = asObject(req.body)
    const username = requiredString(body, 'username', { maxLength: 40 }).toLowerCase()
    const displayName = optionalString(body, 'displayName', { maxLength: 80 }) ?? username
    const password = requiredString(body, 'password', { maxLength: 200 })
    const role = requiredEnum(body, 'role', USER_ROLES)
    const disabled = optionalBoolean(body, 'disabled') ?? false

    if (password.length < 10) {
      throw new ValidationError('Password must be at least 10 characters long.')
    }

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (exists) {
      return reply.status(409).send({ error: 'Username already exists.' })
    }

    const id = createId('u')
    const createdAt = new Date().toISOString()
    db.prepare(`
      INSERT INTO users (id, username, displayName, passwordHash, role, disabled, createdAt, lastLoginAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(id, username, displayName, hashPassword(password), role, disabled ? 1 : 0, createdAt)

    const row = db.prepare(userSelectSql('WHERE u.id = ?')).get(id) as Record<string, unknown>
    auditUserChange(req.authUser.username, 'user.create', id, `Created ${username} with role ${role}.`)

    return reply.status(201).send(parseAdminUser(row))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'User not found.' })
    }

    const current = db.prepare(`
      SELECT id, username, displayName, role, disabled
      FROM users
      WHERE id = ?
    `).get(req.params.id) as
      | { id: string; username: string; displayName: string; role: string; disabled: number }
      | undefined
    if (!current) {
      return reply.status(404).send({ error: 'User not found.' })
    }

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []
    const changeNotes: string[] = []

    const username = optionalString(body, 'username', { maxLength: 40 })
    if (username !== undefined) {
      // username is NOT NULL — reject explicit null/empty before the DB sees it
      if (!username) {
        return reply.status(400).send({ error: 'Username cannot be empty.' })
      }
      const normalized = username.toLowerCase()
      const conflict = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(normalized, req.params.id)
      if (conflict) {
        return reply.status(409).send({ error: 'Username already exists.' })
      }
      updates.push('username = ?')
      values.push(normalized)
      if (normalized !== current.username) {
        changeNotes.push(`username ${current.username} -> ${normalized}`)
      }
    }

    const displayName = optionalString(body, 'displayName', { maxLength: 80 })
    if (displayName !== undefined) {
      // displayName is NOT NULL — same guard
      if (!displayName) {
        return reply.status(400).send({ error: 'Display name cannot be empty.' })
      }
      updates.push('displayName = ?')
      values.push(displayName)
      if (displayName !== current.displayName) {
        changeNotes.push('display name updated')
      }
    }

    if ('role' in body) {
      const nextRole = requiredEnum(body, 'role', USER_ROLES)
      updates.push('role = ?')
      values.push(nextRole)
      if (nextRole !== current.role) {
        changeNotes.push(`role ${current.role} -> ${nextRole}`)
      }
    }

    const disabled = optionalBoolean(body, 'disabled')
    if (disabled !== undefined) {
      updates.push('disabled = ?')
      values.push(disabled ? 1 : 0)
      if (Number(current.disabled ?? 0) !== (disabled ? 1 : 0)) {
        changeNotes.push(disabled ? 'account disabled' : 'account re-enabled')
      }
    }

    if ('password' in body) {
      const password = requiredString(body, 'password', { maxLength: 200 })
      if (password.length < 10) {
        throw new ValidationError('Password must be at least 10 characters long.')
      }
      updates.push('passwordHash = ?')
      values.push(hashPassword(password))
      changeNotes.push('password rotated')
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update.' })
    }

    values.push(req.params.id)
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    if ('password' in body || disabled === true) {
      db.prepare('DELETE FROM userSessions WHERE userId = ?').run(req.params.id)
    }

    const row = db.prepare(userSelectSql('WHERE u.id = ?')).get(req.params.id) as Record<string, unknown>
    auditUserChange(
      req.authUser.username,
      'user.update',
      req.params.id,
      changeNotes.length > 0 ? `Updated ${current.username}: ${changeNotes.join('; ')}.` : `Updated ${current.username}.`,
    )

    return parseAdminUser(row)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'User not found.' })
    }

    if (req.authUser.id === req.params.id) {
      return reply.status(400).send({ error: 'You cannot delete your own account.' })
    }

    const target = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id) as { username?: string } | undefined
    db.prepare('DELETE FROM userSessions WHERE userId = ?').run(req.params.id)
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
    auditUserChange(
      req.authUser.username,
      'user.delete',
      req.params.id,
      `Deleted ${target?.username ?? req.params.id}.`,
    )
    return reply.status(204).send()
  })
}
