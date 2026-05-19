import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { createId } from '../lib/ids.js'
import { asObject, optionalString, requiredString } from '../lib/validation.js'

export const roomsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>('/', async (req) => {
    if (req.query.labId) {
      return db.prepare('SELECT * FROM rooms WHERE labId = ? ORDER BY name, id').all(req.query.labId)
    }
    return db.prepare('SELECT * FROM rooms ORDER BY name, id').all()
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id)
    if (!row) return reply.status(404).send({ error: 'Room not found' })
    return row
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const roomId = optionalString(body, 'id', { maxLength: 80 }) ?? createId('room')
    const labId = requiredString(body, 'labId', { maxLength: 80 })
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
    const existing = db.prepare('SELECT id FROM rooms WHERE id = ?').get(req.params.id)
    if (!existing) return reply.status(404).send({ error: 'Room not found' })

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
    const row = db.prepare('SELECT id FROM rooms WHERE id = ?').get(req.params.id)
    if (!row) return reply.status(404).send({ error: 'Room not found' })
    db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })
}
