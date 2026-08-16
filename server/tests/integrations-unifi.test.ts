import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  setIntegrationHttpTransportForTests,
  type IntegrationHttpRequest,
} from "../lib/integrations/http.js";
import { unifiIntegrationClient } from "../lib/integrations/providers/unifi.js";
import type { IntegrationConnectionSecrets } from "../lib/integrations/types.js";

const apiKeyConnection: IntegrationConnectionSecrets = {
  id: "intg_unifi",
  labId: "lab_1",
  provider: "unifi",
  name: "UniFi console",
  baseUrl: "https://unifi.lab.internal",
  authKind: "api-key",
  authId: null,
  authSecret: "unifi-api-key",
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
  syncDevices: true,
  syncWifi: true,
};

const passwordConnection: IntegrationConnectionSecrets = {
  ...apiKeyConnection,
  authKind: "username-password",
  authId: "rackpad",
  authSecret: "view-only-password",
};

let seenRequests: IntegrationHttpRequest[] = [];

type FakeRoute = {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
};

function useFakeUnifi(routes: Record<string, FakeRoute>) {
  seenRequests = [];
  setIntegrationHttpTransportForTests(async (request) => {
    seenRequests.push(request);
    const key = `${request.method ?? "GET"} ${request.url.pathname}`;
    const route = routes[key];
    if (!route) {
      return { status: 404, headers: {}, bodyText: "{}" };
    }
    return {
      status: route.status,
      headers: route.headers ?? {},
      bodyText: route.body != null ? JSON.stringify(route.body) : "",
    };
  });
}

afterEach(() => {
  setIntegrationHttpTransportForTests(null);
});

const OFFICIAL_ROUTES: Record<string, FakeRoute> = {
  "GET /proxy/network/integration/v1/info": {
    status: 200,
    body: { applicationVersion: "10.1.84" },
  },
  "GET /proxy/network/integration/v1/sites": {
    status: 200,
    body: {
      offset: 0,
      limit: 200,
      count: 1,
      totalCount: 1,
      data: [
        { id: "site-uuid-1", internalReference: "default", name: "Home Lab" },
      ],
    },
  },
  "GET /proxy/network/integration/v1/sites/site-uuid-1/devices": {
    status: 200,
    body: {
      offset: 0,
      limit: 200,
      count: 2,
      totalCount: 2,
      data: [
        {
          id: "dev-1",
          macAddress: "94:2A:6F:26:C6:CA",
          ipAddress: "192.168.1.5",
          name: "Office Switch",
          model: "USW-24-POE",
          state: "ONLINE",
          features: ["switching"],
          interfaces: ["ports"],
          firmwareVersion: "6.6.55",
        },
        {
          id: "dev-2",
          macAddress: "94:2A:6F:11:22:33",
          ipAddress: "192.168.1.6",
          name: "Office AP",
          model: "U6-LR",
          state: "ONLINE",
          features: ["accessPoint"],
          interfaces: ["radios"],
          firmwareVersion: "6.6.55",
        },
      ],
    },
  },
  "GET /proxy/network/integration/v1/sites/site-uuid-1/networks": {
    status: 200,
    body: {
      offset: 0,
      limit: 200,
      count: 2,
      totalCount: 2,
      data: [
        {
          management: "GATEWAY",
          id: "net-1",
          name: "Default",
          enabled: true,
          vlanId: 1,
          default: true,
          metadata: { origin: "SYSTEM_DEFINED" },
        },
        {
          management: "SWITCH",
          id: "net-2",
          name: "Cameras",
          enabled: true,
          vlanId: 30,
          default: false,
          metadata: { origin: "USER_DEFINED" },
        },
      ],
    },
  },
  "GET /proxy/network/integration/v1/sites/site-uuid-1/networks/net-1": {
    status: 200,
    body: {
      management: "GATEWAY",
      id: "net-1",
      name: "Default",
      vlanId: 1,
      ipv4Configuration: {
        autoScaleEnabled: false,
        hostIpAddress: "192.168.1.1",
        prefixLength: 24,
        dhcpConfiguration: {
          mode: "SERVER",
          ipAddressRange: { start: "192.168.1.6", stop: "192.168.1.254" },
          leaseTimeSeconds: 86400,
        },
      },
    },
  },
};

test("unifi api-key mode reads the official integration API", async () => {
  useFakeUnifi(OFFICIAL_ROUTES);
  const result = await unifiIntegrationClient.test(apiKeyConnection);
  assert.equal(result.product, "UniFi Network");
  assert.equal(result.version, "10.1.84");
  assert.equal(result.summary.sites, 1);
  assert.equal(result.summary.apiMode, "api-key");

  const infoRequest = seenRequests.find((request) =>
    request.url.pathname.endsWith("/v1/info"),
  );
  assert.equal(infoRequest?.headers?.["X-API-Key"], "unifi-api-key");

  const inventory = await unifiIntegrationClient.fetchInventory(apiKeyConnection);
  assert.deepEqual(inventory.collection.vlans, [
    { vlanNumber: 1, name: "Default" },
    { vlanNumber: 30, name: "Cameras" },
  ]);
  assert.deepEqual(inventory.collection.subnets, [
    { cidr: "192.168.1.0/24", name: "Default", vlanNumber: 1 },
  ]);
  assert.deepEqual(inventory.collection.dhcpScopes, [
    {
      name: "Default DHCP",
      startIp: "192.168.1.6",
      endIp: "192.168.1.254",
      subnetCidr: "192.168.1.0/24",
      note: "UniFi DHCP server range",
    },
  ]);
  assert.deepEqual(
    inventory.devices.map((device) => [device.name, device.kind]),
    [
      ["Office Switch", "switch"],
      ["Office AP", "access-point"],
    ],
  );
  assert.equal(inventory.warnings.length, 0);
});

test("unifi api-key mode warns when networks need Network 10+", async () => {
  const routes = { ...OFFICIAL_ROUTES };
  delete routes["GET /proxy/network/integration/v1/sites/site-uuid-1/networks"];
  useFakeUnifi(routes);

  const inventory = await unifiIntegrationClient.fetchInventory(apiKeyConnection);
  assert.equal(inventory.devices.length, 2);
  assert.equal(inventory.collection.vlans.length, 0);
  assert.match(inventory.warnings.join(" "), /Network 10\+/);
});

const UNIFI_OS_ROUTES: Record<string, FakeRoute> = {
  "POST /api/auth/login": {
    status: 200,
    body: { unique_id: "user-1" },
    headers: { "set-cookie": ["TOKEN=jwt-token-value; path=/; HttpOnly"] },
  },
  "GET /proxy/network/api/self/sites": {
    status: 200,
    body: {
      meta: { rc: "ok" },
      data: [{ _id: "s1", name: "default", desc: "Home", role: "admin" }],
    },
  },
  "GET /proxy/network/api/s/default/stat/sysinfo": {
    status: 200,
    body: { meta: { rc: "ok" }, data: [{ version: "8.5.6" }] },
  },
  "GET /proxy/network/api/s/default/stat/device": {
    status: 200,
    body: {
      meta: { rc: "ok" },
      data: [
        {
          name: "Core Switch",
          type: "usw",
          model: "US24P250",
          mac: "aa:bb:cc:00:11:22",
          ip: "192.168.1.2",
          state: 1,
          version: "7.1.20",
        },
        {
          name: "Garage AP",
          type: "uap",
          model: "U7PG2",
          mac: "aa:bb:cc:00:11:33",
          ip: "192.168.1.3",
          state: 0,
          version: "6.6.77",
        },
      ],
    },
  },
  "GET /proxy/network/api/s/default/rest/networkconf": {
    status: 200,
    body: {
      meta: { rc: "ok" },
      data: [
        {
          _id: "n1",
          name: "LAN",
          purpose: "corporate",
          ip_subnet: "192.168.1.1/24",
          dhcpd_enabled: true,
          dhcpd_start: "192.168.1.100",
          dhcpd_stop: "192.168.1.200",
          vlan_enabled: false,
          enabled: true,
        },
        {
          _id: "n2",
          name: "Servers",
          purpose: "corporate",
          vlan: 10,
          vlan_enabled: true,
          ip_subnet: "10.0.10.1/24",
          dhcpd_enabled: false,
          enabled: true,
        },
        {
          _id: "n3",
          name: "WAN",
          purpose: "wan",
          wan_networkgroup: "WAN",
          wan_type: "dhcp",
        },
        {
          _id: "n4",
          name: "Cameras",
          purpose: "vlan-only",
          vlan: "40",
          vlan_enabled: true,
          enabled: true,
        },
      ],
    },
  },
};

test("unifi username-password mode drives the UniFi OS legacy API", async () => {
  useFakeUnifi(UNIFI_OS_ROUTES);
  const result = await unifiIntegrationClient.test(passwordConnection);
  assert.equal(result.version, "8.5.6");
  assert.equal(result.summary.apiMode, "unifi-os");

  const sitesRequest = seenRequests.find(
    (request) => request.url.pathname === "/proxy/network/api/self/sites",
  );
  assert.equal(sitesRequest?.headers?.Cookie, "TOKEN=jwt-token-value");

  const inventory =
    await unifiIntegrationClient.fetchInventory(passwordConnection);
  assert.deepEqual(inventory.collection.vlans, [
    { vlanNumber: 10, name: "Servers" },
    { vlanNumber: 40, name: "Cameras" },
  ]);
  assert.deepEqual(inventory.collection.subnets, [
    { cidr: "192.168.1.0/24", name: "LAN", vlanNumber: null },
    { cidr: "10.0.10.0/24", name: "Servers", vlanNumber: 10 },
  ]);
  assert.deepEqual(inventory.collection.dhcpScopes, [
    {
      name: "LAN DHCP",
      startIp: "192.168.1.100",
      endIp: "192.168.1.200",
      subnetCidr: "192.168.1.0/24",
      note: "UniFi DHCP server range",
    },
  ]);
  assert.deepEqual(
    inventory.devices.map((device) => [device.name, device.kind, device.status]),
    [
      ["Core Switch", "switch", "online"],
      ["Garage AP", "access-point", "offline"],
    ],
  );
});

test("unifi username-password mode falls back to the classic controller login", async () => {
  const classicRoutes: Record<string, FakeRoute> = {
    "POST /api/login": {
      status: 200,
      body: { meta: { rc: "ok" }, data: [] },
      headers: {
        "set-cookie": ["unifises=session-value; Path=/", "csrf_token=tok; Path=/"],
      },
    },
    "GET /api/self/sites": {
      status: 200,
      body: {
        meta: { rc: "ok" },
        data: [{ _id: "s1", name: "default", desc: "Home" }],
      },
    },
    "GET /api/s/default/stat/sysinfo": {
      status: 200,
      body: { meta: { rc: "ok" }, data: [{ version: "7.5.187" }] },
    },
  };
  useFakeUnifi(classicRoutes);

  const result = await unifiIntegrationClient.test(passwordConnection);
  assert.equal(result.version, "7.5.187");
  assert.equal(result.summary.apiMode, "classic");

  const sitesRequest = seenRequests.find(
    (request) => request.url.pathname === "/api/self/sites",
  );
  assert.equal(
    sitesRequest?.headers?.Cookie,
    "unifises=session-value; csrf_token=tok",
  );
});

test("unifi rejects bad credentials with a clear error", async () => {
  useFakeUnifi({
    "POST /api/auth/login": {
      status: 401,
      body: { code: "AUTHENTICATION_FAILED" },
    },
  });
  await assert.rejects(
    unifiIntegrationClient.test(passwordConnection),
    /rejected the username or password/,
  );

  useFakeUnifi({
    "GET /proxy/network/integration/v1/info": {
      status: 401,
      body: { statusCode: 401 },
    },
  });
  await assert.rejects(
    unifiIntegrationClient.test(apiKeyConnection),
    /rejected the API key/,
  );
});
