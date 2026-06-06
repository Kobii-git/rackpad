import assert from "node:assert/strict";
import test from "node:test";
import { encryptSecret, decryptSecret } from "../lib/secret-crypto.js";

test("secret-crypto encrypts and decrypts SNMP secrets", () => {
  process.env.RACKPAD_SECRET_KEY = "rackpad-test-secret-key";
  const encrypted = encryptSecret("community-secret");
  assert.notEqual(encrypted, "community-secret");
  assert.equal(decryptSecret(encrypted), "community-secret");
});
