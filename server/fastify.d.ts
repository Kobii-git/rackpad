import 'fastify'
import type { AuthUser } from './lib/auth.js'
import type { LabAccessEntry } from './lib/lab-access.js'

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null
    sessionId: string | null
    labAccess: LabAccessEntry[] | null
  }
}
