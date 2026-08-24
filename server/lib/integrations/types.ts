export const INTEGRATION_PROVIDERS = [
  "proxmox",
  "unifi",
  "omada",
  "opnsense",
  "dockhand",
] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_AUTH_KINDS = [
  "api-token",
  "api-key",
  "username-password",
  "client-credentials",
  "key-secret",
] as const;
export type IntegrationAuthKind = (typeof INTEGRATION_AUTH_KINDS)[number];

export const INTEGRATION_CONNECTION_STATUSES = [
  "unknown",
  "ok",
  "error",
] as const;
export type IntegrationConnectionStatus =
  (typeof INTEGRATION_CONNECTION_STATUSES)[number];

// merge adds missing records only. skip builds an update-aware preview but
// skips every delete. Destructive mirror mode remains disabled until records
// have durable per-connection provenance.
export const INTEGRATION_AUTO_SYNC_MODES = ["merge", "skip"] as const;
export type IntegrationAutoSyncMode =
  (typeof INTEGRATION_AUTO_SYNC_MODES)[number];

export const INTEGRATION_SCOPE_KINDS = [
  "sites",
  "nodes",
  "environments",
] as const;
export type IntegrationScopeKind = (typeof INTEGRATION_SCOPE_KINDS)[number];

export interface IntegrationProviderInfo {
  id: IntegrationProvider;
  label: string;
  vendor: string;
  authKinds: IntegrationAuthKind[];
  defaultAuthKind: IntegrationAuthKind;
  scopeKind: IntegrationScopeKind | null;
}

export const INTEGRATION_PROVIDER_INFO: Record<
  IntegrationProvider,
  IntegrationProviderInfo
> = {
  proxmox: {
    id: "proxmox",
    label: "Proxmox VE",
    vendor: "Proxmox",
    authKinds: ["api-token"],
    defaultAuthKind: "api-token",
    scopeKind: "nodes",
  },
  unifi: {
    id: "unifi",
    label: "UniFi Network",
    vendor: "Ubiquiti",
    authKinds: ["api-key", "username-password"],
    defaultAuthKind: "api-key",
    scopeKind: "sites",
  },
  omada: {
    id: "omada",
    label: "Omada Controller",
    vendor: "TP-Link",
    authKinds: ["client-credentials"],
    defaultAuthKind: "client-credentials",
    scopeKind: "sites",
  },
  opnsense: {
    id: "opnsense",
    label: "OPNsense",
    vendor: "OPNsense",
    authKinds: ["key-secret"],
    defaultAuthKind: "key-secret",
    scopeKind: null,
  },
  dockhand: {
    id: "dockhand",
    label: "Dockhand",
    vendor: "Finsys",
    authKinds: ["api-key"],
    defaultAuthKind: "api-key",
    scopeKind: "environments",
  },
};

export interface IntegrationConnectionPublic {
  id: string;
  labId: string;
  provider: IntegrationProvider;
  name: string;
  baseUrl: string;
  authKind: IntegrationAuthKind;
  authId: string | null;
  hasSecret: boolean;
  siteRef: string | null;
  scopeRefs: string[];
  verifyTls: boolean;
  enabled: boolean;
  syncVlans: boolean;
  syncSubnets: boolean;
  syncDhcp: boolean;
  syncSwitches: boolean;
  syncGateways: boolean;
  syncAccessPoints: boolean;
  syncHosts: boolean;
  syncGuests: boolean;
  syncWifi: boolean;
  lastStatus: IntegrationConnectionStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  lastSummary: Record<string, unknown> | null;
  autoSyncEnabled: boolean;
  autoSyncMode: IntegrationAutoSyncMode;
  autoSyncCron: string | null;
  autoSyncLabIds: string[];
  autoSyncFailureCount: number;
  autoSyncPausedUntil: string | null;
  lastAutoSyncAt: string | null;
  lastAutoSyncStatus: "ok" | "error" | "drift" | null;
  lastAutoSyncMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationConnectionSecrets {
  id: string;
  labId: string;
  provider: IntegrationProvider;
  name: string;
  baseUrl: string;
  authKind: IntegrationAuthKind;
  authId: string | null;
  authSecret: string | null;
  siteRef: string | null;
  scopeRefs: string[];
  verifyTls: boolean;
  enabled: boolean;
  syncVlans: boolean;
  syncSubnets: boolean;
  syncDhcp: boolean;
  syncSwitches: boolean;
  syncGateways: boolean;
  syncAccessPoints: boolean;
  syncHosts: boolean;
  syncGuests: boolean;
  syncWifi: boolean;
  autoSyncEnabled: boolean;
  autoSyncMode: IntegrationAutoSyncMode;
  autoSyncCron: string | null;
  autoSyncLabIds: string[];
  autoSyncFailureCount: number;
  autoSyncPausedUntil: string | null;
}
