import assert from "node:assert/strict";
import test from "node:test";
import {
  initialIntegrationSelection,
  updateIntegrationSelection,
} from "./integration-selection.js";
import type { IntegrationDeviceSyncPlan } from "./types.js";

const plan: IntegrationDeviceSyncPlan = {
  labId: "lab",
  controllerName: null,
  devices: [
    {
      providerRecordId: "host:create",
      action: "create",
      name: "pve1",
      deviceType: "server",
      parentName: null,
      model: null,
      macAddress: null,
      ipAddress: null,
      portCount: 0,
      reason: null,
      proposedUpdates: [],
    },
    {
      providerRecordId: "guest:create",
      action: "create",
      name: "web01",
      deviceType: "vm",
      parentName: "pve1",
      model: null,
      macAddress: null,
      ipAddress: null,
      portCount: 1,
      reason: null,
      proposedUpdates: [],
    },
    {
      providerRecordId: "host:exists",
      action: "exists",
      name: "pve2",
      deviceType: "server",
      parentName: null,
      model: null,
      macAddress: null,
      ipAddress: null,
      portCount: 0,
      reason: null,
      proposedUpdates: [],
    },
    {
      providerRecordId: "guest:existing-host",
      action: "create",
      name: "db01",
      deviceType: "container",
      parentName: "pve2",
      model: null,
      macAddress: null,
      ipAddress: null,
      portCount: 1,
      reason: null,
      proposedUpdates: [],
    },
    {
      providerRecordId: "guest:conflict",
      action: "conflict",
      name: "orphan",
      deviceType: "vm",
      parentName: "missing",
      model: null,
      macAddress: null,
      ipAddress: null,
      portCount: 0,
      reason: "Parent host missing is unavailable.",
      proposedUpdates: [],
    },
  ],
  virtualSwitches: [
    {
      providerRecordId: "switch:create",
      action: "create",
      name: "vmbr0",
      hostName: "pve1",
      reason: null,
    },
  ],
  ssids: [],
};

test("initial integration selection includes only creatable records", () => {
  assert.deepEqual(
    [...initialIntegrationSelection(plan)].sort(),
    [
      "guest:create",
      "guest:existing-host",
      "host:create",
      "switch:create",
    ],
  );
});

test("selecting a dependent selects its creatable host", () => {
  assert.deepEqual(
    [
      ...updateIntegrationSelection(
        plan,
        new Set(),
        "guest:create",
        true,
      ),
    ].sort(),
    ["guest:create", "host:create"],
  );
  assert.deepEqual(
    [
      ...updateIntegrationSelection(
        plan,
        new Set(),
        "switch:create",
        true,
      ),
    ].sort(),
    ["host:create", "switch:create"],
  );
  assert.deepEqual(
    [
      ...updateIntegrationSelection(
        plan,
        new Set(),
        "guest:existing-host",
        true,
      ),
    ],
    ["guest:existing-host"],
  );
});

test("deselecting a host deselects all of its dependents", () => {
  const selected = initialIntegrationSelection(plan);
  assert.deepEqual(
    [...updateIntegrationSelection(plan, selected, "host:create", false)],
    ["guest:existing-host"],
  );
});
