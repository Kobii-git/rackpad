import assert from "node:assert/strict";
import test from "node:test";
import { ensureRoutableHost } from "../lib/net-guard.js";

test("ensureRoutableHost rejects reserved address ranges", async () => {
  await assert.rejects(
    () => ensureRoutableHost("127.0.0.1"),
    /reserved ranges/,
  );
  await assert.rejects(
    () => ensureRoutableHost("169.254.169.254"),
    /reserved ranges/,
  );
  await assert.rejects(() => ensureRoutableHost("[::1]"), /reserved ranges/);
});

test("ensureRoutableHost accepts routable literal addresses", async () => {
  assert.equal(await ensureRoutableHost("8.8.8.8"), "8.8.8.8");
});
