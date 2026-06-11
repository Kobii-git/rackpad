import { db } from './db.js'
import { createApp } from './app.js'
import { purgeExpiredSessions } from './lib/auth.js'
import { startMonitoringLoop } from './lib/monitoring.js'
import { startSnmpTrapReceiver } from './lib/snmp-traps.js'
import { startDockerStatusSyncLoop } from './lib/docker-import.js'

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10)
const HOST = process.env.HOST ?? '0.0.0.0'
const MONITOR_INTERVAL_MS = Number.parseInt(process.env.MONITOR_INTERVAL_MS ?? '0', 10)
const DOCKER_STATUS_SYNC_INTERVAL_MS = Number.parseInt(process.env.DOCKER_STATUS_SYNC_INTERVAL_MS ?? '300000', 10)
const SESSION_CLEANUP_INTERVAL_MS = 1000 * 60 * 60 * 24

const app = await createApp()
purgeExpiredSessions()
const stopMonitoring = startMonitoringLoop(Number.isFinite(MONITOR_INTERVAL_MS) ? MONITOR_INTERVAL_MS : 0)
const stopDockerStatusSync = startDockerStatusSyncLoop(
  Number.isFinite(DOCKER_STATUS_SYNC_INTERVAL_MS) ? DOCKER_STATUS_SYNC_INTERVAL_MS : 300000,
)
const stopTrapReceiver = startSnmpTrapReceiver()
const sessionCleanupHandle = setInterval(() => {
  purgeExpiredSessions()
}, SESSION_CLEANUP_INTERVAL_MS)
sessionCleanupHandle.unref?.()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    stopMonitoring()
    stopDockerStatusSync()
    stopTrapReceiver()
    clearInterval(sessionCleanupHandle)
    await app.close()
    db.close()
    process.exit(0)
  })
}

try {
  await app.listen({ port: PORT, host: HOST })
  console.log(`[rackpad] Server listening on http://${HOST}:${PORT}`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
