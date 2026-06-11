import assert from "node:assert/strict";
import test from "node:test";
import { ensureHostTarget } from "../lib/validation.js";

test("ensureHostTarget accepts IPv4, IPv6, and RFC-1123 hostnames", () => {
  assert.equal(ensureHostTarget("192.0.2.10"), "192.0.2.10");
  assert.equal(ensureHostTarget("2001:db8::1"), "2001:db8::1");
  assert.equal(ensureHostTarget("rack-01.example.net"), "rack-01.example.net");
});

test("ensureHostTarget rejects leading hyphens, whitespace, and invalid hosts", () => {
  assert.throws(() => ensureHostTarget("-rack-01"), /valid host target/);
  assert.throws(() => ensureHostTarget("rack 01"), /valid host target/);
  assert.throws(() => ensureHostTarget("999.0.0.1"), /valid IPv4 address/);
  assert.throws(() => ensureHostTarget("bad_host"), /valid host target/);
});
