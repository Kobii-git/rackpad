import type { FastifyPluginAsync } from 'fastify'
import { asObject, optionalString, requiredString } from '../lib/validation.js'
import {
  createDeviceType,
  deleteDeviceType,
  listDeviceTypesWithObserved,
  updateDeviceType,
} from '../lib/device-types.js'
import { assertGlobalAdmin } from '../lib/lab-access.js'

export const deviceTypesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    return listDeviceTypesWithObserved()
  })

  app.post('/', async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 })
    const label = requiredString(body, 'label', { maxLength: 80 })
    const parentType = optionalString(body, 'parentType', { maxLength: 80 })

    return reply.status(201).send(createDeviceType({ id, label, parentType }))
  })

  app.patch('/:id', async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return
    const params = asObject(req.params)
    const body = asObject(req.body)
    const id = requiredString(params, 'id', { maxLength: 80 })
    const label = optionalString(body, 'label', { maxLength: 80 })
    const parentType = optionalString(body, 'parentType', { maxLength: 80 })

    return updateDeviceType(id, { label, parentType })
  })

  app.delete('/:id', async (req, reply) => {
    if (!assertGlobalAdmin(req, reply)) return
    const params = asObject(req.params)
    const id = requiredString(params, 'id', { maxLength: 80 })
    deleteDeviceType(id)
    return reply.status(204).send()
  })
}
