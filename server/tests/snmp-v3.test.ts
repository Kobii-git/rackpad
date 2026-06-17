import assert from "node:assert/strict";
import test from "node:test";
import { boundedSnmpTimeoutMs } from "../lib/snmp.js";
import { passwordToKey } from "../lib/snmp-v3.js";

test("boundedSnmpTimeoutMs returns fixed safe timeout buckets", () => {
  assert.equal(boundedSnmpTimeoutMs(Number.NaN), 8000);
  assert.equal(boundedSnmpTimeoutMs(50), 1000);
  assert.equal(boundedSnmpTimeoutMs(1501), 2000);
  assert.equal(boundedSnmpTimeoutMs(35_000), 30_000);
});

test("passwordToKey rejects empty SNMPv3 passwords", () => {
  assert.throws(
    () => passwordToKey("SHA", "", Buffer.from([0x80, 0x00, 0x00, 0x01])),
    /SNMPv3 password must not be empty/,
  );
});
