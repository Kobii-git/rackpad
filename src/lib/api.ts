import type {
  AlertSettings,
  AppUser,
  AuditEntry,
  AuthSession,
  Device,
  DeviceImage,
  DeviceService,
  DeviceTypeDefinition,
  DeviceMonitor,
  DocumentationPage,
  DiscoveredDevice,
  DiscoveryScanResult,
  DhcpScope,
  IpAssignment,
  IpZone,
  Lab,
  Port,
  PortLink,
  PortTemplate,
  OidcPublicConfig,
  Rack,
  ReferenceImage,
  ReferenceImageEntityType,
  Room,
  Subnet,
  UserRole,
  Vlan,
  VlanRange,
  VirtualSwitch,
  WifiAccessPoint,
  WifiClientAssociation,
  WifiController,
  WifiRadio,
  WifiSsid,
} from "./types";

const API_BASE = "/api";
const TOKEN_STORAGE_KEY = "rackpad.auth.token";

type QueryValue = string | number | boolean | undefined | null;
type Nullable<T> = {
  [K in keyof T]?: T[K] | null;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type DevicePatch = Nullable<Omit<Device, "id" | "labId">>;
export type DeviceImagePatch = Nullable<Pick<DeviceImage, "label" | "notes">>;
export type DeviceServicePatch = Nullable<
  Pick<
    DeviceService,
    | "deviceId"
    | "name"
    | "serviceType"
    | "ipAssignmentId"
    | "portId"
    | "vlanId"
    | "monitorId"
    | "url"
    | "notes"
  >
>;
export type ReferenceImagePatch = Nullable<
  Pick<ReferenceImage, "label" | "notes" | "face">
>;
export type DocumentationPagePatch = Nullable<
  Pick<DocumentationPage, "title" | "content">
>;
export type LabPatch = Nullable<Omit<Lab, "id">>;
export type RoomPatch = Nullable<Omit<Room, "id" | "labId">>;
export type RackPatch = Nullable<Omit<Rack, "id" | "labId">>;
export type SubnetPatch = Nullable<Omit<Subnet, "id" | "labId">>;
export type DhcpScopePatch = Nullable<Omit<DhcpScope, "id" | "subnetId">>;
export type IpZonePatch = Nullable<Omit<IpZone, "id" | "subnetId">>;
export type IpAssignmentPatch = Nullable<Omit<IpAssignment, "id">>;
export type VlanPatch = Nullable<Omit<Vlan, "id" | "labId">>;
export type VlanRangePatch = Nullable<Omit<VlanRange, "id" | "labId">>;
export type PortPatch = Nullable<Omit<Port, "id" | "deviceId" | "position">>;
export type VirtualSwitchPatch = Nullable<
  Pick<VirtualSwitch, "name" | "kind" | "membersShareHostIp" | "notes">
>;
export type PortLinkPatch = Nullable<Omit<PortLink, "id">>;
export type PortTemplatePatch = Nullable<
  Pick<PortTemplate, "name" | "description" | "deviceTypes" | "ports">
>;
export type DiscoveredDevicePatch = Nullable<
  Pick<
    DiscoveredDevice,
    | "hostname"
    | "displayName"
    | "deviceType"
    | "placement"
    | "status"
    | "notes"
    | "importedDeviceId"
    | "lastSeen"
  >
>;
export type WifiControllerPatch = Nullable<
  Pick<
    WifiController,
    "deviceId" | "name" | "vendor" | "model" | "managementIp" | "notes"
  >
>;
export type WifiSsidPatch = Nullable<
  Pick<
    WifiSsid,
    "name" | "purpose" | "security" | "hidden" | "vlanId" | "color"
  >
>;
export type WifiAccessPointPatch = Nullable<
  Pick<
    WifiAccessPoint,
    "controllerId" | "location" | "firmwareVersion" | "notes"
  >
>;
export type WifiRadioPatch = Nullable<
  Pick<
    WifiRadio,
    | "slotName"
    | "band"
    | "channel"
    | "channelWidth"
    | "txPower"
    | "ssidIds"
    | "notes"
  >
>;
export type WifiClientAssociationPatch = Nullable<
  Pick<
    WifiClientAssociation,
    | "apDeviceId"
    | "radioId"
    | "ssidId"
    | "band"
    | "channel"
    | "signalDbm"
    | "lastSeen"
    | "lastRoamAt"
    | "notes"
  >
>;
export type UserPatch = Nullable<
  Pick<AppUser, "username" | "displayName" | "role" | "disabled">
> & {
  password?: string | null;
};
export type MonitorPatch = Nullable<
  Pick<
    DeviceMonitor,
    | "name"
    | "type"
    | "target"
    | "port"
    | "path"
    | "snmpVersion"
    | "snmpCommunity"
    | "snmpOid"
    | "snmpExpectedValue"
    | "intervalMs"
    | "enabled"
  >
>;

export interface AuthStatus {
  needsBootstrap: boolean;
  oidc: OidcPublicConfig;
}

let authToken = readStoredToken();

function readStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getAuthToken() {
  return authToken;
}

export function setAuthToken(token: string | null) {
  authToken = token;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures and keep the in-memory token.
  }
}

function buildUrl(path: string, query?: Record<string, QueryValue>) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return `${url.pathname}${url.search}`;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  query?: Record<string, QueryValue>,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body != null) {
    headers.set("Content-Type", "application/json");
  }
  if (authToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const res = await fetch(buildUrl(path, query), {
    ...init,
    headers,
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the fallback message.
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

async function requestBlob(
  path: string,
  init?: RequestInit,
  query?: Record<string, QueryValue>,
): Promise<{ blob: Blob; filename: string | null }> {
  const headers = new Headers(init?.headers);
  if (authToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const res = await fetch(buildUrl(path, query), {
    ...init,
    headers,
  });

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the fallback message.
    }
    throw new ApiError(message, res.status);
  }

  const disposition = res.headers.get("content-disposition");
  const filenameMatch = disposition?.match(/filename="?([^"]+)"?/);

  return {
    blob: await res.blob(),
    filename: filenameMatch?.[1] ?? null,
  };
}

export const api = {
  getAuthStatus() {
    return request<AuthStatus>("/auth/status");
  },

  bootstrap(body: {
    username: string;
    displayName?: string;
    password: string;
    loadDemoData?: boolean;
  }) {
    return request<AuthSession>("/auth/bootstrap", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  login(body: { username: string; password: string }) {
    return request<AuthSession>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  completeOidcLogin(body: { session: string }) {
    return request<AuthSession & { returnTo?: string }>("/auth/oidc/session", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getCurrentSession() {
    return request<{ user: AppUser; expiresAt: string }>("/auth/me");
  },

  logout() {
    return request<void>("/auth/logout", {
      method: "POST",
    });
  },

  getUsers() {
    return request<AppUser[]>("/users");
  },

  getLabs() {
    return request<Lab[]>("/labs");
  },

  createLab(body: Omit<Lab, "id"> & { id?: string }) {
    return request<Lab>("/labs", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateLab(id: string, body: LabPatch) {
    return request<Lab>(`/labs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteLab(id: string) {
    return request<void>(`/labs/${id}`, {
      method: "DELETE",
    });
  },

  createUser(body: {
    username: string;
    displayName?: string;
    password: string;
    role: UserRole;
    disabled?: boolean;
  }) {
    return request<AppUser>("/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateUser(id: string, body: UserPatch) {
    return request<AppUser>(`/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteUser(id: string) {
    return request<void>(`/users/${id}`, {
      method: "DELETE",
    });
  },

  downloadAdminBackup() {
    return requestBlob("/admin/export");
  },

  restoreAdminBackup(body: unknown) {
    return request<{
      restored: boolean;
      requiresLogin: boolean;
      counts: Record<string, number>;
    }>("/admin/restore", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getAlertSettings() {
    return request<AlertSettings>("/admin/alert-settings");
  },

  updateAlertSettings(body: AlertSettings) {
    return request<AlertSettings>("/admin/alert-settings", {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  sendAlertSettingsTest() {
    return request<{
      delivered: boolean;
      channels: Array<{ channel: string; delivered: boolean }>;
    }>("/admin/alert-settings/test", {
      method: "POST",
    });
  },

  getRooms(params?: { labId?: string }) {
    return request<Room[]>("/rooms", undefined, params);
  },

  createRoom(body: Omit<Room, "id"> & { id?: string }) {
    return request<Room>("/rooms", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateRoom(id: string, body: RoomPatch) {
    return request<Room>(`/rooms/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteRoom(id: string) {
    return request<void>(`/rooms/${id}`, {
      method: "DELETE",
    });
  },

  getRacks(params?: { labId?: string }) {
    return request<Rack[]>("/racks", undefined, params);
  },

  createRack(body: Omit<Rack, "id"> & { id?: string }) {
    return request<Rack>("/racks", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateRack(id: string, body: RackPatch) {
    return request<Rack>(`/racks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteRack(id: string) {
    return request<void>(`/racks/${id}`, {
      method: "DELETE",
    });
  },

  getDevices(params?: { rackId?: string; labId?: string }) {
    return request<Device[]>("/devices", undefined, params);
  },

  getDocumentationPages(params?: { labId?: string }) {
    return request<DocumentationPage[]>("/documentation", undefined, params);
  },

  createDocumentationPage(
    body: Omit<DocumentationPage, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ) {
    return request<DocumentationPage>("/documentation", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateDocumentationPage(id: string, body: DocumentationPagePatch) {
    return request<DocumentationPage>(`/documentation/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteDocumentationPage(id: string) {
    return request<void>(`/documentation/${id}`, {
      method: "DELETE",
    });
  },

  getDeviceImages(params?: { deviceId?: string; labId?: string }) {
    return request<DeviceImage[]>("/device-images", undefined, params);
  },

  createDeviceImage(
    body: Omit<DeviceImage, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ) {
    return request<DeviceImage>("/device-images", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateDeviceImage(id: string, body: DeviceImagePatch) {
    return request<DeviceImage>(`/device-images/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteDeviceImage(id: string) {
    return request<void>(`/device-images/${id}`, {
      method: "DELETE",
    });
  },

  getDeviceServices(params?: { deviceId?: string }) {
    return request<DeviceService[]>("/device-services", undefined, params);
  },

  createDeviceService(
    body: Omit<DeviceService, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ) {
    return request<DeviceService>("/device-services", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateDeviceService(id: string, body: DeviceServicePatch) {
    return request<DeviceService>(`/device-services/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteDeviceService(id: string) {
    return request<void>(`/device-services/${id}`, {
      method: "DELETE",
    });
  },

  getReferenceImages(params?: {
    labId?: string;
    entityType?: ReferenceImageEntityType;
    entityId?: string;
  }) {
    return request<ReferenceImage[]>("/reference-images", undefined, params);
  },

  createReferenceImage(
    body: Omit<ReferenceImage, "id" | "labId" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ) {
    return request<ReferenceImage>("/reference-images", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateReferenceImage(id: string, body: ReferenceImagePatch) {
    return request<ReferenceImage>(`/reference-images/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteReferenceImage(id: string) {
    return request<void>(`/reference-images/${id}`, {
      method: "DELETE",
    });
  },

  getDeviceTypes() {
    return request<DeviceTypeDefinition[]>("/device-types");
  },

  createDeviceType(body: { id?: string; label: string }) {
    return request<DeviceTypeDefinition>("/device-types", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getVirtualSwitches(params?: { labId?: string; hostDeviceId?: string }) {
    return request<VirtualSwitch[]>("/virtual-switches", undefined, params);
  },

  createVirtualSwitch(body: Omit<VirtualSwitch, "id"> & { id?: string }) {
    return request<VirtualSwitch>("/virtual-switches", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateVirtualSwitch(id: string, body: VirtualSwitchPatch) {
    return request<VirtualSwitch>(`/virtual-switches/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteVirtualSwitch(id: string) {
    return request<void>(`/virtual-switches/${id}`, {
      method: "DELETE",
    });
  },

  getDevice(id: string) {
    return request<Device>(`/devices/${id}`);
  },

  createDevice(
    body: Omit<Device, "id"> & { id?: string; portTemplateId?: string },
  ) {
    return request<Device>("/devices", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateDevice(
    id: string,
    body: DevicePatch & { portTemplateId?: string | null },
  ) {
    return request<Device>(`/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteDevice(id: string) {
    return request<void>(`/devices/${id}`, {
      method: "DELETE",
    });
  },

  getPortTemplates() {
    return request<PortTemplate[]>("/ports/templates");
  },

  createPortTemplate(
    body: Omit<PortTemplate, "builtIn" | "id"> & { id?: string },
  ) {
    return request<PortTemplate>("/ports/templates", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updatePortTemplate(id: string, body: PortTemplatePatch) {
    return request<PortTemplate>(`/ports/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deletePortTemplate(id: string) {
    return request<void>(`/ports/templates/${id}`, {
      method: "DELETE",
    });
  },

  getPorts(params?: { deviceId?: string }) {
    return request<Port[]>("/ports", undefined, params);
  },

  createPort(body: Omit<Port, "id"> & { id?: string }) {
    return request<Port>("/ports", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updatePort(id: string, body: PortPatch) {
    return request<Port>(`/ports/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deletePort(id: string) {
    return request<void>(`/ports/${id}`, {
      method: "DELETE",
    });
  },

  getPortLinks() {
    return request<PortLink[]>("/port-links");
  },

  createPortLink(body: Omit<PortLink, "id"> & { id?: string }) {
    return request<PortLink>("/port-links", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updatePortLink(id: string, body: PortLinkPatch) {
    return request<PortLink>(`/port-links/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deletePortLink(id: string) {
    return request<void>(`/port-links/${id}`, {
      method: "DELETE",
    });
  },

  getVlans(params?: { labId?: string }) {
    return request<Vlan[]>("/vlans", undefined, params);
  },

  createVlan(body: Omit<Vlan, "id"> & { id?: string }) {
    return request<Vlan>("/vlans", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateVlan(id: string, body: VlanPatch) {
    return request<Vlan>(`/vlans/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteVlan(id: string) {
    return request<void>(`/vlans/${id}`, {
      method: "DELETE",
    });
  },

  getVlanRanges(params?: { labId?: string }) {
    return request<VlanRange[]>("/vlans/ranges", undefined, params);
  },

  createVlanRange(body: Omit<VlanRange, "id"> & { id?: string }) {
    return request<VlanRange>("/vlans/ranges", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateVlanRange(id: string, body: VlanRangePatch) {
    return request<VlanRange>(`/vlans/ranges/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteVlanRange(id: string) {
    return request<void>(`/vlans/ranges/${id}`, {
      method: "DELETE",
    });
  },

  getSubnets(params?: { labId?: string }) {
    return request<Subnet[]>("/subnets", undefined, params);
  },

  createSubnet(body: Omit<Subnet, "id"> & { id?: string }) {
    return request<Subnet>("/subnets", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateSubnet(id: string, body: SubnetPatch) {
    return request<Subnet>(`/subnets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteSubnet(id: string) {
    return request<void>(`/subnets/${id}`, {
      method: "DELETE",
    });
  },

  getDhcpScopes(params?: { subnetId?: string }) {
    return request<DhcpScope[]>("/dhcp-scopes", undefined, params);
  },

  createDhcpScope(body: Omit<DhcpScope, "id"> & { id?: string }) {
    return request<DhcpScope>("/dhcp-scopes", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateDhcpScope(id: string, body: DhcpScopePatch) {
    return request<DhcpScope>(`/dhcp-scopes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteDhcpScope(id: string) {
    return request<void>(`/dhcp-scopes/${id}`, {
      method: "DELETE",
    });
  },

  getIpZones(params?: { subnetId?: string }) {
    return request<IpZone[]>("/ip-zones", undefined, params);
  },

  createIpZone(body: Omit<IpZone, "id"> & { id?: string }) {
    return request<IpZone>("/ip-zones", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateIpZone(id: string, body: IpZonePatch) {
    return request<IpZone>(`/ip-zones/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteIpZone(id: string) {
    return request<void>(`/ip-zones/${id}`, {
      method: "DELETE",
    });
  },

  getIpAssignments(params?: { subnetId?: string; deviceId?: string }) {
    return request<IpAssignment[]>("/ip-assignments", undefined, params);
  },

  createIpAssignment(body: Omit<IpAssignment, "id"> & { id?: string }) {
    return request<IpAssignment>("/ip-assignments", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateIpAssignment(id: string, body: IpAssignmentPatch) {
    return request<IpAssignment>(`/ip-assignments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteIpAssignment(id: string) {
    return request<void>(`/ip-assignments/${id}`, {
      method: "DELETE",
    });
  },

  getAuditLog(params?: {
    entityId?: string;
    entityType?: string;
    limit?: number;
  }) {
    return request<AuditEntry[]>("/audit-log", undefined, params);
  },

  createAuditEntry(
    body: Omit<AuditEntry, "id" | "ts" | "user"> & {
      id?: string;
      ts?: string;
      user?: string;
    },
  ) {
    return request<AuditEntry>("/audit-log", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getDeviceMonitors(params?: { deviceId?: string }) {
    return request<DeviceMonitor[]>("/device-monitors", undefined, params);
  },

  createDeviceMonitor(body: { deviceId: string } & MonitorPatch) {
    return request<DeviceMonitor>("/device-monitors", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateDeviceMonitor(id: string, body: MonitorPatch) {
    return request<DeviceMonitor>(`/device-monitors/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteDeviceMonitor(id: string) {
    return request<void>(`/device-monitors/${id}`, {
      method: "DELETE",
    });
  },

  runAllDeviceMonitors() {
    return request<{ results: DeviceMonitor[] }>("/device-monitors/run", {
      method: "POST",
    });
  },

  runDeviceMonitorsForDevice(deviceId: string) {
    return request<{ results: DeviceMonitor[] }>(
      `/device-monitors/run/${deviceId}`,
      {
        method: "POST",
      },
    );
  },

  runDeviceMonitor(id: string) {
    return request<DeviceMonitor>(`/device-monitors/${id}/run`, {
      method: "POST",
    });
  },

  getDiscoveredDevices(params?: { labId?: string; status?: string }) {
    return request<DiscoveredDevice[]>("/discovery", undefined, params);
  },

  scanDiscoveredDevices(body: { labId: string; cidr: string }) {
    return request<DiscoveryScanResult>("/discovery/scan", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateDiscoveredDevice(id: string, body: DiscoveredDevicePatch) {
    return request<DiscoveredDevice>(`/discovery/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteDiscoveredDevice(id: string) {
    return request<void>(`/discovery/${id}`, {
      method: "DELETE",
    });
  },

  getWifiControllers(params?: { labId?: string }) {
    return request<WifiController[]>("/wifi/controllers", undefined, params);
  },

  createWifiController(body: Omit<WifiController, "id"> & { id?: string }) {
    return request<WifiController>("/wifi/controllers", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateWifiController(id: string, body: WifiControllerPatch) {
    return request<WifiController>(`/wifi/controllers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteWifiController(id: string) {
    return request<void>(`/wifi/controllers/${id}`, {
      method: "DELETE",
    });
  },

  getWifiSsids(params?: { labId?: string }) {
    return request<WifiSsid[]>("/wifi/ssids", undefined, params);
  },

  createWifiSsid(body: Omit<WifiSsid, "id"> & { id?: string }) {
    return request<WifiSsid>("/wifi/ssids", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateWifiSsid(id: string, body: WifiSsidPatch) {
    return request<WifiSsid>(`/wifi/ssids/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteWifiSsid(id: string) {
    return request<void>(`/wifi/ssids/${id}`, {
      method: "DELETE",
    });
  },

  getWifiAccessPoints(params?: { labId?: string }) {
    return request<WifiAccessPoint[]>("/wifi/access-points", undefined, params);
  },

  saveWifiAccessPoint(deviceId: string, body: WifiAccessPointPatch) {
    return request<WifiAccessPoint>(`/wifi/access-points/${deviceId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  },

  getWifiRadios(params?: { labId?: string; apDeviceId?: string }) {
    return request<WifiRadio[]>("/wifi/radios", undefined, params);
  },

  createWifiRadio(body: Omit<WifiRadio, "id"> & { id?: string }) {
    return request<WifiRadio>("/wifi/radios", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateWifiRadio(id: string, body: WifiRadioPatch) {
    return request<WifiRadio>(`/wifi/radios/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteWifiRadio(id: string) {
    return request<void>(`/wifi/radios/${id}`, {
      method: "DELETE",
    });
  },

  getWifiClientAssociations(params?: { labId?: string; apDeviceId?: string }) {
    return request<WifiClientAssociation[]>(
      "/wifi/associations",
      undefined,
      params,
    );
  },

  saveWifiClientAssociation(
    clientDeviceId: string,
    body: WifiClientAssociationPatch,
  ) {
    return request<WifiClientAssociation>(
      `/wifi/associations/${clientDeviceId}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );
  },

  deleteWifiClientAssociation(clientDeviceId: string) {
    return request<void>(`/wifi/associations/${clientDeviceId}`, {
      method: "DELETE",
    });
  },
};
