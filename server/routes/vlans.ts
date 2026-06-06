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
import { asObject, optionalInteger, optionalString, requiredInteger, requiredString } from '../lib/validation.js'

export const vlansRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { labId?: string } }>('/', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], req.query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    const { sql, params } = appendLabFilter('SELECT * FROM vlans', [], filter.labIds)
    return db.prepare(`${sql} ORDER BY vlanId`).all(...params)
  })

  app.get('/ranges', async (req, reply) => {
    if (!req.authUser) {
      return reply.status(401).send({ error: 'Authentication required.' })
    }

    const labId = (req.query as { labId?: string }).labId
    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    const { sql, params } = appendLabFilter('SELECT * FROM vlanRanges', [], filter.labIds)
    return db.prepare(`${sql} ORDER BY startVlan`).all(...params)
  })

  app.post('/ranges', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('vr')
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    if (!assertLabWrite(req, reply, labId)) return
    const name = requiredString(body, 'name', { maxLength: 120 })
    const startVlan = requiredInteger(body, 'startVlan', { min: 1, max: 4094 })
    const endVlan = requiredInteger(body, 'endVlan', { min: startVlan, max: 4094 })
    const purpose = optionalString(body, 'purpose', { maxLength: 500 })
    const color = optionalString(body, 'color', { maxLength: 30 })
    db.prepare(
      'INSERT INTO vlanRanges (id, labId, name, startVlan, endVlan, purpose, color) VALUES (?,?,?,?,?,?,?)',
    ).run(id, labId, name, startVlan, endVlan, purpose ?? null, color ?? null)
    return reply.status(201).send(db.prepare('SELECT * FROM vlanRanges WHERE id = ?').get(id))
  })

  app.patch<{ Params: { id: string } }>('/ranges/:id', async (req, reply) => {
    const existing = db.prepare('SELECT * FROM vlanRanges WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, existing)) return

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const name = optionalString(body, 'name', { maxLength: 120 })
    const startVlan = optionalInteger(body, 'startVlan', { min: 1, max: 4094 })
    const endVlan = optionalInteger(body, 'endVlan', { min: 1, max: 4094 })
    const purpose = optionalString(body, 'purpose', { maxLength: 500 })
    const color = optionalString(body, 'color', { maxLength: 30 })

    const range = existing!
    const effectiveStart = startVlan ?? Number(range.startVlan)
    const effectiveEnd = endVlan ?? Number(range.endVlan)
    if (effectiveStart > effectiveEnd) {
      return reply.status(400).send({ error: 'startVlan must be <= endVlan.' })
    }

    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (startVlan !== undefined) { updates.push('startVlan = ?'); values.push(startVlan) }
    if (endVlan !== undefined) { updates.push('endVlan = ?'); values.push(endVlan) }
    if (purpose !== undefined) { updates.push('purpose = ?'); values.push(purpose) }
    if (color !== undefined) { updates.push('color = ?'); values.push(color) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields to update' })

    values.push(req.params.id)
    db.prepare(`UPDATE vlanRanges SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM vlanRanges WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/ranges/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM vlanRanges WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, row)) return
    db.prepare('DELETE FROM vlanRanges WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM vlans WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabReadFromRow(req, reply, row)) return
    return row
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 }) ?? createId('v')
    const labId = requiredString(body, 'labId', { maxLength: 80 })
    if (!assertLabWrite(req, reply, labId)) return
    const vlanId = requiredInteger(body, 'vlanId', { min: 1, max: 4094 })
    const name = requiredString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const color = optionalString(body, 'color', { maxLength: 30 })
    db.prepare(
      'INSERT INTO vlans (id, labId, vlanId, name, description, color) VALUES (?,?,?,?,?,?)',
    ).run(id, labId, vlanId, name, description ?? null, color ?? null)
    return reply.status(201).send(db.prepare('SELECT * FROM vlans WHERE id = ?').get(id))
  })

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const existing = db.prepare('SELECT * FROM vlans WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, existing)) return

    const body = asObject(req.body)
    const updates: string[] = []
    const values: unknown[] = []

    const vlanId = optionalInteger(body, 'vlanId', { min: 1, max: 4094 })
    const name = optionalString(body, 'name', { maxLength: 120 })
    const description = optionalString(body, 'description', { maxLength: 500 })
    const color = optionalString(body, 'color', { maxLength: 30 })

    if (vlanId !== undefined) { updates.push('vlanId = ?'); values.push(vlanId) }
    if (name !== undefined) { updates.push('name = ?'); values.push(name) }
    if (description !== undefined) { updates.push('description = ?'); values.push(description) }
    if (color !== undefined) { updates.push('color = ?'); values.push(color) }

    if (updates.length === 0) return reply.status(400).send({ error: 'No valid fields to update' })

    values.push(req.params.id)
    db.prepare(`UPDATE vlans SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return db.prepare('SELECT * FROM vlans WHERE id = ?').get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM vlans WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!assertLabWriteFromRow(req, reply, row)) return
    db.prepare('DELETE FROM vlans WHERE id = ?').run(req.params.id)
    return reply.status(204).send()
  })
}
