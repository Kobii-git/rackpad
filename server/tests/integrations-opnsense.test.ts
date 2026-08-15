import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  setIntegrationHttpTransportForTests,
  type IntegrationHttpRequest,
} from "../lib/integrations/http.js";
import { opnsenseIntegrationClient } from "../lib/integrations/providers/opnsense.js";
import type { IntegrationConnectionSecrets } from "../lib/integrations/types.js";

const connection: IntegrationConnectionSecrets = {
  id: "intg_fw",
  labId: "lab_1",
  provider: "opnsense",
  name: "Edge firewall",
  baseUrl: "https://fw.lab.internal",
  authKind: "key-secret",
  authId: "key-id",
  authSecret: "secret-value",
  siteRef: null,
  scopeRefs: [],
  autoSyncEnabled: false,
  autoSyncMode: "merge",
  autoSyncCron: null,
  autoSyncLabIds: [],
  autoSyncFailureCount: 0,
  autoSyncPausedUntil: null,
  verifyTls: false,
  enabled: true,
  syncVlans: true,
  syncSubnets: true,
  syncDhcp: true,
};

const responses: Record<string, { status?: number; body: unknown }> = {
  "/api/core/firmware/info": {
    body: {
      product_id: "opnsense",
      product_version: "25.7.1",
      product: {
        product_name: "OPNsense",
        product_version: "25.7.1",
        product_series: "25.7",
      },
    },
  },
  // camelCase form is denied so the client must fall back to snake_case,
  // mirroring restricted-key ACL behavior on OPNsense 25.7+.
  "/api/diagnostics/system/systemInformation": {
    status: 403,
    body: { status: 403, message: "access denied" },
  },
  "/api/diagnostics/system/system_information": {
    body: {
      name: "fw.lab.internal",
      versions: ["OPNsense 25.7.1-amd64", "FreeBSD 14.3"],
    },
  },
  "/api/interfaces/vlan_settings/get": {
    body: {
      vlan: {
        vlan: {
          "uuid-1": {
            if: {
              igc0: { value: "LAN (igc0)", selected: 1 },
              igc1: { value: "WAN (igc1)", selected: 0 },
            },
            tag: "10",
            pcp: {},
            proto: {},
            descr: "Servers",
            vlanif: "vlan01",
          },
        },
      },
    },
  },
  "/api/interfaces/overview/interfacesInfo": {
    body: {
      rows: [
        {
          device: "igc0",
          identifier: "lan",
          description: "LAN",
          enabled: true,
          status: "up",
          macaddr: "00:11:22:33:44:55",
          vlan_tag: null,
          ipv4: [{ ipaddr: "192.168.1.1/24" }],
          gateways: [],
        },
        {
          device: "vlan01",
          identifier: "opt1",
          description: "Servers",
          enabled: true,
          status: "up",
          macaddr: "00:11:22:33:44:55",
          vlan_tag: "10",
          ipv4: [{ ipaddr: "10.0.10.1/24" }],
          gateways: [],
        },
        {
          device: "igc1",
          identifier: "wan",
          description: "WAN",
          enabled: true,
          status: "up",
          macaddr: "00:11:22:33:44:66",
          vlan_tag: null,
          ipv4: [{ ipaddr: "203.0.113.5/24" }],
          gateways: ["WAN_DHCP"],
        },
      ],
      rowCount: 3,
      total: 3,
      current: 1,
    },
  },
  "/api/kea/dhcpv4/searchSubnet": {
    body: {
      rows: [
        {
          uuid: "subnet-1",
          subnet: "10.0.10.0/24",
          description: "Servers scope",
          pools: "10.0.10.100-10.0.10.199\n10.0.10.224/27",
        },
      ],
    },
  },
  "/api/dnsmasq/settings/searchRange": {
    body: {
      rows: [
        {
          uuid: "range-1",
          interface: "LAN",
          start_addr: "192.168.1.100",
          end_addr: "192.168.1.199",
        },
      ],
    },
  },
  "/api/dhcpv4/service/status": { body: { status: "running" } },
  "/api/routes/gateway/status": {
    body: {
      items: [
        {
          name: "WAN_DHCP",
          address: "203.0.113.1",
          status: "none",
          status_translated: "Online",
          delay: "12.3 ms",
          loss: "0.0 %",
          monitor: "203.0.113.1",
        },
      ],
      status: "ok",
    },
  },
};

let seenRequests: IntegrationHttpRequest[] = [];

function useFakeOpnsense(
  overrides: Record<string, { status: number; body?: unknown }> = {},
) {
  seenRequests = [];
  setIntegrationHttpTransportForTests(async (request) => {
    seenRequests.push(request);
    const pathname = request.url.pathname;
    const override = overrides[pathname];
    if (override) {
      return {
        status: override.status,
        headers: {},
        bodyText: override.body != null ? JSON.stringify(override.body) : "",
      };
    }
    const fixture = responses[pathname];
    if (!fixture) {
      return { status: 404, headers: {}, bodyText: "{}" };
    }
    return {
      status: fixture.status ?? 200,
      headers: {},
      bodyText: JSON.stringify(fixture.body),
    };
  });
}

afterEach(() => {
  setIntegrationHttpTransportForTests(null);
});

test("opnsense test reports product, version, and hostname via casing fallback", async () => {
  useFakeOpnsense();
  const result = await opnsenseIntegrationClient.test(connection);
  assert.equal(result.product, "OPNsense");
  assert.equal(result.version, "25.7.1");
  assert.equal(result.summary.hostname, "fw.lab.internal");

  const expectedAuth = `Basic ${Buffer.from("key-id:secret-value").toString("base64")}`;
  const infoRequest = seenRequests.find(
    (request) => request.url.pathname === "/api/core/firmware/info",
  );
  assert.equal(infoRequest?.headers?.Authorization, expectedAuth);
  assert.ok(
    seenRequests.some(
      (request) =>
        request.url.pathname === "/api/diagnostics/system/system_information",
    ),
    "expected snake_case fallback request",
  );
});

test("opnsense inventory maps interfaces, VLANs, DHCP ranges, and gateways", async () => {
  useFakeOpnsense();
  const inventory = await opnsenseIntegrationClient.fetchInventory(connection);

  assert.deepEqual(inventory.collection.vlans, [
    { vlanNumber: 10, name: "Servers" },
  ]);

  const subnetByCidr = new Map(
    inventory.collection.subnets.map((subnet) => [subnet.cidr, subnet]),
  );
  assert.equal(subnetByCidr.size, 3);
  assert.equal(subnetByCidr.get("192.168.1.0/24")?.name, "LAN");
  assert.equal(subnetByCidr.get("192.168.1.0/24")?.vlanNumber, null);
  assert.equal(subnetByCidr.get("10.0.10.0/24")?.vlanNumber, 10);
  assert.equal(subnetByCidr.get("203.0.113.0/24")?.name, "WAN");

  assert.deepEqual(inventory.collection.dhcpScopes, [
    {
      name: "Servers scope",
      startIp: "10.0.10.100",
      endIp: "10.0.10.199",
      subnetCidr: "10.0.10.0/24",
      note: "Kea DHCPv4 pool",
    },
    {
      name: "Servers scope",
      startIp: "10.0.10.225",
      endIp: "10.0.10.254",
      subnetCidr: "10.0.10.0/24",
      note: "Kea DHCPv4 pool",
    },
    {
      name: "Dnsmasq LAN",
      startIp: "192.168.1.100",
      endIp: "192.168.1.199",
      subnetCidr: null,
      note: "Dnsmasq DHCP range",
    },
  ]);

  assert.match(inventory.warnings.join(" "), /ISC dhcpd is running/);

  const kinds = inventory.devices.reduce<Record<string, number>>(
    (acc, device) => {
      acc[device.kind] = (acc[device.kind] ?? 0) + 1;
      return acc;
    },
    {},
  );
  assert.equal(kinds.firewall, 1);
  assert.equal(kinds.interface, 4);
  assert.equal(kinds.gateway, 1);

  const firewall = inventory.devices.find((device) => device.kind === "firewall");
  assert.equal(firewall?.name, "fw.lab.internal");
  assert.equal(firewall?.model, "OPNsense 25.7.1");
  const gateway = inventory.devices.find((device) => device.kind === "gateway");
  assert.equal(gateway?.status, "Online");
  assert.equal(gateway?.ipAddress, "203.0.113.1");
});

test("opnsense auth failures produce a clear error", async () => {
  useFakeOpnsense({
    "/api/core/firmware/info": { status: 401, body: { message: "denied" } },
  });
  await assert.rejects(
    opnsenseIntegrationClient.test(connection),
    /rejected the API key/,
  );
});
