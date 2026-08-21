import type { SnmpProfileCollection } from "../snmp-profiles/types.js";
import type {
  IntegrationConnectionSecrets,
  IntegrationProvider,
} from "./types.js";

export interface IntegrationTestResult {
  product: string;
  version: string | null;
  summary: Record<string, unknown>;
}

export const INTEGRATION_DEVICE_KINDS = [
  "host",
  "vm",
  "container",
  "switch",
  "gateway",
  "access-point",
  "firewall",
  "bridge",
  "interface",
  "other",
] as const;
export type IntegrationDeviceKind = (typeof INTEGRATION_DEVICE_KINDS)[number];

export interface IntegrationDevicePreview {
  name: string;
  kind: IntegrationDeviceKind;
  model: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  status: string | null;
  detail: string | null;
}

export const INTEGRATION_PORT_KINDS = [
  "rj45",
  "sfp",
  "sfp_plus",
  "virtual",
  "qsfp",
  "wifi",
] as const;
export type IntegrationPortKind = (typeof INTEGRATION_PORT_KINDS)[number];

export interface IntegrationPortSpec {
  name: string;
  kind: IntegrationPortKind;
  speed: string | null;
  linkState: "up" | "down" | "unknown";
  // VLAN behavior when the controller exposes it: access ports carry an
  // untagged VLAN, trunks list the VLANs tagged on them.
  mode?: "access" | "trunk" | null;
  untaggedVlanNumber?: number | null;
  taggedVlanNumbers?: number[];
  macAddress?: string | null;
  // Virtual NICs: the vswitch this NIC attaches to (resolved on the
  // guest's parent host) and the addresses seen on it.
  virtualSwitchName?: string | null;
  ipAddresses?: string[];
}

// A hypervisor bridge/vswitch that becomes a Rackpad virtual switch on
// its host device.
export interface IntegrationVirtualSwitchSpec {
  providerRecordId?: string;
  name: string;
  hostName: string;
  kind: "external" | "internal" | "private";
  notes: string | null;
}

// A controller device that can become a real Rackpad device record
// (switches with their ports, gateways, APs, firewalls).
export interface IntegrationImportableDevice {
  providerRecordId?: string;
  name: string;
  deviceType:
    | "switch"
    | "router"
    | "firewall"
    | "ap"
    | "server"
    | "vm"
    | "container"
    | "other";
  model: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  serial: string | null;
  firmware: string | null;
  online: boolean | null;
  // Guests (vm/container) attach under this host device by name.
  parentName?: string | null;
  ports: IntegrationPortSpec[];
}

export interface IntegrationWifiSsid {
  providerRecordId?: string;
  name: string;
  vlanNumber: number | null;
  security: string | null;
  hidden: boolean;
}

export interface IntegrationWifiInventory {
  controllerName: string;
  vendor: string;
  managementIp: string | null;
  ssids: IntegrationWifiSsid[];
}

export interface IntegrationInventory {
  collection: SnmpProfileCollection;
  devices: IntegrationDevicePreview[];
  importableDevices?: IntegrationImportableDevice[];
  wifi?: IntegrationWifiInventory | null;
  virtualSwitches?: IntegrationVirtualSwitchSpec[];
  warnings: string[];
}

export interface IntegrationScope {
  id: string;
  label: string;
}

export interface IntegrationClient {
  provider: IntegrationProvider;
  test(
    connection: IntegrationConnectionSecrets,
  ): Promise<IntegrationTestResult>;
  fetchInventory(
    connection: IntegrationConnectionSecrets,
  ): Promise<IntegrationInventory>;
  listScopes?(
    connection: IntegrationConnectionSecrets,
  ): Promise<IntegrationScope[]>;
}

// Selected scopes (sites, nodes, environments) with the legacy single
// siteRef as a fallback for connections created before multi-select.
export function connectionScopeRefs(connection: IntegrationConnectionSecrets) {
  if (connection.scopeRefs.length > 0) return connection.scopeRefs;
  return connection.siteRef ? [connection.siteRef] : [];
}

const clients = new Map<IntegrationProvider, IntegrationClient>();
const testOverrides = new Map<
  IntegrationProvider,
  IntegrationClient | "none"
>();

export function registerIntegrationClient(client: IntegrationClient) {
  clients.set(client.provider, client);
}

export function getIntegrationClient(provider: IntegrationProvider) {
  const override = testOverrides.get(provider);
  if (override === "none") return null;
  return override ?? clients.get(provider) ?? null;
}

export function setIntegrationClientOverrideForTests(
  provider: IntegrationProvider,
  client: IntegrationClient | "none" | null,
) {
  if (client) {
    testOverrides.set(provider, client);
  } else {
    testOverrides.delete(provider);
  }
}
