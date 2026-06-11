import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "rackpad-snmp-traps-"));
process.env.DATABASE_PATH = path.join(tempDir, "rackpad-test.db");
process.env.NODE_ENV = "test";
process.env.OIDC_ENABLED = "0";
process.env.RACKPAD_SECRET_KEY = "rackpad-test-secret-key";

const { db } = await import("../db.js");
const { buildSnmpV2TrapPacket } = await import("../lib/snmp-trap-build.js");
const { SNMP_TRAP_LINK_DOWN_OID } = await import("../lib/snmp-trap-parser.js");
const { handleTrapPacket } = await import("../lib/snmp-traps.js");

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("handleTrapPacket caps persisted trap logs per source IP", async () => {
  db.prepare("INSERT INTO labs (id, name) VALUES (?, ?)").run(
    "lab_home",
    "Home Lab",
  );

  for (let index = 0; index < 25; index += 1) {
    await handleTrapPacket(
      buildSnmpV2TrapPacket({
        trapOid: SNMP_TRAP_LINK_DOWN_OID,
        ifIndex: index + 1,
      }),
      "203.0.113.50",
    );
  }

  const logCount = db
    .prepare("SELECT COUNT(*) AS count FROM snmpTrapLog WHERE sourceIp = ?")
    .get("203.0.113.50") as { count: number };
  const auditCount = db
    .prepare(
      "SELECT COUNT(*) AS count FROM auditLog WHERE action = 'monitor.snmp.trap'",
    )
    .get() as { count: number };
  const source = db
    .prepare("SELECT sourceIp FROM snmpTrapSources WHERE sourceIp = ?")
    .get("203.0.113.50") as { sourceIp: string } | undefined;

  assert.equal(logCount.count, 20);
  assert.equal(auditCount.count, 20);
  assert.equal(source?.sourceIp, "203.0.113.50");
});
