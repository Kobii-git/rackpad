import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  setIntegrationHttpTransportForTests,
  type IntegrationHttpRequest,
} from "../lib/integrations/http.js";
import { dockhandIntegrationClient } from "../lib/integrations/providers/dockhand.js";
import type { IntegrationConnectionSecrets } from "../lib/integrations/types.js";

const connection: IntegrationConnectionSecrets = {
  id: "intg_dockhand",
  labId: "lab_1",
  provider: "dockhand",
  name: "Dockhand",
  baseUrl: "http://dockhand.lab.internal:3000",
  authKind: "api-key",
  authId: null,
  authSecret: "dh_test-token-value",
  siteRef: null,
  scopeRefs: [],
  autoSyncEnabled: false,
  autoSyncMode: "merge",
  autoSyncCron: null,
  autoSyncLabIds: [],
  autoSyncFailureCount: 0,
  autoSyncPausedUntil: null,
  verifyTls: true,
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

const ENVIRONMENTS = [
  {
    id: 1,
    name: "homelab",
    host: "10.0.0.50",
    port: 2375,
    protocol: "http",
    connectionType: "direct",
    icon: "server",
  },
  {
    id: 2,
    name: "nas",
    host: null,
    port: 2375,
    protocol: "http",
    connectionType: "socket",
    icon: "server",
  },
];

const STATS = [
  {
    id: 1,
    name: "homelab",
    online: true,
    containers: { total: 3, running: 2, stopped: 1 },
    images: { total: 5 },
    volumes: { total: 2 },
    networks: { total: 2 },
    stacks: { total: 1, running: 1 },
  },
  {
    id: 2,
    name: "nas",
    online: false,
    containers: { total: 0, running: 0, stopped: 0 },
    stacks: { total: 0 },
  },
];

const CONTAINERS_ENV1 = [
  {
    id: "abc123def456",
    name: "web-01",
    image: "nginx:1.25",
    imageId: "sha256:aaa",
    state: "running",
    status: "Up 2 hours (healthy)",
    created: 1750000000,
    health: "healthy",
    restartCount: 0,
    networks: { bridge: { ipAddress: "172.17.0.2" } },
    labels: { "com.docker.compose.project": "webstack" },
    ports: [{ PrivatePort: 80, PublicPort: 8080, Type: "tcp" }],
    mounts: [],
    command: "nginx -g daemon off;",
  },
];

const NETWORKS_ENV1 = [
  {
    id: "net1",
    name: "lan-macvlan",
    driver: "macvlan",
    scope: "local",
    internal: false,
    ipam: {
      driver: "default",
      config: [{ subnet: "192.168.1.0/24", gateway: "192.168.1.1" }],
    },
    containers: { abc123def456: { name: "web-01", ipv4Address: "192.168.1.50/24" } },
  },
];

let seenRequests: IntegrationHttpRequest[] = [];

function useFakeDockhand(
  overrides: Record<string, { status: number; body?: unknown; text?: string }> = {},
) {
  seenRequests = [];
  setIntegrationHttpTransportForTests(async (request) => {
    seenRequests.push(request);
    const pathname = request.url.pathname;
    const env = request.url.searchParams.get("env");
    const key = env ? `${pathname}?env=${env}` : pathname;
    const override = overrides[key] ?? overrides[pathname];
    if (override) {
      return {
        status: override.status,
        headers: {},
        bodyText:
          override.text ??
          (override.body != null ? JSON.stringify(override.body) : ""),
      };
    }
    if (pathname === "/api/environments") {
      return { status: 200, headers: {}, bodyText: JSON.stringify(ENVIRONMENTS) };
    }
    if (pathname === "/metrics") {
      return {
        status: 200,
        headers: {},
        bodyText:
          '# HELP dockhand_build_info Build info\ndockhand_build_info{version="1.0.42",node="bun"} 1\n',
      };
    }
    if (pathname === "/api/dashboard/stats") {
      return { status: 200, headers: {}, bodyText: JSON.stringify(STATS) };
    }
    if (pathname === "/api/containers" && env === "1") {
      return {
        status: 200,
        headers: {},
        bodyText: JSON.stringify(CONTAINERS_ENV1),
      };
    }
    if (pathname === "/api/networks" && env === "1") {
      return { status: 200, headers: {}, bodyText: JSON.stringify(NETWORKS_ENV1) };
    }
    return { status: 404, headers: {}, bodyText: '{"error":"Not found"}' };
  });
}

afterEach(() => {
  setIntegrationHttpTransportForTests(null);
});

test("dockhand test lists environments and reads the version from metrics", async () => {
  useFakeDockhand();
  const result = await dockhandIntegrationClient.test(connection);
  assert.equal(result.product, "Dockhand");
  assert.equal(result.version, "1.0.42");
  assert.equal(result.summary.environments, 2);
  assert.deepEqual(result.summary.environmentNames, ["homelab", "nas"]);

  const environmentsRequest = seenRequests.find(
    (request) => request.url.pathname === "/api/environments",
  );
  assert.equal(
    environmentsRequest?.headers?.Authorization,
    "Bearer dh_test-token-value",
  );
});

test("dockhand inventory maps environments, containers, and Docker networks", async () => {
  useFakeDockhand();
  const inventory = await dockhandIntegrationClient.fetchInventory(connection);

  // Container plumbing never feeds IPAM; everything arrives as previews.
  assert.deepEqual(inventory.collection, {
    vlans: [],
    subnets: [],
    dhcpScopes: [],
  });

  const hosts = inventory.devices.filter((device) => device.kind === "host");
  assert.deepEqual(
    hosts.map((device) => [device.name, device.status]),
    [
      ["homelab", "online"],
      ["nas", "offline"],
    ],
  );
  assert.match(hosts[0].detail ?? "", /2\/3 containers running/);

  const container = inventory.devices.find(
    (device) => device.kind === "container",
  );
  assert.equal(container?.name, "web-01");
  assert.equal(container?.model, "nginx:1.25");
  assert.equal(container?.ipAddress, "172.17.0.2");
  assert.equal(container?.status, "running (healthy)");
  assert.equal(container?.detail, "stack: webstack");

  const network = inventory.devices.find((device) => device.kind === "bridge");
  assert.equal(network?.name, "homelab/lan-macvlan");
  assert.match(network?.detail ?? "", /macvlan · 192\.168\.1\.0\/24 · 1 container/);

  assert.match(inventory.warnings.join(" "), /nas is offline/);
  assert.match(inventory.warnings.join(" "), /not applied to IPAM/);
  assert.ok(
    !seenRequests.some(
      (request) =>
        request.url.pathname === "/api/containers" &&
        request.url.searchParams.get("env") === "2",
    ),
    "offline environments must not be queried for containers",
  );
});

test("dockhand honors the environment filter and reports unknown refs", async () => {
  useFakeDockhand();
  const filtered = await dockhandIntegrationClient.fetchInventory({
    ...connection,
    siteRef: "nas",
  });
  assert.deepEqual(
    filtered.devices.map((device) => device.name),
    ["nas"],
  );

  await assert.rejects(
    dockhandIntegrationClient.fetchInventory({
      ...connection,
      siteRef: "missing-env",
    }),
    /Available environments: homelab, nas/,
  );
});

test("dockhand rejects invalid tokens with a clear error", async () => {
  useFakeDockhand({
    "/api/environments": {
      status: 401,
      body: { error: "Unauthorized", message: "Authentication required" },
    },
  });
  await assert.rejects(
    dockhandIntegrationClient.test(connection),
    /rejected the API token/,
  );
});
