import type { FastifyPluginAsync } from 'fastify'
import { db } from '../db.js'
import { createId } from '../lib/ids.js'
import { asObject, optionalString, requiredString } from '../lib/validation.js'

export const cablesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    return db.prepare('SELECT * FROM portLinks').all()
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM portLinks WHERE id = ?').get(req.params.id)
    if (!row) return reply.status(404).send({ error: 'Port link not found' })
    return row
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const fromPortId = requiredString(body, 'fromPortId', { maxLength: 80 })
    const toPortId = requiredString(body, 'toPortId', { maxLength: 80 })
    const cableType = optionalString(body, 'cableType', { maxLength: 80 })
    const cableLength = optionalString(body, 'cableLength', { maxLength: 40 })
    const color = optionalString(body, 'color', { maxLength: 40 })
    const notes = optionalString(body, 'notes', { maxLength: 500 })

    if (fromPortId === toPortId) {
      return reply.status(400).send({ error: 'A port cannot be linked to itself' })
    }

    const fromPort = db.prepare('SELECT id FROM ports WHERE id = ?').get(fromPortId)
    const toPort = db.prepare('SELECT id FROM ports WHERE id = ?').get(toPortId)
    if (!fromPort || !toPort) {
      return reply.status(400).send({ error: 'Both cable endpoints must exist' })
    }

    const existing = db.prepare(`
      SELECT id
      FROM portLinks
      WHERE fromPortId IN (?, ?) OR toPortId IN (?, ?)
      LIMIT 1
    `).get(fromPortId, toPortId, fromPortId, toPortId)
    if (existing) {
      return reply.status(409).send({ error: 'One of the selected ports is already linked' })
    }

    const id = createId('l')
    db.prepare(
      'INSERT INTO portLinks (id, fromPortId, toPortId, cableType, cableLength, color, notes) VALUES (?,?,?,?,?,?,?)'
    ).run(id, fromPortId, toPortId, cableType ?? null, cableLength ?? null, color ?? null, notes ?? null)

    db.prepare("UPDATE ports SET linkState = 'up' WHERE id = ? OR id = ?").run(fromPortId, toPortId)

    return reply.status(201).send(db.prepare('SELECT * FROM portLinks WHERE id = ?').get(id))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = db.prepare('SELECT * FROM portLinks WHERE id = ?').get(req.params.id) as
      | { id: string; fromPortId: string; toPortId: string }
      | undefined
    if (!existing) return reply.status(404).send({ error: 'Port link not found' })

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const fromPortId = optionalString(body, 'fromPortId', { maxLength: 80 })
    const toPortId = optionalString(body, 'toPortId', { maxLength: 80 })
    const cableType = optionalString(body, 'cableType', { maxLength: 80 })
    const cableLength = optionalString(body, 'cableLength', { maxLength: 40 })
    const color = optionalString(body, 'color', { maxLength: 40 })
    const notes = optionalString(body, 'notes', { maxLength: 500 })
    const nextFromPortId = fromPortId ?? existing.fromPortId
    const nextToPortId = toPortId ?? existing.toPortId

    if (fromPortId !== undefined || toPortId !== undefined) {
      if (nextFromPortId === nextToPortId) {
        return reply.status(400).send({ error: 'A port cannot be linked to itself' })
      }

      const fromPort = db.prepare('SELECT id FROM ports WHERE id = ?').get(nextFromPortId)
      const toPort = db.prepare('SELECT id FROM ports WHERE id = ?').get(nextToPortId)
      if (!fromPort || !toPort) {
        return reply.status(400).send({ error: 'Both cable endpoints must exist' })
      }

      const conflicting = db.prepare(`
        SELECT id
        FROM portLinks
        WHERE id != ?
          AND (fromPortId IN (?, ?) OR toPortId IN (?, ?))
        LIMIT 1
      `).get(req.params.id, nextFromPortId, nextToPortId, nextFromPortId, nextToPortId)
      if (conflicting) {
        return reply.status(409).send({ error: 'One of the selected ports is already linked' })
      }
    }

    if (fromPortId !== undefined) { updates.push('fromPortId = ?'); values.push(nextFromPortId) }
    if (toPortId !== undefined) { updates.push('toPortId = ?'); values.push(nextToPortId) }
    if (cableType !== undefined) { updates.push('cableType = ?'); values.push(cableType) }
    if (cableLength !== undefined) { updates.push('cableLength = ?'); values.push(cableLength) }
    if (color !== undefined) { updates.push('color = ?'); values.push(color) }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields to update' })

    const updateLink = db.transaction(() => {
      values.push(req.params.id)
      db.prepare(`UPDATE portLinks SET ${updates.join(', ')} WHERE id = ?`).run(...values)
      for (const portId of new Set([
        existing.fromPortId,
        existing.toPortId,
        nextFromPortId,
        nextToPortId,
      ])) {
        const stillLinked = db.prepare(
          'SELECT id FROM portLinks WHERE fromPortId = ? OR toPortId = ?'
        ).get(portId, portId)
        db.prepare("UPDATE ports SET linkState = ? WHERE id = ?").run(
          stillLinked ? 'up' : 'down',
          portId,
        )
      }
    })

    updateLink()
    return db.prepare('SELECT * FROM portLinks WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const link = db.prepare('SELECT * FROM portLinks WHERE id = ?').get(req.params.id) as
      { fromPortId: string; toPortId: string } | undefined
    if (!link) return reply.status(404).send({ error: 'Port link not found' })

    db.prepare('DELETE FROM portLinks WHERE id = ?').run(req.params.id)

    for (const portId of [link.fromPortId, link.toPortId]) {
      const stillLinked = db.prepare(
        'SELECT id FROM portLinks WHERE fromPortId = ? OR toPortId = ?'
      ).get(portId, portId)
      if (!stillLinked) {
        db.prepare("UPDATE ports SET linkState = 'down' WHERE id = ?").run(portId)
      }
    }

    return reply.status(204).send()
  })
}
