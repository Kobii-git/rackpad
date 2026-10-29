import assert from "node:assert/strict";
import test from "node:test";
import {
  collectedHostIps,
  defaultHostIp,
  hostIpProblem,
  planHostAdapters,
} from "./host-import";
import type { Device, IpAssignment, Port, Subnet } from "./types";

const subnets: Subnet[] = [
  {
    id: "s",
    labId: "lab",
    cidr: "10.0.0.0/24",
    name: "LAN",
    integrity: { state: "ok", canonicalCidr: "10.0.0.0/24", conflicts: [] },
  },
];
test("host IP staging deduplicates adapters and requires an unambiguous documented, unowned address", () => {
  assert.deepEqual(
    collectedHostIps(
      ["10.0.0.2", "127.0.0.1", "999.1.1.1"],
      [{ ipAddresses: ["10.0.0.2", "10.0.0.3", "169.254.1.1"] }],
    ),
    ["10.0.0.2", "10.0.0.3"],
  );
  assert.equal(defaultHostIp(["10.0.0.2"], subnets, []), "10.0.0.2");
  assert.equal(defaultHostIp(["10.0.0.2", "10.0.0.3"], subnets, []), "");
  const assignments = [
    { subnetId: "s", ipAddress: "10.0.0.2", deviceId: "other" },
  ] as IpAssignment[];
  assert.equal(hostIpProblem("10.0.0.2", subnets, assignments), "conflict");
  assert.equal(hostIpProblem("10.0.0.2", subnets, assignments, "other"), null);
  assert.equal(hostIpProblem("10.0.1.2", subnets, []), "subnet");
  assert.equal(hostIpProblem("10.0.0.0", subnets, []), "subnet");
  assert.equal(
    defaultHostIp(["10.0.0.2"], subnets, [], {
      managementIp: "10.0.0.9",
    } as Device),
    "10.0.0.9",
  );
});

test("host adapter matching preserves identities and connector choices without merging shared MACs", () => {
  const ports = [
    {
      id: "p",
      deviceId: "d",
      name: "eno1",
      kind: "sfp_plus",
      macAddress: "02:00:00:00:00:01",
    },
  ] as Port[];
  const adapters = [
    {
      name: "eno1",
      macAddress: "02-00-00-00-00-01",
      status: "UP",
      linkSpeed: "10000 Mb/s",
    },
    { name: "vmbr0", macAddress: "02:00:00:00:00:01" },
  ];
  const plan = planHostAdapters(adapters, ports, ["vmbr0"]);
  assert.equal(plan[0].existing?.id, "p");
  assert.equal(plan[0].changes.kind, "sfp_plus");
  assert.equal(plan[0].changes.linkState, "up");
  assert.equal(plan[1].existing, undefined);
  assert.equal(plan[1].changes.kind, "virtual");
  assert.equal(
    planHostAdapters(
      [{ name: "eno1", macAddress: "02:00:00:00:00:02" }],
      ports,
      [],
    )[0].problem,
    "conflict",
  );
  assert.ok(
    planHostAdapters([{ name: "eno1" }, { name: "ENO1" }], [], []).every(
      (item) => item.problem === "conflict",
    ),
  );
  assert.equal(
    planHostAdapters([{ name: "new" }], [], [])[0].changes.kind,
    "other",
  );
  assert.equal(planHostAdapters([{ name: "" }], [], [])[0].problem, "invalid");
});
