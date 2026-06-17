import type { FastifyPluginAsync } from 'fastify'
import { requireAuth } from '../lib/auth.js'
import {
  assertLabRead,
  assertLabWrite,
  resolveLabIdsForList,
} from '../lib/lab-access.js'
import {
  getSnmpTrapReceiverStatus,
  listSnmpTrapLog,
  listSnmpTrapSources,
  updateSnmpTrapSource,
} from '../lib/snmp-traps.js'
import { asObject, optionalString } from '../lib/validation.js'

export const snmpTrapsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/status', async (req, reply) => {
    if (!requireAuth(req, reply)) return
    return getSnmpTrapReceiverStatus()
  })

  app.get('/log', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const query = req.query as { labId?: string; deviceId?: string; limit?: string; offset?: string }
    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    if (query.labId && !assertLabRead(req, reply, query.labId)) return

    if (query.labId) {
      return listSnmpTrapLog({
        labId: query.labId,
        deviceId: query.deviceId,
        limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
        offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
      })
    }

    if (filter.labIds === null) {
      return listSnmpTrapLog({
        deviceId: query.deviceId,
        limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
        offset: query.offset ? Number.parseInt(query.offset, 10) : undefined,
      })
    }

    const allowed = new Set(filter.labIds)
    return listSnmpTrapLog({
      deviceId: query.deviceId,
      limit: 500,
    }).filter((entry) => allowed.has(entry.labId))
  })

  app.get('/sources', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const query = req.query as { labId?: string }
    const filter = resolveLabIdsForList(req.authUser, req.labAccess ?? [], query.labId)
    if (!filter.ok) {
      return reply.status(filter.status).send({ error: filter.error })
    }

    if (query.labId) {
      if (!assertLabRead(req, reply, query.labId)) return
      return listSnmpTrapSources(query.labId)
    }

    if (filter.labIds === null) {
      return listSnmpTrapSources()
    }

    const allowed = new Set(filter.labIds)
    return listSnmpTrapSources().filter((entry) => allowed.has(entry.labId))
  })

  app.patch<{ Params: { id: string } }>('/sources/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return

    const existing = listSnmpTrapSources().find((entry) => entry.id === req.params.id)
    if (!existing) {
      return reply.status(404).send({ error: 'SNMP trap source not found.' })
    }
    if (!assertLabWrite(req, reply, existing.labId)) return

    const body = asObject(req.body)
    try {
      const updated = updateSnmpTrapSource(req.params.id, {
        deviceId: 'deviceId' in body ? optionalString(body, 'deviceId', { maxLength: 80 }) : undefined,
        credentialId:
          'credentialId' in body ? optionalString(body, 'credentialId', { maxLength: 80 }) : undefined,
      })
      return updated
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to update trap source.',
      })
    }
  })
}
