import type Database from 'better-sqlite3'
import { canEncryptSecrets, encryptOptionalSecret } from './secret-crypto.js'
import { ValidationError } from './validation.js'

// Shared by the forward migration and logical restore. Never imports the live DB.
export function restoredMonitorCommunity(row: Record<string, unknown>): string | null {
  const plaintext = row.snmpCommunity
  const ciphertext = row.snmpCommunityEnc
  if (plaintext != null && typeof plaintext !== 'string') {
    throw new ValidationError('Invalid monitor community in backup.')
  }
  if (ciphertext != null) {
    if (typeof ciphertext !== 'string' || !ciphertext.startsWith('enc:v1:') ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext.slice(7)) ||
        Buffer.from(ciphertext.slice(7), 'base64').length <= 28 ||
        Buffer.from(ciphertext.slice(7), 'base64').toString('base64') !== ciphertext.slice(7) ||
        (typeof plaintext === 'string' && plaintext.trim())) {
      throw new ValidationError('Invalid encrypted monitor community in backup.')
    }
    return ciphertext
  }
  return encryptMonitorCommunity(plaintext as string | null | undefined)
}

export function encryptMonitorCommunity(value: string | null | undefined) {
  if (value?.trim() && !canEncryptSecrets()) {
    throw new ValidationError('RACKPAD_SECRET_KEY must be set before encrypting stored SNMP communities. No changes were saved.')
  }
  return encryptOptionalSecret(value)
}

export function upgradeLegacySecurityState(database: Database.Database) {
  const rows = database.prepare('SELECT id, snmpCommunity, snmpCommunityEnc FROM deviceMonitors').all() as Record<string, unknown>[]
  const update = database.prepare('UPDATE deviceMonitors SET snmpCommunity = NULL, snmpCommunityEnc = ? WHERE id = ?')
  for (const row of rows) update.run(restoredMonitorCommunity(row), row.id)
  database.exec(`
    UPDATE oidcIdentities SET roleRecheckRequired = 1;
    DELETE FROM userSessions WHERE userId IN (SELECT userId FROM oidcIdentities);
    UPDATE snmpTrapSources SET community = NULL, credentialId = NULL;
  `)
}
