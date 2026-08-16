import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  setIntegrationHttpTransportForTests,
  type IntegrationHttpRequest,
} from "../lib/integrations/http.js";
import { proxmoxIntegrationClient } from "../lib/integrations/providers/proxmox.js";
import type { IntegrationConnectionSecrets } from "../lib/integrations/types.js";

const connection: IntegrationConnectionSecrets = {
  id: "intg_pve",
  labId: "lab_1",
  provider: "proxmox",
  name: "PVE cluster",
  baseUrl: "https://pve.lab.internal:8006",
  authKind: "api-token",
  authId: "rackpad@pam!inventory",
  authSecret: "token-secret-uuid",
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

const GIB = 1024 ** 3;

const responses: Record<string, unknown> = {
  "/api2/json/version": {
    data: { version: "8.2.4", release: "8.2", repoid: "faf36e24" },
  },
  "/api2/json/nodes": {
    data: [
      { node: "pve2", status: "online", maxcpu: 8, maxmem: 32 * GIB },
      { node: "pve1", status: "online", maxcpu: 16, maxmem: 64 * GIB },
    ],
  },
  "/api2/json/cluster/status": {
    data: [
      { type: "cluster", name: "homelab", quorate: 1, nodes: 2 },
      { type: "node", name: "pve1", online: 1 },
    ],
  },
  "/api2/json/cluster/resources": {
    data: [
      {
        vmid: 100,
        type: "qemu",
        name: "web01",
        node: "pve1",
        status: "running",
      },
      { vmid: 101, type: "lxc", name: "db01", node: "pve1", status: "running" },
    ],
  },
  "/api2/json/nodes/pve1/network": {
    data: [
      {
        iface: "vmbr0",
        type: "bridge",
        address: "10.0.0.2",
        netmask: "255.255.255.0",
        cidr: "10.0.0.2/24",
        gateway: "10.0.0.1",
        bridge_ports: "eno1",
        active: 1,
      },
      { iface: "eno1", type: "eth", active: 1 },
      { iface: "vmbr0.20", type: "vlan", cidr: "10.0.20.2/24", active: 1 },
    ],
  },
  "/api2/json/nodes/pve2/network": { data: [] },
  "/api2/json/nodes/pve2/qemu": { data: [] },
  "/api2/json/nodes/pve2/lxc": { data: [] },
  "/api2/json/cluster/sdn/vnets": {
    data: [{ vnet: "vnet10", zone: "zone1", tag: 10, alias: "Servers" }],
  },
  "/api2/json/cluster/sdn/vnets/vnet10/subnets": {
    data: [
      {
        subnet: "zone1-10.0.10.0-24",
        cidr: "10.0.10.0/24",
        gateway: "10.0.10.1",
        "dhcp-range": [
          { "start-address": "10.0.10.100", "end-address": "10.0.10.200" },
        ],
      },
    ],
  },
  "/api2/json/nodes/pve1/status": {
    data: {
      pveversion: "pve-manager/8.2.4/faf36e24",
      kversion: "Linux 6.8.12-1-pve",
      cpuinfo: { cpus: 16, model: "EPYC" },
      memory: { total: 64 * GIB, used: 32 * GIB },
    },
  },
  "/api2/json/nodes/pve1/qemu": {
    data: [{ vmid: 100, name: "web01", status: "running" }],
  },
  "/api2/json/nodes/pve1/qemu/100/config": {
    data: {
      name: "web01",
      cores: 4,
      sockets: 1,
      memory: 8192,
      ostype: "l26",
      onboot: 1,
      machine: "q35",
      scsi0: "local-lvm:vm-100-disk-0,size=32G",
      ide2: "local:iso/debian.iso,media=cdrom",
      net0: "virtio=AA:BB:CC:DD:EE:01,bridge=vmbr0,tag=20",
      description: "main web server",
    },
  },
  "/api2/json/nodes/pve1/qemu/100/status/current": {
    data: {
      status: "running",
      maxmem: 8 * GIB,
      mem: 2 * GIB,
      maxdisk: 34359738368,
      cpus: 4,
      uptime: 3600,
    },
  },
  "/api2/json/nodes/pve1/qemu/100/agent/network-get-interfaces": {
    data: {
      result: [
        {
          name: "eth0",
          "hardware-address": "aa:bb:cc:dd:ee:01",
          "ip-addresses": [
            {
              "ip-address": "10.0.20.5",
              "ip-address-type": "ipv4",
              prefix: 24,
            },
            { "ip-address": "fe80::1", "ip-address-type": "ipv6", prefix: 64 },
          ],
        },
      ],
    },
  },
  "/api2/json/nodes/pve1/lxc": {
    data: [{ vmid: 101, name: "db01", status: "running" }],
  },
  "/api2/json/nodes/pve1/lxc/101/config": {
    data: {
      hostname: "db01",
      cores: 2,
      memory: 2048,
      swap: 512,
      ostype: "debian",
      rootfs: "local-lvm:vm-101-disk-0,size=8G",
      net0: "name=eth0,bridge=vmbr0,hwaddr=AA:BB:CC:DD:EE:02,ip=dhcp,tag=30",
      unprivileged: 1,
      onboot: 0,
    },
  },
  "/api2/json/nodes/pve1/lxc/101/status/current": {
    data: { status: "running", maxmem: 2 * GIB, mem: GIB / 2, uptime: 100 },
  },
  "/api2/json/nodes/pve1/lxc/101/interfaces": {
    data: [{ name: "eth0", hwaddr: "aa:bb:cc:dd:ee:02", inet: "10.0.30.7/24" }],
  },
};

let seenRequests: IntegrationHttpRequest[] = [];

function useFakeProxmox(
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
    const body = responses[pathname];
    if (!body) {
      return {
        status: 404,
        headers: {},
        bodyText: JSON.stringify({ data: null }),
      };
    }
    return { status: 200, headers: {}, bodyText: JSON.stringify(body) };
  });
}

afterEach(() => {
  setIntegrationHttpTransportForTests(null);
});

test("proxmox test reports version, cluster, and workload counts", async () => {
  useFakeProxmox();
  const result = await proxmoxIntegrationClient.test(connection);
  assert.equal(result.product, "Proxmox VE");
  assert.equal(result.version, "8.2.4");
  assert.equal(result.summary.cluster, "homelab");
  assert.equal(result.summary.nodes, 2);
  assert.deepEqual(result.summary.nodeNames, ["pve1", "pve2"]);
  assert.equal(result.summary.qemu, 1);
  assert.equal(result.summary.lxc, 1);

  const versionRequest = seenRequests.find(
    (request) => request.url.pathname === "/api2/json/version",
  );
  assert.equal(
    versionRequest?.headers?.Authorization,
    "PVEAPIToken=rackpad@pam!inventory=token-secret-uuid",
  );
  assert.equal(versionRequest?.verifyTls, false);
});

test("proxmox inventory maps bridges, SDN vnets, and DHCP ranges", async () => {
  useFakeProxmox();
  const inventory = await proxmoxIntegrationClient.fetchInventory(connection);

  assert.deepEqual(inventory.collection.vlans, [
    { vlanNumber: 10, name: "Servers" },
  ]);
  const subnetByCidr = new Map(
    inventory.collection.subnets.map((subnet) => [subnet.cidr, subnet]),
  );
  assert.ok(subnetByCidr.has("10.0.0.0/24"));
  assert.equal(subnetByCidr.get("10.0.20.0/24")?.vlanNumber, 20);
  assert.equal(subnetByCidr.get("10.0.10.0/24")?.vlanNumber, 10);
  assert.deepEqual(inventory.collection.dhcpScopes, [
    {
      name: "vnet10 DHCP",
      startIp: "10.0.10.100",
      endIp: "10.0.10.200",
      subnetCidr: "10.0.10.0/24",
      note: "Proxmox SDN DHCP range",
    },
  ]);

  const kinds = inventory.devices.reduce<Record<string, number>>(
    (acc, device) => {
      acc[device.kind] = (acc[device.kind] ?? 0) + 1;
      return acc;
    },
    {},
  );
  assert.equal(kinds.host, 2);
  assert.equal(kinds.vm, 1);
  assert.equal(kinds.container, 1);
  assert.equal(kinds.bridge, 2);
  assert.equal(inventory.warnings.length, 0);

  // The whole stack imports from the host down: nodes as servers, bridges
  // as virtual switches, guests with NICs/MACs/VLAN tags/IPs.
  const importables = new Map(
    (inventory.importableDevices ?? []).map((device) => [device.name, device]),
  );
  assert.deepEqual([...importables.keys()].sort(), [
    "db01",
    "pve1",
    "pve2",
    "web01",
  ]);
  assert.equal(importables.get("pve1")?.deviceType, "server");
  const web = importables.get("web01")!;
  assert.equal(web.deviceType, "vm");
  assert.equal(web.parentName, "pve1");
  assert.equal(web.macAddress, "AA:BB:CC:DD:EE:01");
  assert.equal(web.ipAddress, "10.0.20.5");
  assert.deepEqual(
    web.ports.map((port) => [
      port.name,
      port.kind,
      port.virtualSwitchName,
      port.mode,
      port.untaggedVlanNumber,
      port.macAddress,
      port.ipAddresses,
    ]),
    [
      [
        "net0",
        "virtual",
        "vmbr0",
        "access",
        20,
        "AA:BB:CC:DD:EE:01",
        ["10.0.20.5"],
      ],
    ],
  );
  const dbCt = importables.get("db01")!;
  assert.equal(dbCt.deviceType, "container");
  assert.equal(dbCt.parentName, "pve1");
  assert.equal(dbCt.ports[0]?.untaggedVlanNumber, 30);
  assert.equal(dbCt.ports[0]?.macAddress, "AA:BB:CC:DD:EE:02");
  assert.deepEqual(dbCt.ports[0]?.ipAddresses, ["10.0.30.7"]);
  assert.deepEqual(inventory.virtualSwitches, [
    {
      name: "vmbr0",
      hostName: "pve1",
      kind: "external",
      notes: "Members: eno1",
    },
  ]);
});

test("proxmox auth failures produce a clear error", async () => {
  useFakeProxmox({
    "/api2/json/version": { status: 401, body: { data: null } },
  });
  await assert.rejects(
    proxmoxIntegrationClient.test(connection),
    /rejected the API token/,
  );
});
