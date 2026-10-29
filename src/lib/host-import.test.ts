import assert from "node:assert/strict";
import test from "node:test";
import {
  collectedHostIps,
  defaultHostIp,
  hostIpProblem,
  planHostAdapters,
} from "./host-import";
import type { Device, DhcpScope, IpAssignment, IpZone, Port, Subnet } from "./types";

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

test("host IP staging excludes gateway, DNS and technical addresses before any host write", () => {
  const network = [{ ...subnets[0], gateway: "10.0.0.1", dnsServers: ["10.0.0.2"] }];
  const scopes = [{ id: "scope", subnetId: "s", name: "DHCP", startIp: "10.0.0.100", endIp: "10.0.0.200", gateway: "10.0.0.3", dnsServers: ["10.0.0.4"] }] as DhcpScope[];
  for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]) {
    assert.equal(hostIpProblem(ip, network, [], undefined, scopes), "reserved");
    assert.equal(defaultHostIp([ip], network, [], undefined, scopes), "");
  }
  const technical = [{ subnetId: "s", ipAddress: "10.0.0.5", deviceId: "host", assignmentType: "reserved" }] as IpAssignment[];
  assert.equal(hostIpProblem("10.0.0.5", network, technical, "host", scopes), "reserved");
  assert.equal(defaultHostIp(["10.0.0.1", "10.0.0.6"], network, [], undefined, scopes), "10.0.0.6");
});

test("host IP staging follows DHCP-zone and static-zone eligibility", () => {
  const scopes = [{ id: "scope", subnetId: "s", name: "DHCP", startIp: "10.0.0.100", endIp: "10.0.0.200" }] as DhcpScope[];
  const zones = [{ id: "dhcp", subnetId: "s", kind: "dhcp", startIp: "10.0.0.120", endIp: "10.0.0.150" },
    { id: "static", subnetId: "s", kind: "static", startIp: "10.0.0.160", endIp: "10.0.0.170" }] as IpZone[];
  assert.equal(hostIpProblem("10.0.0.110", subnets, [], undefined, scopes, zones), "allocation");
  assert.equal(defaultHostIp(["10.0.0.110"], subnets, [], undefined, scopes, zones), "");
  for (const ip of ["10.0.0.130", "10.0.0.165", "10.0.0.90"])
    assert.equal(hostIpProblem(ip, subnets, [], undefined, scopes, zones), null);
  assert.equal(hostIpProblem("10.0.0.110", subnets, [], undefined, scopes), null);
});
