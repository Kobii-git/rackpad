import assert from "node:assert/strict";
import test from "node:test";
import { deviceNameMetrics } from "./device-name";

test("device names retain 12 screen pixels across every canvas zoom range", () => {
  for (const zoom of [0.12, 0.22, 0.35, 0.5, 0.72, 1, 1.6, 1.8, 2]) {
    const metrics = deviceNameMetrics(400, 200, zoom);
    assert.ok(Math.abs(metrics.fontSize * zoom - 12) < 1e-10);
    assert.ok(Math.abs(parseFloat(metrics.lineHeight) * zoom - 12) < 1e-10);
    assert.ok(Math.abs(metrics.top * zoom - 2) < 1e-10);
    assert.ok(Math.abs(Number(metrics.right) * zoom - 4) < 1e-10);
    assert.ok(metrics.maxWidth * zoom <= 180);
    assert.ok(metrics.maxWidth <= 400 - 8 / zoom + 1e-10);
  }
  assert.ok(
    deviceNameMetrics(400, 200, 2).maxWidth <
      deviceNameMetrics(400, 200, 1).maxWidth,
  );
});

test("device names hide only below the readable fit thresholds and reserve controls", () => {
  assert.equal(deviceNameMetrics(32, 16).visible, true);
  assert.equal(deviceNameMetrics(31.99, 16).visible, false);
  assert.equal(deviceNameMetrics(32, 15.99).visible, false);
  assert.equal(deviceNameMetrics(64, 32, 0.5).visible, true);
  assert.equal(deviceNameMetrics(100, 32, 0.5, 37).visible, false);
  assert.equal(deviceNameMetrics(100, 32, 0.5, 36).visible, true);
  assert.equal(deviceNameMetrics(100, 32, 0.5, 0, 36).right, 44);
  assert.equal(deviceNameMetrics(0, 0).maxWidth, 0);
});

test("invalid zooms fall back to unscaled preview geometry", () => {
  for (const zoom of [NaN, Infinity, -Infinity, 0, -1]) {
    assert.deepEqual(
      deviceNameMetrics(300, 42, zoom),
      deviceNameMetrics(300, 42, 1),
    );
  }
});


test("left labels retain screen size and respect reserved controls at every zoom", () => {
  for (const zoom of [0.22, 0.5, 1, 1.8, 2]) {
    const left = deviceNameMetrics(400, 200, zoom, 32, 8, "upper-left");
    const right = deviceNameMetrics(400, 200, zoom, 32, 8);
    assert.equal(left.right, undefined);
    assert.equal(right.left, undefined);
    assert.ok(Math.abs((Number(left.left) - 32) * zoom - 4) < 1e-10);
    assert.equal(left.maxWidth, right.maxWidth);
    assert.equal(left.fontSize, right.fontSize);
    assert.equal(left.visible, right.visible);
  }
});
