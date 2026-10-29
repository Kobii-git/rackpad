import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SUMMARY_FIELDS,
  parseSummaryFields,
  summaryPlacement,
} from "./device-summary";
import type { Device, Rack, Room } from "./types";

test("summary preferences reject corrupt data and normalize selected fields into canonical order", () => {
  for (const value of [null, "invalid", "{}", "[]", '["unknown"]'])
    assert.deepEqual(parseSummaryFields(value), DEFAULT_SUMMARY_FIELDS);
  assert.deepEqual(
    parseSummaryFields('["startU","hostname","hostname","specs","unknown"]'),
    ["hostname", "specs", "startU"],
  );
});

test("summary placement resolves shelf parents without fabricating a child's U or looping on bad references", () => {
  const rack = { id: "rack", name: "Closet", roomId: "room" } as Rack;
  const room = { id: "room", name: "Office" } as Room;
  const parent = {
    id: "shelf",
    rackId: "rack",
    startU: 12,
    hostname: "Shelf",
  } as Device;
  const child = {
    id: "child",
    hostname: "Appliance",
    parentDeviceId: "shelf",
  } as Device;
  assert.deepEqual(summaryPlacement(parent, [parent], [rack], [room]), {
    name: "Closet",
    startU: 12,
  });
  assert.deepEqual(summaryPlacement(child, [parent, child], [rack], [room]), {
    name: "Closet",
    startU: undefined,
  });
  assert.deepEqual(
    summaryPlacement({ hostname: "Loose", roomId: "room" }, [], [], [room]),
    { name: "Office", startU: undefined },
  );
  const cyclic = [
    { id: "a", hostname: "A", parentDeviceId: "b" },
    { id: "b", hostname: "B", parentDeviceId: "a" },
  ] as Device[];
  assert.equal(summaryPlacement(cyclic[0], cyclic, [], []).name, "");
});
