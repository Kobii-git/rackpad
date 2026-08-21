import { db } from './db.js'
import { createApp } from './app.js'
import { purgeExpiredSessions } from './lib/auth.js'
import { startDiscoveryScanScheduleLoop } from './routes/discovery.js'
import { startMonitoringLoop } from './lib/monitoring.js'
import { startSnmpTrapReceiver } from './lib/snmp-traps.js'
import { startDockerStatusSyncLoop } from './lib/docker-import.js'
import { resolveRuntimeConfig } from './lib/runtime-config.js'
import { startNativeBackupScheduleLoop } from './lib/native-backup.js'
import { startSnmpSyncScheduleLoop } from './routes/snmp-sync.js'
import { startIntegrationStatusSyncLoop } from './lib/integrations/status-sync.js'
import { startIntegrationAutoSyncLoop } from './lib/integrations/auto-sync.js'

const runtimeConfig = resolveRuntimeConfig()
const SESSION_CLEANUP_INTERVAL_MS = 1000 * 60 * 60 * 24

const app = await createApp()
purgeExpiredSessions()
const stopMonitoring = startMonitoringLoop(runtimeConfig.monitorIntervalMs)
const stopDiscoveryScanSchedules = startDiscoveryScanScheduleLoop(
  runtimeConfig.discoveryScanScheduleIntervalMs,
)
const stopDockerStatusSync = startDockerStatusSyncLoop(
  runtimeConfig.dockerStatusSyncIntervalMs,
)
const stopIntegrationStatusSync = startIntegrationStatusSyncLoop(
  runtimeConfig.integrationStatusSyncIntervalMs,
)
const stopIntegrationAutoSync = startIntegrationAutoSyncLoop()
const stopTrapReceiver = startSnmpTrapReceiver()
const stopNativeBackupSchedule = startNativeBackupScheduleLoop()
const stopSnmpSyncSchedules = startSnmpSyncScheduleLoop()
const sessionCleanupHandle = setInterval(() => {
  purgeExpiredSessions()
}, SESSION_CLEANUP_INTERVAL_MS)
sessionCleanupHandle.unref?.()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    stopMonitoring()
    stopDiscoveryScanSchedules()
    stopDockerStatusSync()
    stopIntegrationStatusSync()
    stopIntegrationAutoSync()
    stopTrapReceiver()
    stopNativeBackupSchedule()
    stopSnmpSyncSchedules()
    clearInterval(sessionCleanupHandle)
    await app.close()
    db.close()
    process.exit(0)
  })
}

try {
  await app.listen({ port: runtimeConfig.port, host: runtimeConfig.host })
  console.log(`[rackpad] Server listening on http://${runtimeConfig.host}:${runtimeConfig.port}`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
