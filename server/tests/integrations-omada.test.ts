import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  setIntegrationHttpTransportForTests,
  type IntegrationHttpRequest,
} from "../lib/integrations/http.js";
import { omadaIntegrationClient } from "../lib/integrations/providers/omada.js";
import type { IntegrationConnectionSecrets } from "../lib/integrations/types.js";

const connection: IntegrationConnectionSecrets = {
  id: "intg_omada",
  labId: "lab_1",
  provider: "omada",
  name: "Omada controller",
  baseUrl: "https://omada.lab.internal:8043",
  authKind: "client-credentials",
  authId: "client-id-value",
  authSecret: "client-secret-value",
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
  syncSwitches: true,
  syncGateways: true,
  syncAccessPoints: true,
  syncHosts: true,
  syncGuests: true,
  syncWifi: true,
};

type FakeRoute = { status?: number; body: unknown };

const BASE_ROUTES: Record<string, FakeRoute> = {
  "GET /api/info": {
    body: {
      errorCode: 0,
      msg: "Success.",
      result: {
        omadacId: "omadac-22",
        controllerVer: "5.15.24.10",
        apiVer: "3",
      },
    },
  },
  "POST /openapi/authorize/token": {
    body: {
      errorCode: 0,
      msg: "Open API Get Access Token successfully.",
      result: {
        accessToken: "AT-access-token",
        tokenType: "bearer",
        expiresIn: 7200,
        refreshToken: "RT-refresh-token",
      },
    },
  },
  "GET /openapi/v1/omadac-22/sites": {
    body: {
      errorCode: 0,
      msg: "Success.",
      result: {
        totalRows: 1,
        currentPage: 1,
        currentSize: 1,
        data: [{ siteId: "site-1", name: "Main", region: "Germany" }],
      },
    },
  },
  "GET /openapi/v1/omadac-22/sites/site-1/devices": {
    body: {
      errorCode: 0,
      msg: "Success.",
      result: {
        totalRows: 3,
        currentPage: 1,
        currentSize: 3,
        data: [
          {
            mac: "AA-BB-CC-DD-EE-01",
            name: "Core Switch",
            type: "switch",
            model: "SG3428 v2.0",
            ip: "192.168.0.2",
            status: 1,
            firmwareVersion: "5.15.1",
          },
          {
            mac: "AA-BB-CC-DD-EE-02",
            name: "Edge Router",
            type: "gateway",
            model: "ER605 v2.0",
            ip: "192.168.0.1",
            status: 1,
            firmwareVersion: "2.2.6",
          },
          {
            mac: "AA-BB-CC-DD-EE-03",
            name: "Loft AP",
            type: "ap",
            model: "EAP670 v1.0",
            ip: "192.168.0.3",
            status: 0,
            firmwareVersion: "1.0.14",
          },
        ],
      },
    },
  },
  // v3 is absent on this firmware so the client must fall back to v2.
  "GET /openapi/v3/omadac-22/sites/site-1/lan-networks": {
    status: 404,
    body: {},
  },
  "GET /openapi/v2/omadac-22/sites/site-1/lan-networks": {
    body: {
      errorCode: 0,
      msg: "Success.",
      result: {
        totalRows: 2,
        currentPage: 1,
        currentSize: 2,
        data: [
          {
            id: "ln-1",
            name: "Default",
            purpose: 1,
            vlan: 1,
            gatewaySubnet: "192.168.0.1/24",
            allLan: true,
            primary: true,
            dhcpSettingsVO: {
              enable: true,
              ipRangePool: [
                { ipaddrStart: "192.168.0.100", ipaddrEnd: "192.168.0.199" },
              ],
              leasetime: 120,
            },
          },
          {
            id: "ln-2",
            name: "IoT",
            purpose: 0,
            vlan: 20,
            gatewaySubnet: "10.0.20.1/24",
            dhcpSettingsVO: { enable: false },
          },
        ],
      },
    },
  },
};

let seenRequests: IntegrationHttpRequest[] = [];

function useFakeOmada(overrides: Record<string, FakeRoute> = {}) {
  seenRequests = [];
  const routes = { ...BASE_ROUTES, ...overrides };
  setIntegrationHttpTransportForTests(async (request) => {
    seenRequests.push(request);
    const key = `${request.method ?? "GET"} ${request.url.pathname}`;
    const route = routes[key];
    if (!route) {
      return { status: 404, headers: {}, bodyText: "{}" };
    }
    return {
      status: route.status ?? 200,
      headers: {},
      bodyText: JSON.stringify(route.body),
    };
  });
}

afterEach(() => {
  setIntegrationHttpTransportForTests(null);
});

test("omada test discovers the omadacId and requests a client-credentials token", async () => {
  useFakeOmada();
  const result = await omadaIntegrationClient.test(connection);
  assert.equal(result.product, "Omada Controller");
  assert.equal(result.version, "5.15.24.10");
  assert.equal(result.summary.omadacId, "omadac-22");
  assert.equal(result.summary.sites, 1);

  const tokenRequest = seenRequests.find(
    (request) => request.url.pathname === "/openapi/authorize/token",
  );
  assert.equal(
    tokenRequest?.url.searchParams.get("grant_type"),
    "client_credentials",
  );
  assert.deepEqual(JSON.parse(tokenRequest?.body ?? "{}"), {
    omadacId: "omadac-22",
    client_id: "client-id-value",
    client_secret: "client-secret-value",
  });

  const sitesRequest = seenRequests.find(
    (request) => request.url.pathname === "/openapi/v1/omadac-22/sites",
  );
  assert.equal(
    sitesRequest?.headers?.Authorization,
    "AccessToken=AT-access-token",
  );
});

test("omada inventory maps devices, LAN networks, and DHCP pools with version fallback", async () => {
  useFakeOmada();
  const inventory = await omadaIntegrationClient.fetchInventory(connection);

  assert.deepEqual(
    inventory.devices.map((device) => [device.name, device.kind, device.status]),
    [
      ["Core Switch", "switch", "connected"],
      ["Edge Router", "gateway", "connected"],
      ["Loft AP", "access-point", "disconnected"],
    ],
  );
  // Dashed controller MACs are canonicalized to colon form.
  assert.equal(inventory.devices[0].macAddress, "AA:BB:CC:DD:EE:01");

  assert.deepEqual(inventory.collection.vlans, [
    { vlanNumber: 1, name: "Default" },
    { vlanNumber: 20, name: "IoT" },
  ]);
  assert.deepEqual(inventory.collection.subnets, [
    { cidr: "192.168.0.0/24", name: "Default", vlanNumber: 1 },
    { cidr: "10.0.20.0/24", name: "IoT", vlanNumber: 20 },
  ]);
  assert.deepEqual(inventory.collection.dhcpScopes, [
    {
      name: "Default DHCP",
      startIp: "192.168.0.100",
      endIp: "192.168.0.199",
      subnetCidr: "192.168.0.0/24",
      note: "Omada DHCP server range",
    },
  ]);
  assert.equal(inventory.warnings.length, 0);

  assert.ok(
    seenRequests.some((request) =>
      request.url.pathname.startsWith("/openapi/v3/"),
    ),
    "expected a v3 lan-networks attempt before falling back",
  );
});

test("omada warns when no lan-networks endpoint exists", async () => {
  useFakeOmada({
    "GET /openapi/v2/omadac-22/sites/site-1/lan-networks": {
      status: 404,
      body: {},
    },
    "GET /openapi/v1/omadac-22/sites/site-1/lan-networks": {
      status: 404,
      body: {},
    },
  });
  const inventory = await omadaIntegrationClient.fetchInventory(connection);
  assert.equal(inventory.devices.length, 3);
  assert.equal(inventory.collection.vlans.length, 0);
  assert.match(inventory.warnings.join(" "), /controller 5\.15\+ required/);
});

test("omada pagination stops at the structured page safety limit", async () => {
  useFakeOmada({
    "GET /openapi/v1/omadac-22/sites": {
      body: {
        errorCode: 0,
        msg: "Success.",
        result: {
          totalRows: 1_000,
          currentPage: 1,
          currentSize: 1,
          data: [{ siteId: "site-1", name: "Main", region: "Germany" }],
        },
      },
    },
  });

  await assert.rejects(
    () => omadaIntegrationClient.fetchInventory(connection),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "INTEGRATION_PAGINATION_LIMIT",
      );
      assert.match((error as Error).message, /100-page safety limit/);
      return true;
    },
  );
});

test("omada pagination stops at the structured record safety limit", async () => {
  useFakeOmada({
    "GET /openapi/v1/omadac-22/sites": {
      body: {
        errorCode: 0,
        msg: "Success.",
        result: {
          totalRows: 10_001,
          currentPage: 1,
          currentSize: 10_001,
          data: Array.from({ length: 10_001 }, (_, index) => ({
            siteId: `site-${index}`,
            name: `Site ${index}`,
            region: "Test",
          })),
        },
      },
    },
  });

  await assert.rejects(
    () => omadaIntegrationClient.fetchInventory(connection),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "INTEGRATION_PAGINATION_LIMIT",
      );
      assert.match((error as Error).message, /10,000-record safety limit/);
      return true;
    },
  );
});

test("omada surfaces controller error envelopes clearly", async () => {
  useFakeOmada({
    "POST /openapi/authorize/token": {
      body: {
        errorCode: -44106,
        msg: "The client id or client secret is invalid.",
      },
    },
  });
  await assert.rejects(
    omadaIntegrationClient.test(connection),
    /client id or client secret is invalid/,
  );
});
