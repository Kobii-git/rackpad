import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dgram from "node:dgram";
import { once } from "node:events";
import { lookup } from "node:dns/promises";

const directory = mkdtempSync(path.join(os.tmpdir(), "rackpad-snmp-interop-"));
process.env.DATABASE_PATH = path.join(directory, "test.db");
process.env.RACKPAD_SECRET_KEY = "synthetic-snmp-interop-key";
process.env.NODE_ENV = "test";
process.env.SNMP_TRAP_ENABLED = "0";
const { createApp } = await import("../../../server/app.js");
const { db } = await import("../../../server/db.js");
const { snmpV3Request } = await import("../../../server/lib/snmp-v3.js");
const { discoverIfMibInterfaces } =
  await import("../../../server/lib/snmp-if-mib.js");
const { runMonitorCheck } = await import("../../../server/lib/monitoring.js");
const { parseSnmpTrapPacket } =
  await import("../../../server/lib/snmp-trap-parser.js");
const app = await createApp();
const host = process.argv[2] ?? "snmp-agent";
const address = (await lookup(host)).address;
let token = "";
async function api(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  status = 200,
) {
  const response = await app.inject({
    method,
    url,
    payload,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  assert.equal(
    response.statusCode,
    status,
    `${method} ${url}: unexpected status ${response.statusCode}`,
  );
  return response.json();
}
const run = promisify(execFile);
try {
  token = (
    await api(
      "POST",
      "/api/auth/bootstrap",
      {
        username: "interop-admin",
        displayName: "Interop",
        password: "synthetic-interop-password",
      },
      201,
    )
  ).token;
  const labs = await api("GET", "/api/labs");
  const labId = labs[0].id;
  for (const protocol of ["SHA", "MD5"] as const)
    for (const privacy of ["AES128", "none"] as const) {
      const user = `fixture-${protocol.toLowerCase()}${privacy === "none" ? "-auth" : ""}`;
      const session = {
        host,
        port: 161,
        timeoutMs: 2000,
        version: "3" as const,
        user,
        authProtocol: protocol,
        authPassword: "maplesyrup",
        privProtocol: privacy,
        privPassword: "priv-maplesyrup",
      };
      // The external command is a legitimate control against the very same peer.
      const authArgs = [
        "-v3",
        "-l",
        privacy === "AES128" ? "authPriv" : "authNoPriv",
        "-u",
        user,
        "-a",
        protocol,
        "-A",
        "maplesyrup",
        ...(privacy === "AES128" ? ["-x", "AES", "-X", "priv-maplesyrup"] : []),
      ];
      const control = await run(
        "snmpget",
        [...authArgs, "-On", "-t", "2", "-r", "0", host, "1.3.6.1.2.1.1.5.0"],
        { timeout: 10000 },
      );
      assert.match(control.stdout, /fixture-switch/);
      const get = await snmpV3Request(session, "1.3.6.1.2.1.1.5.0", "get");
      assert.equal(get.kind, "value");
      if (get.kind === "value") assert.equal(get.value, "fixture-switch");
      const next = await snmpV3Request(session, "1.3.6.1.2.1.1", "getNext");
      assert.equal(next.kind, "value");
      const credential = await api(
        "POST",
        "/api/snmp-credentials",
        {
          labId,
          name: user,
          version: "3",
          v3User: user,
          v3AuthProto: protocol,
          v3AuthPassword: "maplesyrup",
          v3PrivProto: privacy,
          v3PrivPassword: "priv-maplesyrup",
        },
        201,
      );
      const tested = await api(
        "POST",
        `/api/snmp-credentials/${credential.id}/test`,
        { target: host, timeoutMs: 2000 },
      );
      assert.ok(tested);
      const device = await api(
        "POST",
        "/api/devices",
        {
          labId,
          hostname: user,
          deviceType: "switch",
          managementIp: address,
          snmpCredentialId: credential.id,
        },
        201,
      );
      const monitorId = `monitor-${user}`;
      db.prepare(
        "INSERT INTO deviceMonitors (id,deviceId,name,type,target,port,enabled,snmpVersion,snmpCredentialId,snmpOid,snmpMatchMode) VALUES (?,?,?,'snmp',?,161,1,'3',?,?,'any')",
      ).run(
        monitorId,
        device.id,
        user,
        host,
        credential.id,
        "1.3.6.1.2.1.1.5.0",
      );
      assert.equal((await runMonitorCheck(monitorId))?.lastResult, "online");
      const interfaces = await discoverIfMibInterfaces(session);
      assert.ok(
        interfaces.length >= 2,
        "IF-MIB must return the loopback and bridge interfaces",
      );
      assert.ok(
        interfaces.every(
          (entry) =>
            Number.isInteger(entry.ifIndex) && entry.operStatus != null,
        ),
      );
      const receiver = dgram.createSocket("udp4");
      receiver.bind(0, "127.0.0.1");
      await once(receiver, "listening");
      try {
        const incoming = once(receiver, "message", {
          signal: AbortSignal.timeout(5000),
        });
        await run(
          "snmptrap",
          [
            ...authArgs,
            `127.0.0.1:${receiver.address().port}`,
            "",
            "1.3.6.1.6.3.1.1.5.3",
            "1.3.6.1.2.1.2.2.1.1.2",
            "i",
            "2",
          ],
          { timeout: 5000 },
        );
        const [packet] = await incoming;
        const trap = parseSnmpTrapPacket(packet, {
          v3Credentials: [
            {
              id: credential.id,
              user,
              authProtocol: protocol,
              authPassword: "maplesyrup",
              privProtocol: privacy,
              privPassword: "priv-maplesyrup",
            },
          ],
        });
        assert.equal(trap.authVerified, true);
        assert.equal(trap.privacyUsed, privacy === "AES128");
        assert.equal(trap.ifIndex, 2);
      } finally {
        receiver.close();
      }
      console.log(
        `Net-SNMP ${protocol}/${privacy}: GET, GETNEXT, credential API, monitoring, concurrent IF-MIB and authenticated trap passed`,
      );
    }
} finally {
  await app.close();
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
