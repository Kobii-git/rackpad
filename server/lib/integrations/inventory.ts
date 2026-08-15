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

export interface IntegrationInventory {
  collection: SnmpProfileCollection;
  devices: IntegrationDevicePreview[];
  warnings: string[];
}

export interface IntegrationClient {
  provider: IntegrationProvider;
  test(
    connection: IntegrationConnectionSecrets,
  ): Promise<IntegrationTestResult>;
  fetchInventory(
    connection: IntegrationConnectionSecrets,
  ): Promise<IntegrationInventory>;
}

const clients = new Map<IntegrationProvider, IntegrationClient>();
const testOverrides = new Map<IntegrationProvider, IntegrationClient | "none">();

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
