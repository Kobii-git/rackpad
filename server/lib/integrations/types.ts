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

export interface IntegrationProviderInfo {
  id: IntegrationProvider;
  label: string;
  vendor: string;
  authKinds: IntegrationAuthKind[];
  defaultAuthKind: IntegrationAuthKind;
  supportsSiteRef: boolean;
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
    supportsSiteRef: false,
  },
  unifi: {
    id: "unifi",
    label: "UniFi Network",
    vendor: "Ubiquiti",
    authKinds: ["api-key", "username-password"],
    defaultAuthKind: "api-key",
    supportsSiteRef: true,
  },
  omada: {
    id: "omada",
    label: "Omada Controller",
    vendor: "TP-Link",
    authKinds: ["client-credentials"],
    defaultAuthKind: "client-credentials",
    supportsSiteRef: true,
  },
  opnsense: {
    id: "opnsense",
    label: "OPNsense",
    vendor: "OPNsense",
    authKinds: ["key-secret"],
    defaultAuthKind: "key-secret",
    supportsSiteRef: false,
  },
  dockhand: {
    id: "dockhand",
    label: "Dockhand",
    vendor: "Finsys",
    authKinds: ["api-key"],
    defaultAuthKind: "api-key",
    supportsSiteRef: true,
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
  verifyTls: boolean;
  enabled: boolean;
  syncVlans: boolean;
  syncSubnets: boolean;
  syncDhcp: boolean;
  lastStatus: IntegrationConnectionStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  lastSummary: Record<string, unknown> | null;
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
  verifyTls: boolean;
  enabled: boolean;
  syncVlans: boolean;
  syncSubnets: boolean;
  syncDhcp: boolean;
}
