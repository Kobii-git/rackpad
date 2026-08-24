import assert from "node:assert/strict";
import test from "node:test";
import { statusColor, statusGlow, statusLabel } from "./utils";

test("unmanaged status presentation is labeled and visually neutral", () => {
  assert.equal(statusLabel.unmanaged, "Unmanaged");
  assert.equal(statusColor.unmanaged, "var(--color-fg-subtle)");
  assert.equal(statusGlow.unmanaged, "transparent");
});
