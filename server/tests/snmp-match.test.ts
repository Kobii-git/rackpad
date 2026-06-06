import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateSnmpMatch,
  matchPortForInterface,
  operStatusToLinkState,
} from "../lib/snmp-match.js";

test("evaluateSnmpMatch supports equals, notEquals, in, and any modes", () => {
  assert.equal(evaluateSnmpMatch("equals", "1", "1"), true);
  assert.equal(evaluateSnmpMatch("equals", "2", "1"), false);
  assert.equal(evaluateSnmpMatch("notEquals", "2", "1"), true);
  assert.equal(evaluateSnmpMatch("notEquals", "1", "1"), false);
  assert.equal(evaluateSnmpMatch("in", "2", "1,2,3"), true);
  assert.equal(evaluateSnmpMatch("in", "4", "1,2,3"), false);
  assert.equal(evaluateSnmpMatch("any", "anything", ""), true);
  assert.equal(evaluateSnmpMatch(null, "value", ""), true);
  assert.equal(evaluateSnmpMatch(null, "1", "1"), true);
  assert.equal(evaluateSnmpMatch(null, "value", "1"), false);
});

test("matchPortForInterface prefers snmpIfIndex then normalized port names", () => {
  const ports = [
    { id: "port-1", name: "Gi0/1", snmpIfIndex: null },
    { id: "port-2", name: "eth2", snmpIfIndex: 2 },
  ];

  const byIndex = matchPortForInterface(ports, {
    ifIndex: 2,
    descr: "Ethernet2",
    operStatusOid: "1.3.6.1.2.1.2.2.1.8.2",
  });
  assert.equal(byIndex, "port-2");

  const byName = matchPortForInterface(
    [{ id: "port-3", name: "Gi0/3", snmpIfIndex: null }],
    {
      ifIndex: 3,
      descr: "GigabitEthernet0/3",
      name: "Gi0/3",
      operStatusOid: "1.3.6.1.2.1.2.2.1.8.3",
    },
  );
  assert.equal(byName, "port-3");
});

test("operStatusToLinkState maps monitor results to port link states", () => {
  assert.equal(operStatusToLinkState("online"), "up");
  assert.equal(operStatusToLinkState("offline"), "down");
  assert.equal(operStatusToLinkState("unknown"), "unknown");
});
