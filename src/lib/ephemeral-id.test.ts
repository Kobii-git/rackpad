import assert from "node:assert/strict";
import test from "node:test";
import { createEphemeralId } from "./ephemeral-id";

test("uses crypto.randomUUID when the browser provides it", () => {
  assert.equal(
    createEphemeralId({ randomUUID: () => "provided-uuid" }),
    "provided-uuid",
  );
});

test("creates unique temporary IDs when randomUUID is unavailable", () => {
  const first = createEphemeralId(null);
  const second = createEphemeralId(null);

  assert.match(first, /^ephemeral-[a-z0-9]+-[a-z0-9]+$/);
  assert.match(second, /^ephemeral-[a-z0-9]+-[a-z0-9]+$/);
  assert.notEqual(first, second);
});

test("falls back when an exposed randomUUID implementation throws", () => {
  assert.match(
    createEphemeralId({
      randomUUID() {
        throw new Error("not available in this context");
      },
    }),
    /^ephemeral-/,
  );
});
