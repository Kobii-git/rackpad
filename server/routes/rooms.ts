import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import {
  appendLabFilter,
  assertLabReadFromRow,
  assertLabWrite,
  assertLabWriteFromRow,
  resolveLabIdsForList,
} from '../lib/lab-access.js'
import { createId } from '../lib/ids.js'
import { asObject, optionalString, requiredString } from '../lib/validation.js'

export const roomsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>('/', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    const { sql, params } = appendLabFilter('SELECT * FROM rooms', [], filter.labIds)
    return db.prepare(`${sql} ORDER BY name, id`).all(...params)
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined
    if (!assertLabReadFromRow(req, reply, row)) return
    return row
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const roomId = optionalString(body, 'id', { maxLength: 80 }) ?? createId('room')
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    if (!assertLabWrite(req, reply, labId)) return

    const name = requiredString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const location = optionalString(body, 'location', { maxLength: 200 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    db.prepare(`
      INSERT INTO rooms (id, labId, name, description, location, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(roomId, labId, name, description ?? null, location ?? null, notes ?? null)

    return reply.status(201).send(db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined
    if (!assertLabWriteFromRow(req, reply, existing)) return

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const name = optionalString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const location = optionalString(body, 'location', { maxLength: 200 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })

    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }
    if (location !== undefined) { updates.push('location = ?'); values.push(location) }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields to update' })

    values.push(req.params.id)
    db.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined
    if (!assertLabWriteFromRow(req, reply, row)) return

    const removeRoom = db.transaction(() => {
      db.prepare("DELETE FROM referenceImages WHERE entityType = 'room' AND entityId = ?").run(req.params.id)
      db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id)
    })
    removeRoom()
    return reply.status(204).send()
  })
}
