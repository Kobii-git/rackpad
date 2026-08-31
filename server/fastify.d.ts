import 'fastify'
import type { AuthUser } from './lib/auth.js'
import type { LabAccessEntry } from './lib/lab-access.js'
import type {
  RouteAuthorization,
  RouteAuthorizationInventoryEntry,
} from './route-authorization.js'

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null
    sessionId: string | null
    labAccess: LabAccessEntry[] | null
  }

  interface FastifyContextConfig {
    authorization?: RouteAuthorization
  }

  interface FastifyInstance {
    routeAuthorizationInventory: RouteAuthorizationInventoryEntry[]
  }
}
