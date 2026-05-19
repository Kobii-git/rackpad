import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { createId } from '../lib/ids.js'
import { asObject, optionalInteger, optionalString, requiredString, ValidationError } from '../lib/validation.js'

function validateRoom(roomId: string | null | undefined, labId: string) {
  if (!roomId) return null
  const room = db.prepare('SELECT labId FROM rooms WHERE id = ?').get(roomId) as { labId: string } | undefined
  if (!room) {
    throw new ValidationError('Selected room does not exist.')
  }
  if (room.labId !== labId) {
    throw new ValidationError('Selected room must belong to the same lab.')
  }
  return roomId
}

export const racksRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>('/', async (req) => {
    if (req.query.labId) {
      return db.prepare('SELECT * FROM racks WHERE labId = ? ORDER BY name').all(req.query.labId)
    }
    return db.prepare('SELECT * FROM racks ORDER BY name').all()
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM racks WHERE id = ?').get(req.params.id)
    if (!row) return reply.status(404).send({ error: 'Rack not found' })
    return row
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const rackId = optionalString(body, 'id', { maxLength: 80 }) ?? createId('rack')
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    const name = requiredString(body, 'name', { maxLength: 120 })
    const totalU = optionalInteger(body, 'totalU', { min: 1, max: 100 }) ?? 42
    const description = optionalString(body, 'description', { maxLength: 500 })
    const location = optionalString(body, 'location', { maxLength: 200 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })
    const roomId = validateRoom(optionalString(body, 'roomId', { maxLength: 80 }), labId)

    db.prepare(
      'INSERT INTO racks (id, labId, name, totalU, description, location, notes, roomId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(rackId, labId, name, totalU, description ?? null, location ?? null, notes ?? null, roomId)
    return reply.status(201).send(db.prepare('SELECT * FROM racks WHERE id = ?').get(rackId))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = db.prepare('SELECT * FROM racks WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!existing) return reply.status(404).send({ error: 'Rack not found' })

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const name = optionalString(body, 'name', { maxLength: 120 })
    const totalU = optionalInteger(body, 'totalU', { min: 1, max: 100 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const location = optionalString(body, 'location', { maxLength: 200 })
    const notes = optionalString(body, 'notes', { maxLength: 2000 })
    const roomId = optionalString(body, 'roomId', { maxLength: 80 })

    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (totalU !== undefined) { updates.push('totalU = ?'); values.push(totalU) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }
    if (location !== undefined) { updates.push('location = ?'); values.push(location) }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes) }
    if (roomId !== undefined) { updates.push('roomId = ?'); values.push(validateRoom(roomId, String(existing.labId))) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields to update' })

    values.push(req.params.id)
    db.prepare(`UPDATE racks SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM racks WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare('SELECT id FROM racks WHERE id = ?').get(req.params.id)
    if (!row) return reply.status(404).send({ error: 'Rack not found' })
    db.prepare('DELETE FROM racks WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })
}
