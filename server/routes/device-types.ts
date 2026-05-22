import type { FastifyPluginAsync } from 'fastify'
import { asObject, optionalString, requiredString } from '../lib/validation.js'
import { createDeviceType, listDeviceTypesWithObserved } from '../lib/device-types.js'

export const deviceTypesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    return listDeviceTypesWithObserved()
  })

  app.post('/', async (req, reply) => {
    const body = asObject(req.body)
    const id = optionalString(body, 'id', { maxLength: 80 })
    const label = requiredString(body, 'label', { maxLength: 80 })

    return reply.status(201).send(createDeviceType({ id, label }))
  })
}

