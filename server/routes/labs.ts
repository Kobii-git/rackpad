import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { requireAdmin } from '../lib/auth.js'
import {
  assertLabRead,
  resolveLabIdsForList,
  appendLabFilter,
} from '../lib/lab-access.js'
import { createId } from '../lib/ids.js'
import { asObject, optionalString, requiredString } from '../lib/validation.js'

export const labsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [])
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    let sql = 'SELECT * FROM labs'
    const { sql: nextSql, params } = appendLabFilter(sql, [], filter.labIds, 'id')
    return db.prepare(`${nextSql} ORDER BY name`).all(...params)
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM labs WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined
    if (!row) return reply.status(404).send({ error: 'Lab not found.' })
    if (!assertLabRead(req, reply, req.params.id)) return
    return row
  })

  app.post('/', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('lab')
    const name = requiredString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const location = optionalString(body, 'location', { maxLength: 200 })

    const createLab = db.transaction(() => {
      db.prepare(`
        INSERT INTO labs (id, name, description, location)
        VALUES (?, ?, ?, ?)
      `).run(id, name, description ?? null, location ?? null)

      const nonAdminUsers = db
        .prepare("SELECT id, role FROM users WHERE role != 'admin'")
        .all() as Array<{ id: string; role: string }>
      const insertAccess = db.prepare(
        'INSERT INTO userLabAccess (userId, labId, role) VALUES (?, ?, ?)',
      )
      for (const user of nonAdminUsers) {
        const role = user.role === 'viewer' ? 'viewer' : 'editor'
        insertAccess.run(user.id, id, role)
      }
    })

    createLab()

    return reply.status(201).send(db.prepare('SELECT * FROM labs WHERE id = ?').get(id))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const existing = db.prepare('SELECT * FROM labs WHERE id = ?').get(req.params.id)
    if (!existing) return reply.status(404).send({ error: 'Lab not found.' })

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const name = optionalString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const location = optionalString(body, 'location', { maxLength: 200 })

    if (name !== undefined) {
      updates.push('name = ?')
      values.push(name)
    }
    if (description !== undefined) {
      updates.push('description = ?')
      values.push(description)
    }
    if (location !== undefined) {
      updates.push('location = ?')
      values.push(location)
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No valid fields to update.' })
    }

    values.push(req.params.id)
    db.prepare(`UPDATE labs SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM labs WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return

    const existing = db.prepare('SELECT id FROM labs WHERE id = ?').get(req.params.id)
    if (!existing) return reply.status(404).send({ error: 'Lab not found.' })

    const countRow = db.prepare('SELECT COUNT(*) AS count FROM labs').get() as { count: number }
    if (countRow.count <= 1) {
      return reply.status(409).send({ error: 'Rackpad must keep at least one lab.' })
    }

    db.prepare('DELETE FROM labs WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })
}
