import { useSyncExternalStore } from "react";
import { api, ApiError, getAuthToken, setAuthToken } from "./api";
import type {
  AppUser,
  AuditEntry,
  Device,
  DeviceImage,
  DeviceService,
  DeviceTypeDefinition,
  DeviceMonitor,
  DiscoveredDevice,
  DiscoveryScanResult,
  DocumentationPage,
  DhcpScope,
  IpAssignment,
  IpAllocationMode,
  IpAssignmentType,
  IpZone,
  Lab,
  OidcPublicConfig,
  Port,
  PortLink,
  PortTemplate,
  Rack,
  RackFace,
  ReferenceImage,
  Room,
  Subnet,
  UiSettings,
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
import type {
  DevicePatch,
  DeviceImagePatch,
  DeviceServicePatch,
  DocumentationPagePatch,
  DiscoveredDevicePatch,
  DhcpScopePatch,
  LabPatch,
  MonitorPatch,
  PortPatch,
  ReferenceImagePatch,
  PortTemplatePatch,
  RackPatch,
  RoomPatch,
  SubnetPatch,
  UserPatch,
  VlanRangePatch,
  VirtualSwitchPatch,
  WifiAccessPointPatch,
  WifiClientAssociationPatch,
  WifiControllerPatch,
  WifiRadioPatch,
  WifiSsidPatch,
} from "./api";
import { mergeDeviceTypeDefinitions } from "./device-types";
import {
  cidrSize,
  intToIp,
  ipToInt,
  nextFreeStaticIp,
  nextFreeVlanId,
} from "./utils";

const DEFAULT_LAB: Lab = {
  id: "lab_home",
  name: "Home Lab",
  description: "Primary homelab",
};

const ACTIVE_LAB_STORAGE_KEY = "rackpad.active.lab";
const DEFAULT_UI_SETTINGS: UiSettings = {
  defaultLanguage: "en",
};

interface State {
  authReady: boolean;
  authLoading: boolean;
  authError: string | null;
  needsBootstrap: boolean;
  oidc: OidcPublicConfig;
  uiSettings: UiSettings;
  currentUser: AppUser | null;
  authExpiresAt: string | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  labs: Lab[];
  lab: Lab;
  rooms: Room[];
  racks: Rack[];
  devices: Device[];
  deviceImages: DeviceImage[];
  deviceServices: DeviceService[];
  referenceImages: ReferenceImage[];
  documentationPages: DocumentationPage[];
  deviceTypes: DeviceTypeDefinition[];
  ports: Port[];
  portLinks: PortLink[];
  virtualSwitches: VirtualSwitch[];
  vlans: Vlan[];
  vlanRanges: VlanRange[];
  subnets: Subnet[];
  scopes: DhcpScope[];
  ipZones: IpZone[];
  ipAssignments: IpAssignment[];
  auditLog: AuditEntry[];
  users: AppUser[];
  deviceMonitors: DeviceMonitor[];
  portTemplates: PortTemplate[];
  discoveredDevices: DiscoveredDevice[];
  wifiControllers: WifiController[];
  wifiSsids: WifiSsid[];
  wifiAccessPoints: WifiAccessPoint[];
  wifiRadios: WifiRadio[];
  wifiClientAssociations: WifiClientAssociation[];
}

const EMPTY_DATA = {
  labs: [] as Lab[],
  rooms: [] as Room[],
  racks: [] as Rack[],
  devices: [] as Device[],
  deviceImages: [] as DeviceImage[],
  deviceServices: [] as DeviceService[],
  referenceImages: [] as ReferenceImage[],
  documentationPages: [] as DocumentationPage[],
  deviceTypes: [] as DeviceTypeDefinition[],
  ports: [] as Port[],
  portLinks: [] as PortLink[],
  virtualSwitches: [] as VirtualSwitch[],
  vlans: [] as Vlan[],
  vlanRanges: [] as VlanRange[],
  subnets: [] as Subnet[],
  scopes: [] as DhcpScope[],
  ipZones: [] as IpZone[],
  ipAssignments: [] as IpAssignment[],
  auditLog: [] as AuditEntry[],
  users: [] as AppUser[],
  deviceMonitors: [] as DeviceMonitor[],
  portTemplates: [] as PortTemplate[],
  discoveredDevices: [] as DiscoveredDevice[],
  wifiControllers: [] as WifiController[],
  wifiSsids: [] as WifiSsid[],
  wifiAccessPoints: [] as WifiAccessPoint[],
  wifiRadios: [] as WifiRadio[],
  wifiClientAssociations: [] as WifiClientAssociation[],
};

let state: State = {
  authReady: false,
  authLoading: false,
  authError: null,
  needsBootstrap: false,
  oidc: { enabled: false, label: "OIDC" },
  uiSettings: DEFAULT_UI_SETTINGS,
  currentUser: null,
  authExpiresAt: null,
  loading: false,
  loaded: false,
  error: null,
  lab: DEFAULT_LAB,
  ...EMPTY_DATA,
};

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export const store = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getState(): State {
    return state;
  },
};

export function useStore<T>(selector: (snapshot: State) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(state),
    () => selector(state),
  );
}

function setState(next: State | ((prev: State) => State)) {
  state = typeof next === "function" ? next(state) : next;
  emit();
}

function resetData(): Pick<
  State,
  keyof typeof EMPTY_DATA | "loaded" | "loading" | "error"
> {
  return {
    loading: false,
    loaded: false,
    error: null,
    ...EMPTY_DATA,
  };
}

function readStoredLabId() {
  try {
    return window.localStorage.getItem(ACTIVE_LAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLabId(labId: string | null) {
  try {
    if (labId) {
      window.localStorage.setItem(ACTIVE_LAB_STORAGE_KEY, labId);
    } else {
      window.localStorage.removeItem(ACTIVE_LAB_STORAGE_KEY);
    }
  } catch {
    // Ignore local storage failures and keep the in-memory selection.
  }
}

function clearSessionState(authError: string | null = null) {
  setAuthToken(null);
  storeLabId(null);
  setState((prev) => ({
    ...prev,
    authReady: true,
    authLoading: false,
    authError,
    needsBootstrap: false,
    currentUser: null,
    authExpiresAt: null,
    lab: DEFAULT_LAB,
    ...resetData(),
  }));
}

function sortByName<T extends { name: string }>(items: T[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function sortLabs(labs: Lab[]) {
  return sortByName(labs);
}

function sortRooms(rooms: Room[]) {
  return sortByName(rooms);
}

function sortDevices(devices: Device[]) {
  return [...devices].sort((a, b) => a.hostname.localeCompare(b.hostname));
}

function sortDeviceImages(images: DeviceImage[]) {
  return [...images].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      a.label.localeCompare(b.label),
  );
}

function sortDeviceServices(services: DeviceService[]) {
  return [...services].sort(
    (a, b) =>
      a.deviceId.localeCompare(b.deviceId) ||
      a.serviceType.localeCompare(b.serviceType) ||
      a.name.localeCompare(b.name),
  );
}

function sortReferenceImages(images: ReferenceImage[]) {
  return [...images].sort(
    (a, b) =>
      a.entityType.localeCompare(b.entityType) ||
      a.entityId.localeCompare(b.entityId) ||
      String(a.face ?? "").localeCompare(String(b.face ?? "")) ||
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      a.label.localeCompare(b.label),
  );
}

function sortDocumentationPages(pages: DocumentationPage[]) {
  return [...pages].sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      a.title.localeCompare(b.title),
  );
}

function sortDeviceTypes(deviceTypes: DeviceTypeDefinition[]) {
  return [...deviceTypes].sort((a, b) => {
    if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  });
}

function sortPorts(ports: Port[]) {
  return [...ports].sort((a, b) => {
    const byDevice = a.deviceId.localeCompare(b.deviceId);
    return byDevice !== 0 ? byDevice : a.position - b.position;
  });
}

function sortVirtualSwitches(virtualSwitches: VirtualSwitch[]) {
  return [...virtualSwitches].sort((a, b) => {
    const byHost = a.hostDeviceId.localeCompare(b.hostDeviceId);
    if (byHost !== 0) return byHost;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}

function sortVlans(vlans: Vlan[]) {
  return [...vlans].sort((a, b) => a.vlanId - b.vlanId);
}

function sortVlanRanges(ranges: VlanRange[]) {
  return [...ranges].sort((a, b) => a.startVlan - b.startVlan);
}

function sortSubnets(subnets: Subnet[]) {
  return [...subnets].sort((a, b) => a.cidr.localeCompare(b.cidr));
}

function sortIpZones(zones: IpZone[]) {
  return [...zones].sort((a, b) => {
    const bySubnet = a.subnetId.localeCompare(b.subnetId);
    return bySubnet !== 0 ? bySubnet : ipToInt(a.startIp) - ipToInt(b.startIp);
  });
}

function sortScopes(scopes: DhcpScope[]) {
  return [...scopes].sort((a, b) => {
    const bySubnet = a.subnetId.localeCompare(b.subnetId);
    return bySubnet !== 0 ? bySubnet : a.name.localeCompare(b.name);
  });
}

function sortIpAssignments(assignments: IpAssignment[]) {
  return [...assignments].sort((a, b) => {
    const bySubnet = a.subnetId.localeCompare(b.subnetId);
    return bySubnet !== 0
      ? bySubnet
      : ipToInt(a.ipAddress) - ipToInt(b.ipAddress);
  });
}

function sortAudit(entries: AuditEntry[]) {
  return [...entries].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
}

function sortUsers(users: AppUser[]) {
  return [...users].sort((a, b) => a.username.localeCompare(b.username));
}

function sortMonitors(monitors: DeviceMonitor[]) {
  return [...monitors].sort((a, b) => {
    const byDevice = a.deviceId.localeCompare(b.deviceId);
    if (byDevice !== 0) return byDevice;
    const byOrder = a.sortOrder - b.sortOrder;
    if (byOrder !== 0) return byOrder;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}

function sortPortTemplates(templates: PortTemplate[]) {
  return [...templates].sort((a, b) => {
    if (Boolean(a.builtIn) !== Boolean(b.builtIn)) {
      return a.builtIn ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function sortDiscoveredDevices(devices: DiscoveredDevice[]) {
  return [...devices].sort((a, b) => {
    const byStatus = a.status.localeCompare(b.status);
    if (byStatus !== 0) return byStatus;
    return (
      Date.parse(b.lastScannedAt) - Date.parse(a.lastScannedAt) ||
      a.ipAddress.localeCompare(b.ipAddress)
    );
  });
}

function sortWifiControllers(controllers: WifiController[]) {
  return [...controllers].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

function sortWifiSsids(ssids: WifiSsid[]) {
  return [...ssids].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

function sortWifiAccessPoints(accessPoints: WifiAccessPoint[]) {
  return [...accessPoints].sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

function wifiBandOrder(value?: string | null) {
  switch (value) {
    case "2.4ghz":
      return 0;
    case "5ghz":
      return 1;
    case "6ghz":
      return 2;
    default:
      return 3;
  }
}

function sortWifiRadios(radios: WifiRadio[]) {
  return [...radios].sort((a, b) => {
    const byAp = a.apDeviceId.localeCompare(b.apDeviceId);
    if (byAp !== 0) return byAp;
    const byBand = wifiBandOrder(a.band) - wifiBandOrder(b.band);
    if (byBand !== 0) return byBand;
    return a.slotName.localeCompare(b.slotName) || a.id.localeCompare(b.id);
  });
}

function sortWifiClientAssociations(associations: WifiClientAssociation[]) {
  return [...associations].sort((a, b) =>
    a.clientDeviceId.localeCompare(b.clientDeviceId),
  );
}

function replaceById<T extends { id: string }>(
  items: T[],
  updated: T,
  sorter?: (value: T[]) => T[],
) {
  const exists = items.some((item) => item.id === updated.id);
  const next = exists
    ? items.map((item) => (item.id === updated.id ? updated : item))
    : [...items, updated];
  return sorter ? sorter(next) : next;
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

function pickActiveLab(labs: Lab[], preferredLabId?: string | null) {
  if (labs.length === 0) return DEFAULT_LAB;
  return (
    (preferredLabId
      ? labs.find((lab) => lab.id === preferredLabId)
      : undefined) ?? labs[0]
  );
}

function filterAuditForLab(
  entries: AuditEntry[],
  context: {
    labId: string;
    rackIds: Set<string>;
    roomIds: Set<string>;
    deviceIds: Set<string>;
    portIds: Set<string>;
    portLinkIds: Set<string>;
    virtualSwitchIds: Set<string>;
    vlanIds: Set<string>;
    vlanRangeIds: Set<string>;
    subnetIds: Set<string>;
    scopeIds: Set<string>;
    zoneIds: Set<string>;
    assignmentIds: Set<string>;
    monitorIds: Set<string>;
    discoveredIds: Set<string>;
    documentationPageIds: Set<string>;
    deviceImageIds: Set<string>;
    deviceServiceIds: Set<string>;
    referenceImageIds: Set<string>;
    wifiControllerIds: Set<string>;
    wifiSsidIds: Set<string>;
    wifiAccessPointIds: Set<string>;
    wifiRadioIds: Set<string>;
    wifiClientAssociationIds: Set<string>;
  },
) {
  return sortAudit(
    entries.filter((entry) => {
      switch (entry.entityType) {
        case "Lab":
          return entry.entityId === context.labId;
        case "Rack":
          return context.rackIds.has(entry.entityId);
        case "Room":
          return context.roomIds.has(entry.entityId);
        case "Device":
          return context.deviceIds.has(entry.entityId);
        case "Port":
          return context.portIds.has(entry.entityId);
        case "PortLink":
          return context.portLinkIds.has(entry.entityId);
        case "VirtualSwitch":
          return context.virtualSwitchIds.has(entry.entityId);
        case "Vlan":
          return context.vlanIds.has(entry.entityId);
        case "VlanRange":
          return context.vlanRangeIds.has(entry.entityId);
        case "Subnet":
          return context.subnetIds.has(entry.entityId);
        case "DhcpScope":
          return context.scopeIds.has(entry.entityId);
        case "IpZone":
          return context.zoneIds.has(entry.entityId);
        case "IpAssignment":
          return context.assignmentIds.has(entry.entityId);
        case "DeviceMonitor":
          return context.monitorIds.has(entry.entityId);
        case "DiscoveredDevice":
          return context.discoveredIds.has(entry.entityId);
        case "DocumentationPage":
          return context.documentationPageIds.has(entry.entityId);
        case "DeviceImage":
          return context.deviceImageIds.has(entry.entityId);
        case "DeviceService":
          return context.deviceServiceIds.has(entry.entityId);
        case "ReferenceImage":
          return context.referenceImageIds.has(entry.entityId);
        case "WifiController":
          return context.wifiControllerIds.has(entry.entityId);
        case "WifiSsid":
          return context.wifiSsidIds.has(entry.entityId);
        case "WifiAccessPoint":
          return context.wifiAccessPointIds.has(entry.entityId);
        case "WifiRadio":
          return context.wifiRadioIds.has(entry.entityId);
        case "WifiClientAssociation":
          return context.wifiClientAssociationIds.has(entry.entityId);
        default:
          return false;
      }
    }),
  );
}

function normalizeDeviceChanges(
  changes: Partial<Omit<Device, "id" | "labId">>,
): DevicePatch {
  const patch: DevicePatch = {};
  const nullableKeys = [
    "rackId",
    "roomId",
    "displayName",
    "manufacturer",
    "model",
    "serial",
    "managementIp",
    "macAddress",
    "placement",
    "parentDeviceId",
    "cpuCores",
    "memoryGb",
    "storageGb",
    "specs",
    "startU",
    "heightU",
    "face",
    "tags",
    "notes",
    "lastSeen",
  ] as const;
  const requiredKeys = [
    "hostname",
    "deviceType",
    "status",
    "networkMode",
  ] as const;

  for (const key of nullableKeys) {
    if (Object.prototype.hasOwnProperty.call(changes, key)) {
      (patch as Record<string, unknown>)[key] = changes[key] ?? null;
    }
  }

  for (const key of requiredKeys) {
    if (
      Object.prototype.hasOwnProperty.call(changes, key) &&
      changes[key] !== undefined
    ) {
      (patch as Record<string, unknown>)[key] = changes[key];
    }
  }

  return patch;
}

function pushAuditEntry(entry: AuditEntry) {
  setState((prev) => ({
    ...prev,
    auditLog: sortAudit([entry, ...prev.auditLog]),
  }));
}

function isValidIpv4(ipAddress: string) {
  const octets = ipAddress.split(".");
  if (octets.length !== 4) return false;
  return octets.every((octet) => {
    if (!/^\d+$/.test(octet)) return false;
    const value = Number.parseInt(octet, 10);
    return value >= 0 && value <= 255;
  });
}

function findSubnetForIp(ipAddress: string) {
  const ipValue = ipToInt(ipAddress);
  return state.subnets.find((subnet) => {
    const [networkAddress, prefixRaw] = subnet.cidr.split("/");
    const prefix = Number.parseInt(prefixRaw, 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const network = ipToInt(networkAddress);
    const broadcast = network + cidrSize(subnet.cidr) - 1;
    return ipValue > network && ipValue < broadcast;
  });
}

function validateManagementIp(
  managementIp: string | undefined,
  options: {
    existingAssignmentId?: string;
    parentDeviceId?: string | null;
    allowParentShare?: boolean;
  } = {},
) {
  const ipAddress = managementIp?.trim();
  if (!ipAddress) return null;
  if (!isValidIpv4(ipAddress)) {
    throw new Error("Management IP must be a valid IPv4 address.");
  }

  const subnet = findSubnetForIp(ipAddress);
  if (!subnet) {
    throw new Error(
      "Management IP must fall inside a documented subnet before it can be assigned.",
    );
  }

  const conflict = state.ipAssignments.find(
    (assignment) =>
      assignment.subnetId === subnet.id &&
      assignment.ipAddress === ipAddress &&
      assignment.id !== options.existingAssignmentId,
  );
  const parentSharesAddress =
    options.parentDeviceId &&
    state.devices.some(
      (device) =>
        device.id === options.parentDeviceId &&
        device.managementIp === ipAddress,
    );
  if (conflict) {
    if (
      options.allowParentShare &&
      parentSharesAddress &&
      conflict.deviceId === options.parentDeviceId
    ) {
      return {
        ipAddress,
        subnet,
        sharedWithDeviceId: options.parentDeviceId,
      };
    }
    throw new Error(`IP ${ipAddress} is already assigned.`);
  }
  if (options.allowParentShare && parentSharesAddress) {
    return {
      ipAddress,
      subnet,
      sharedWithDeviceId: options.parentDeviceId,
    };
  }

  return { ipAddress, subnet, sharedWithDeviceId: undefined };
}

function findManagementAssignment(
  deviceId: string,
  previousManagementIp?: string,
  nextManagementIp?: string,
) {
  const candidates = state.ipAssignments.filter(
    (assignment) =>
      assignment.deviceId === deviceId &&
      assignment.assignmentType === "device",
  );

  return (
    (previousManagementIp
      ? candidates.find(
          (assignment) => assignment.ipAddress === previousManagementIp,
        )
      : undefined) ??
    (nextManagementIp
      ? candidates.find(
          (assignment) => assignment.ipAddress === nextManagementIp,
        )
      : undefined) ??
    (candidates.length === 1 ? candidates[0] : undefined)
  );
}

async function recordAudit(
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
) {
  try {
    const audit = await api.createAuditEntry({
      action,
      entityType,
      entityId,
      summary,
    });
    pushAuditEntry(audit);
  } catch (error) {
    console.error("Failed to write audit log entry", error);
  }
}

async function syncDeviceManagementAssignment(
  device: Device,
  previousManagementIp?: string,
  options: {
    allocationMode?: IpAllocationMode;
    dhcpScopeId?: string | null;
  } = {},
): Promise<{ upserted?: IpAssignment; deletedId?: string }> {
  const existingAssignment = findManagementAssignment(
    device.id,
    previousManagementIp,
    device.managementIp,
  );
  if (device.networkMode === "host-shared") {
    if (!existingAssignment) return {};
    await api.deleteIpAssignment(existingAssignment.id);
    return { deletedId: existingAssignment.id };
  }
  const validated = validateManagementIp(device.managementIp, {
    existingAssignmentId: existingAssignment?.id,
    parentDeviceId: device.parentDeviceId,
    allowParentShare: false,
  });

  if (!validated) {
    if (!existingAssignment) return {};
    await api.deleteIpAssignment(existingAssignment.id);
    return { deletedId: existingAssignment.id };
  }

  if (validated.sharedWithDeviceId) {
    if (!existingAssignment) return {};
    await api.deleteIpAssignment(existingAssignment.id);
    return { deletedId: existingAssignment.id };
  }

  const payload = {
    subnetId: validated.subnet.id,
    ipAddress: validated.ipAddress,
    assignmentType: "device" as const,
    allocationMode: options.allocationMode ?? "static",
    dhcpScopeId: options.dhcpScopeId ?? null,
    deviceId: device.id,
    hostname: device.hostname,
    description: existingAssignment?.description ?? "Management IP",
  };

  if (existingAssignment) {
    const updated = await api.updateIpAssignment(
      existingAssignment.id,
      payload,
    );
    return { upserted: updated };
  }

  const created = await api.createIpAssignment(payload);
  return { upserted: created };
}

function applyAssignmentSync(
  assignments: IpAssignment[],
  syncResult: { upserted?: IpAssignment; deletedId?: string },
) {
  let next = assignments;
  if (syncResult.deletedId) {
    next = removeById(next, syncResult.deletedId);
  }
  if (syncResult.upserted) {
    next = replaceById(next, syncResult.upserted, sortIpAssignments);
  }
  return next;
}

function isUnauthorized(error: unknown) {
  return error instanceof ApiError && error.status === 401;
}

let initPromise: Promise<void> | null = null;
let dataLoadPromise: Promise<void> | null = null;

export function canEditInventory(user: AppUser | null) {
  return !!user && user.role !== "viewer";
}

export function isAdmin(user: AppUser | null) {
  return user?.role === "admin";
}

export async function initializeApp(force = false): Promise<void> {
  if (initPromise && !force) return initPromise;

  setState((prev) => ({
    ...prev,
    authLoading: true,
    authError: null,
  }));

  initPromise = (async () => {
    try {
      const status = await api.getAuthStatus();

      if (status.needsBootstrap) {
        setAuthToken(null);
        setState((prev) => ({
          ...prev,
          authReady: true,
          authLoading: false,
          authError: null,
          needsBootstrap: true,
          oidc: status.oidc,
          uiSettings: status.uiSettings,
          currentUser: null,
          authExpiresAt: null,
          ...resetData(),
        }));
        return;
      }

      const token = getAuthToken();
      if (!token) {
        setState((prev) => ({
          ...prev,
          authReady: true,
          authLoading: false,
          authError: null,
          needsBootstrap: false,
          oidc: status.oidc,
          uiSettings: status.uiSettings,
          currentUser: null,
          authExpiresAt: null,
          ...resetData(),
        }));
        return;
      }

      const session = await api.getCurrentSession();
      setState((prev) => ({
        ...prev,
        authReady: true,
        authLoading: false,
        authError: null,
        needsBootstrap: false,
        oidc: status.oidc,
        uiSettings: status.uiSettings,
        currentUser: session.user,
        authExpiresAt: session.expiresAt,
      }));

      await loadAll(true);
    } catch (error) {
      if (isUnauthorized(error)) {
        clearSessionState(null);
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : "Failed to initialize Rackpad.";
      setState((prev) => ({
        ...prev,
        authReady: true,
        authLoading: false,
        authError: message,
      }));
      throw error;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

async function applyAuthSession(session: {
  token: string;
  expiresAt: string;
  user: AppUser;
}) {
  setAuthToken(session.token);
  setState((prev) => ({
    ...prev,
    authReady: true,
    authLoading: false,
    authError: null,
    needsBootstrap: false,
    currentUser: session.user,
    authExpiresAt: session.expiresAt,
  }));
  await loadAll(true);
}

export async function bootstrapAdmin(input: {
  username: string;
  displayName?: string;
  password: string;
  loadDemoData?: boolean;
}): Promise<void> {
  setState((prev) => ({
    ...prev,
    authLoading: true,
    authError: null,
  }));

  try {
    const session = await api.bootstrap(input);
    await applyAuthSession(session);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create the initial account.";
    setState((prev) => ({
      ...prev,
      authLoading: false,
      authError: message,
    }));
    throw error;
  }
}

export async function login(input: {
  username: string;
  password: string;
}): Promise<void> {
  setState((prev) => ({
    ...prev,
    authLoading: true,
    authError: null,
  }));

  try {
    const session = await api.login(input);
    await applyAuthSession(session);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sign in.";
    setState((prev) => ({
      ...prev,
      authLoading: false,
      authError: message,
    }));
    throw error;
  }
}

export function startOidcLogin(
  returnTo = window.location.pathname + window.location.search,
) {
  const target =
    returnTo && returnTo !== "/auth/oidc/callback" ? returnTo : "/";
  window.location.assign(
    `/api/auth/oidc/start?returnTo=${encodeURIComponent(target)}`,
  );
}

export async function completeOidcLogin(session: string): Promise<string> {
  setState((prev) => ({
    ...prev,
    authLoading: true,
    authError: null,
  }));

  try {
    const authSession = await api.completeOidcLogin({ session });
    await applyAuthSession(authSession);
    return authSession.returnTo || "/";
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to complete OIDC sign-in.";
    setState((prev) => ({
      ...prev,
      authLoading: false,
      authError: message,
    }));
    throw error;
  }
}

export async function logout(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // Best effort only.
  }
  clearSessionState(null);
}

export async function loadAll(
  force = false,
  preferredLabId?: string | null,
): Promise<void> {
  const currentUser = state.currentUser;
  if (!currentUser) return;
  if (dataLoadPromise && !force) return dataLoadPromise;

  setState((prev) => ({
    ...prev,
    loading: true,
    error: null,
  }));

  dataLoadPromise = (async () => {
    try {
      const labs = sortLabs(await api.getLabs());
      const activeLab = pickActiveLab(
        labs,
        preferredLabId ?? readStoredLabId() ?? state.lab.id,
      );
      storeLabId(activeLab.id);

      const requests = {
        rooms: api.getRooms(),
        racks: api.getRacks(),
        devices: api.getDevices(),
        deviceTypes: api.getDeviceTypes(),
        virtualSwitches: api.getVirtualSwitches(),
        ports: api.getPorts(),
        portLinks: api.getPortLinks(),
        vlans: api.getVlans(),
        vlanRanges: api.getVlanRanges(),
        subnets: api.getSubnets(),
        scopes: api.getDhcpScopes(),
        ipZones: api.getIpZones(),
        ipAssignments: api.getIpAssignments(),
        auditLog: api.getAuditLog({ limit: 500 }),
        deviceMonitors: api.getDeviceMonitors(),
        portTemplates: api.getPortTemplates(),
        discoveredDevices: api.getDiscoveredDevices(),
        documentationPages: api.getDocumentationPages(),
        deviceImages: api.getDeviceImages(),
        deviceServices: api.getDeviceServices(),
        referenceImages: api.getReferenceImages(),
        wifiControllers: api.getWifiControllers(),
        wifiSsids: api.getWifiSsids(),
        wifiAccessPoints: api.getWifiAccessPoints(),
        wifiRadios: api.getWifiRadios(),
        wifiClientAssociations: api.getWifiClientAssociations(),
        users:
          currentUser.role === "admin"
            ? api.getUsers()
            : Promise.resolve([] as AppUser[]),
      };

      const requestEntries = Object.entries(requests) as Array<
        [keyof typeof requests, Promise<unknown>]
      >;
      const settled = await Promise.allSettled(
        requestEntries.map(([, request]) => request),
      );
      const unauthorized = settled.find(
        (result) =>
          result.status === "rejected" && isUnauthorized(result.reason),
      );

      if (unauthorized) {
        clearSessionState("Your session expired. Please sign in again.");
        return;
      }

      const resolved = new Map<keyof typeof requests, unknown>();
      const failures: string[] = [];

      settled.forEach((result, index) => {
        const [key] = requestEntries[index];
        if (result.status === "fulfilled") {
          resolved.set(key, result.value);
          return;
        }
        failures.push(key);
      });

      const allRacks = sortByName(
        (resolved.get("racks") as Rack[] | undefined) ?? [],
      ).filter((rack) => rack.labId === activeLab.id);
      const rackIds = new Set(allRacks.map((rack) => rack.id));

      const allRooms = sortRooms(
        (resolved.get("rooms") as Room[] | undefined) ?? [],
      ).filter((room) => room.labId === activeLab.id);
      const roomIds = new Set(allRooms.map((room) => room.id));

      const allDevices = sortDevices(
        (resolved.get("devices") as Device[] | undefined) ?? [],
      ).filter((device) => device.labId === activeLab.id);
      const deviceIds = new Set(allDevices.map((device) => device.id));

      const allVlans = sortVlans(
        (resolved.get("vlans") as Vlan[] | undefined) ?? [],
      ).filter((vlan) => vlan.labId === activeLab.id);
      const vlanIds = new Set(allVlans.map((vlan) => vlan.id));

      const allVirtualSwitches = sortVirtualSwitches(
        (
          (resolved.get("virtualSwitches") as VirtualSwitch[] | undefined) ?? []
        ).filter((virtualSwitch) => deviceIds.has(virtualSwitch.hostDeviceId)),
      );
      const virtualSwitchIds = new Set(
        allVirtualSwitches.map((virtualSwitch) => virtualSwitch.id),
      );

      const allVlanRanges = sortVlanRanges(
        (resolved.get("vlanRanges") as VlanRange[] | undefined) ?? [],
      ).filter((range) => range.labId === activeLab.id);
      const vlanRangeIds = new Set(allVlanRanges.map((range) => range.id));

      const allSubnets = sortSubnets(
        (resolved.get("subnets") as Subnet[] | undefined) ?? [],
      ).filter((subnet) => subnet.labId === activeLab.id);
      const subnetIds = new Set(allSubnets.map((subnet) => subnet.id));

      const allPorts = sortPorts(
        (resolved.get("ports") as Port[] | undefined) ?? [],
      ).filter((port) => deviceIds.has(port.deviceId));
      const portIds = new Set(allPorts.map((port) => port.id));

      const allPortLinks = (
        (resolved.get("portLinks") as PortLink[] | undefined) ?? []
      ).filter(
        (link) => portIds.has(link.fromPortId) && portIds.has(link.toPortId),
      );
      const portLinkIds = new Set(allPortLinks.map((link) => link.id));

      const allScopes = sortScopes(
        (resolved.get("scopes") as DhcpScope[] | undefined) ?? [],
      ).filter((scope) => subnetIds.has(scope.subnetId));
      const scopeIds = new Set(allScopes.map((scope) => scope.id));

      const allIpZones = sortIpZones(
        (resolved.get("ipZones") as IpZone[] | undefined) ?? [],
      ).filter((zone) => subnetIds.has(zone.subnetId));
      const zoneIds = new Set(allIpZones.map((zone) => zone.id));

      const allIpAssignments = sortIpAssignments(
        (
          (resolved.get("ipAssignments") as IpAssignment[] | undefined) ?? []
        ).filter(
          (assignment) =>
            subnetIds.has(assignment.subnetId) ||
            (assignment.deviceId != null &&
              deviceIds.has(assignment.deviceId)) ||
            (assignment.portId != null && portIds.has(assignment.portId)),
        ),
      );
      const assignmentIds = new Set(
        allIpAssignments.map((assignment) => assignment.id),
      );

      const allMonitors = sortMonitors(
        (
          (resolved.get("deviceMonitors") as DeviceMonitor[] | undefined) ?? []
        ).filter((monitor) => deviceIds.has(monitor.deviceId)),
      );
      const monitorIds = new Set(allMonitors.map((monitor) => monitor.id));

      const allPortTemplates = sortPortTemplates(
        (resolved.get("portTemplates") as PortTemplate[] | undefined) ?? [],
      );
      const allDeviceTypes = sortDeviceTypes(
        mergeDeviceTypeDefinitions(
          (resolved.get("deviceTypes") as DeviceTypeDefinition[] | undefined) ??
            [],
          {
            devices: allDevices,
            portTemplates: allPortTemplates,
          },
        ),
      );

      const allDiscoveredDevices = sortDiscoveredDevices(
        (
          (resolved.get("discoveredDevices") as
            | DiscoveredDevice[]
            | undefined) ?? []
        ).filter((device) => device.labId === activeLab.id),
      );
      const discoveredIds = new Set(
        allDiscoveredDevices.map((device) => device.id),
      );

      const allDocumentationPages = sortDocumentationPages(
        (
          (resolved.get("documentationPages") as
            | DocumentationPage[]
            | undefined) ?? []
        ).filter((page) => page.labId === activeLab.id),
      );
      const documentationPageIds = new Set(
        allDocumentationPages.map((page) => page.id),
      );

      const allDeviceImages = sortDeviceImages(
        (
          (resolved.get("deviceImages") as DeviceImage[] | undefined) ?? []
        ).filter((image) => deviceIds.has(image.deviceId)),
      );
      const deviceImageIds = new Set(allDeviceImages.map((image) => image.id));

      const allDeviceServices = sortDeviceServices(
        (
          (resolved.get("deviceServices") as DeviceService[] | undefined) ??
          []
        ).filter((service) => deviceIds.has(service.deviceId)),
      );
      const deviceServiceIds = new Set(
        allDeviceServices.map((service) => service.id),
      );

      const referenceImageTargets = new Set([...rackIds, ...roomIds]);
      const allReferenceImages = sortReferenceImages(
        (
          (resolved.get("referenceImages") as ReferenceImage[] | undefined) ??
          []
        ).filter(
          (image) =>
            image.labId === activeLab.id &&
            referenceImageTargets.has(image.entityId),
        ),
      );
      const referenceImageIds = new Set(
        allReferenceImages.map((image) => image.id),
      );

      const allWifiControllers = sortWifiControllers(
        (
          (resolved.get("wifiControllers") as WifiController[] | undefined) ??
          []
        ).filter((controller) => controller.labId === activeLab.id),
      );
      const wifiControllerIds = new Set(
        allWifiControllers.map((controller) => controller.id),
      );

      const allWifiSsids = sortWifiSsids(
        ((resolved.get("wifiSsids") as WifiSsid[] | undefined) ?? []).filter(
          (ssid) => ssid.labId === activeLab.id,
        ),
      );
      const wifiSsidIds = new Set(allWifiSsids.map((ssid) => ssid.id));

      const allWifiAccessPoints = sortWifiAccessPoints(
        (
          (resolved.get("wifiAccessPoints") as WifiAccessPoint[] | undefined) ??
          []
        ).filter((accessPoint) => deviceIds.has(accessPoint.deviceId)),
      );
      const wifiAccessPointIds = new Set(
        allWifiAccessPoints.map((accessPoint) => accessPoint.deviceId),
      );

      const allWifiRadios = sortWifiRadios(
        ((resolved.get("wifiRadios") as WifiRadio[] | undefined) ?? []).filter(
          (radio) => deviceIds.has(radio.apDeviceId),
        ),
      );
      const wifiRadioIds = new Set(allWifiRadios.map((radio) => radio.id));

      const allWifiClientAssociations = sortWifiClientAssociations(
        (
          (resolved.get("wifiClientAssociations") as
            | WifiClientAssociation[]
            | undefined) ?? []
        ).filter(
          (association) =>
            deviceIds.has(association.clientDeviceId) &&
            deviceIds.has(association.apDeviceId) &&
            (!association.radioId || wifiRadioIds.has(association.radioId)) &&
            (!association.ssidId || wifiSsidIds.has(association.ssidId)),
        ),
      );
      const wifiClientAssociationIds = new Set(
        allWifiClientAssociations.map(
          (association) => association.clientDeviceId,
        ),
      );

      const filteredAudit = filterAuditForLab(
        (resolved.get("auditLog") as AuditEntry[] | undefined) ?? [],
        {
          labId: activeLab.id,
          rackIds,
          roomIds,
          deviceIds,
          portIds,
          portLinkIds,
          virtualSwitchIds,
          vlanIds,
          vlanRangeIds,
          subnetIds,
          scopeIds,
          zoneIds,
          assignmentIds,
          monitorIds,
          discoveredIds,
          documentationPageIds,
          deviceImageIds,
          deviceServiceIds,
          referenceImageIds,
          wifiControllerIds,
          wifiSsidIds,
          wifiAccessPointIds,
          wifiRadioIds,
          wifiClientAssociationIds,
        },
      );

      setState((prev) => ({
        ...prev,
        loading: false,
        loaded: true,
        labs,
        lab: activeLab,
        error:
          failures.length > 0
            ? `Some data failed to load: ${failures.join(", ")}. Showing the data that did load.`
            : null,
        rooms: allRooms,
        racks: allRacks,
        devices: allDevices,
        deviceTypes: allDeviceTypes,
        virtualSwitches: allVirtualSwitches,
        ports: allPorts,
        portLinks: allPortLinks,
        vlans: allVlans,
        vlanRanges: allVlanRanges,
        subnets: allSubnets,
        scopes: allScopes,
        ipZones: allIpZones,
        ipAssignments: allIpAssignments,
        auditLog: filteredAudit,
        deviceMonitors: allMonitors,
        portTemplates: allPortTemplates,
        discoveredDevices: allDiscoveredDevices,
        documentationPages: allDocumentationPages,
        deviceImages: allDeviceImages,
        deviceServices: allDeviceServices,
        referenceImages: allReferenceImages,
        wifiControllers: allWifiControllers,
        wifiSsids: allWifiSsids,
        wifiAccessPoints: allWifiAccessPoints,
        wifiRadios: allWifiRadios,
        wifiClientAssociations: allWifiClientAssociations,
        users: sortUsers(
          (resolved.get("users") as AppUser[] | undefined) ?? [],
        ),
      }));
    } catch (error) {
      if (isUnauthorized(error)) {
        clearSessionState("Your session expired. Please sign in again.");
        return;
      }

      const message =
        error instanceof Error ? error.message : "Failed to load Rackpad data.";
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
      throw error;
    } finally {
      dataLoadPromise = null;
    }
  })();

  return dataLoadPromise;
}

export async function refreshUsers(): Promise<void> {
  if (!state.currentUser || state.currentUser.role !== "admin") return;
  const users = await api.getUsers();
  setState((prev) => ({
    ...prev,
    users: sortUsers(users),
  }));
}

export async function updateUiSettings(
  input: UiSettings,
): Promise<UiSettings> {
  const saved = await api.updateUiSettings(input);
  setState((prev) => ({
    ...prev,
    uiSettings: saved,
  }));
  return saved;
}

export async function selectLab(labId: string): Promise<void> {
  if (labId === state.lab.id) return;
  const selectedLab = state.labs.find((lab) => lab.id === labId);
  if (!selectedLab) {
    throw new Error("That lab no longer exists.");
  }

  storeLabId(labId);
  setState((prev) => ({
    ...prev,
    lab: selectedLab,
    loading: true,
    loaded: false,
    error: null,
  }));
  await loadAll(true, labId);
}

export async function createLabRecord(input: Omit<Lab, "id">): Promise<Lab> {
  const created = await api.createLab(input);
  const labs = sortLabs([...state.labs, created]);
  setState((prev) => ({
    ...prev,
    labs,
  }));
  void recordAudit(
    "lab.create",
    "Lab",
    created.id,
    `Added lab ${created.name}`,
  );
  await selectLab(created.id);
  return created;
}

export async function updateLabRecord(
  id: string,
  changes: LabPatch,
): Promise<Lab> {
  const updated = await api.updateLab(id, changes);
  setState((prev) => ({
    ...prev,
    labs: sortLabs(replaceById(prev.labs, updated)),
    lab: prev.lab.id === id ? updated : prev.lab,
  }));
  if (state.lab.id === id) {
    storeLabId(id);
  }
  void recordAudit("lab.update", "Lab", id, `Updated lab ${updated.name}`);
  return updated;
}

export async function deleteLabRecord(id: string): Promise<void> {
  const lab = state.labs.find((entry) => entry.id === id);
  if (!lab) return;

  await api.deleteLab(id);
  const remainingLabs = sortLabs(state.labs.filter((entry) => entry.id !== id));
  const nextLab = pickActiveLab(
    remainingLabs,
    state.lab.id === id ? (remainingLabs[0]?.id ?? null) : state.lab.id,
  );

  setState((prev) => ({
    ...prev,
    labs: remainingLabs,
    lab: nextLab,
  }));

  if (remainingLabs.length > 0) {
    await loadAll(true, nextLab.id);
  }

  void recordAudit("lab.delete", "Lab", id, `Deleted lab ${lab.name}`);
}

export async function downloadAdminBackup(): Promise<string> {
  const { blob, filename } = await api.downloadAdminBackup();
  const downloadName =
    filename ??
    `rackpad-backup-${new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "")}.json`;
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = downloadName;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  return downloadName;
}

export async function restoreAdminBackupSnapshot(snapshot: unknown) {
  const result = await api.restoreAdminBackup(snapshot);
  clearSessionState(null);
  await initializeApp(true);
  return result;
}

export interface IpAllocationPreview {
  ipAddress: string;
  assignmentType: IpAssignmentType;
  source: IpAllocationMode;
  allocationMode: IpAllocationMode;
  dhcpScopeId?: string | null;
}

export function previewNextStaticIp(subnetId: string): string | null {
  return previewNextIpAllocation(subnetId)?.ipAddress ?? null;
}

export function previewNextIpAllocation(
  subnetId: string,
  requestedType: IpAssignmentType = "device",
  options: {
    allocationMode?: IpAllocationMode;
    dhcpScopeId?: string | null;
  } = {},
): IpAllocationPreview | null {
  const subnet = state.subnets.find((entry) => entry.id === subnetId);
  if (!subnet) return null;

  const dhcpScopes = state.scopes.filter(
    (scope) => scope.subnetId === subnetId,
  );
  const subnetZones = state.ipZones.filter(
    (zone) => zone.subnetId === subnetId,
  );
  const staticZones = subnetZones
    .filter((zone) => zone.kind === "static")
    .sort((a, b) => ipToInt(a.startIp) - ipToInt(b.startIp));
  const dhcpZones = subnetZones
    .filter((zone) => zone.kind === "dhcp")
    .sort((a, b) => ipToInt(a.startIp) - ipToInt(b.startIp));
  const reservedZones = subnetZones.filter((zone) => zone.kind === "reserved");
  const blockedZones = subnetZones.filter(
    (zone) => zone.kind === "reserved" || zone.kind === "infrastructure",
  );
  const assignedSet = new Set(
    state.ipAssignments
      .filter((assignment) => assignment.subnetId === subnetId)
      .map((assignment) => ipToInt(assignment.ipAddress)),
  );
  for (const scope of dhcpScopes) {
    addDhcpTechnicalAddress(assignedSet, scope.gateway);
    for (const dnsServer of scope.dnsServers ?? []) {
      addDhcpTechnicalAddress(assignedSet, dnsServer);
    }
  }

  const allocationMode = options.allocationMode ?? "static";

  if (allocationMode === "static" && staticZones.length > 0) {
    for (const zone of staticZones) {
      const start = ipToInt(zone.startIp);
      const end = ipToInt(zone.endIp);
      for (let candidate = start; candidate <= end; candidate += 1) {
        if (!assignedSet.has(candidate)) {
          return {
            ipAddress: intToIp(candidate),
            assignmentType: requestedType,
            source: "static",
            allocationMode: "static",
            dhcpScopeId: null,
          };
        }
      }
    }
  }

  const staticCandidate = allocationMode === "static" ? nextFreeStaticIp(
    subnet.cidr,
    dhcpScopes,
    reservedZones,
    [...assignedSet].map(intToIp),
    {
      skipDhcp: true,
      skipReserved: false,
    },
  ) : null;
  if (staticCandidate) {
    return {
      ipAddress: staticCandidate,
      assignmentType: requestedType,
      source: "static",
      allocationMode: "static",
      dhcpScopeId: null,
    };
  }

  if (allocationMode === "static") return null;

  const dhcpReservationCandidate = nextFreeDhcpReservationIp(
    subnet.cidr,
    options.dhcpScopeId
      ? dhcpScopes.filter((scope) => scope.id === options.dhcpScopeId)
      : dhcpScopes,
    dhcpZones,
    blockedZones,
    assignedSet,
  );
  if (!dhcpReservationCandidate) return null;

  const dhcpScope = dhcpScopes.find((scope) =>
    ipInRange(dhcpReservationCandidate, scope.startIp, scope.endIp),
  );

  return {
    ipAddress: dhcpReservationCandidate,
    assignmentType: requestedType,
    source: "dhcp-reservation",
    allocationMode: "dhcp-reservation",
    dhcpScopeId: dhcpScope?.id ?? options.dhcpScopeId ?? null,
  };
}

function ipInRange(ipAddress: string, startIp: string, endIp: string) {
  const target = ipToInt(ipAddress);
  return target >= ipToInt(startIp) && target <= ipToInt(endIp);
}

function addDhcpTechnicalAddress(target: Set<number>, ipAddress?: string | null) {
  if (!ipAddress) return;
  target.add(ipToInt(ipAddress));
}

function nextFreeDhcpReservationIp(
  subnetCidr: string,
  dhcpScopes: DhcpScope[],
  dhcpZones: IpZone[],
  blockedZones: IpZone[],
  assignedSet: Set<number>,
) {
  const baseInt = ipToInt(subnetCidr.split("/")[0]);
  const broadcast = baseInt + cidrSize(subnetCidr) - 1;
  const sortedScopes = [...dhcpScopes].sort(
    (a, b) => ipToInt(a.startIp) - ipToInt(b.startIp),
  );
  const candidateRanges: Array<{ start: number; end: number }> = [];

  for (const scope of sortedScopes) {
    const scopeStart = Math.max(baseInt + 1, ipToInt(scope.startIp));
    const scopeEnd = Math.min(broadcast - 1, ipToInt(scope.endIp));

    if (dhcpZones.length === 0) {
      candidateRanges.push({ start: scopeStart, end: scopeEnd });
      continue;
    }

    for (const zone of dhcpZones) {
      const start = Math.max(scopeStart, ipToInt(zone.startIp));
      const end = Math.min(scopeEnd, ipToInt(zone.endIp));
      if (start <= end) {
        candidateRanges.push({ start, end });
      }
    }
  }

  candidateRanges.sort((a, b) => a.start - b.start || a.end - b.end);

  for (const range of candidateRanges) {
    const start = Math.max(baseInt + 1, range.start);
    const end = Math.min(broadcast - 1, range.end);
    for (let candidate = start; candidate <= end; candidate += 1) {
      if (blockedZones.some((zone) => intInIpRange(candidate, zone))) continue;
      if (!assignedSet.has(candidate)) return intToIp(candidate);
    }
  }
  return null;
}

function intInIpRange(
  candidate: number,
  range: { startIp: string; endIp: string },
) {
  return (
    candidate >= ipToInt(range.startIp) && candidate <= ipToInt(range.endIp)
  );
}

export function previewNextVlanId(rangeId: string): number | null {
  const range = state.vlanRanges.find((entry) => entry.id === rangeId);
  if (!range) return null;
  return nextFreeVlanId(
    range.startVlan,
    range.endVlan,
    state.vlans.map((vlan) => vlan.vlanId),
  );
}

export async function createRackRecord(input: Omit<Rack, "id">): Promise<Rack> {
  const created = await api.createRack(input);
  setState((prev) => ({
    ...prev,
    racks: sortByName([...prev.racks, created]),
  }));
  void recordAudit(
    "rack.create",
    "Rack",
    created.id,
    `Added rack ${created.name}`,
  );
  return created;
}

export async function createRoomRecord(input: Omit<Room, "id">): Promise<Room> {
  const created = await api.createRoom(input);
  setState((prev) => ({
    ...prev,
    rooms: sortRooms([...prev.rooms, created]),
  }));
  void recordAudit(
    "room.create",
    "Room",
    created.id,
    `Added room ${created.name}`,
  );
  return created;
}

export async function updateRoomRecord(
  id: string,
  changes: RoomPatch,
): Promise<Room> {
  const updated = await api.updateRoom(id, changes);
  setState((prev) => ({
    ...prev,
    rooms: replaceById(prev.rooms, updated, sortRooms),
  }));
  void recordAudit("room.update", "Room", id, `Updated room ${updated.name}`);
  return updated;
}

export async function deleteRoomRecord(id: string): Promise<void> {
  const room = state.rooms.find((entry) => entry.id === id);
  await api.deleteRoom(id);
  await loadAll(true);
  if (room) {
    void recordAudit("room.delete", "Room", id, `Deleted room ${room.name}`);
  }
}

export async function updateRackRecord(
  id: string,
  changes: RackPatch,
): Promise<Rack> {
  const updated = await api.updateRack(id, changes);
  setState((prev) => ({
    ...prev,
    racks: replaceById(prev.racks, updated, sortByName),
  }));
  void recordAudit("rack.update", "Rack", id, `Updated rack ${updated.name}`);
  return updated;
}

export async function deleteRackRecord(id: string): Promise<void> {
  const rack = state.racks.find((entry) => entry.id === id);
  await api.deleteRack(id);
  await loadAll(true);
  if (rack) {
    void recordAudit("rack.delete", "Rack", id, `Deleted rack ${rack.name}`);
  }
}

export async function createVirtualSwitchRecord(input: {
  hostDeviceId: string;
  name: string;
  kind: VirtualSwitch["kind"];
  notes?: string | null;
}): Promise<VirtualSwitch> {
  const created = await api.createVirtualSwitch({
    hostDeviceId: input.hostDeviceId,
    name: input.name,
    kind: input.kind,
    notes: input.notes ?? null,
  });

  setState((prev) => ({
    ...prev,
    virtualSwitches: sortVirtualSwitches([...prev.virtualSwitches, created]),
  }));

  const host = state.devices.find(
    (device) => device.id === created.hostDeviceId,
  );
  void recordAudit(
    "virtual.switch.create",
    "VirtualSwitch",
    created.id,
    `Added virtual switch ${created.name} on ${host?.hostname ?? created.hostDeviceId}`,
  );

  return created;
}

export async function updateVirtualSwitchRecord(
  id: string,
  changes: VirtualSwitchPatch,
): Promise<VirtualSwitch | null> {
  const existing = state.virtualSwitches.find(
    (virtualSwitch) => virtualSwitch.id === id,
  );
  if (!existing) return null;

  const updated = await api.updateVirtualSwitch(id, changes);
  setState((prev) => ({
    ...prev,
    virtualSwitches: replaceById(
      prev.virtualSwitches,
      updated,
      sortVirtualSwitches,
    ),
  }));

  void recordAudit(
    "virtual.switch.update",
    "VirtualSwitch",
    id,
    `Updated virtual switch ${updated.name}`,
  );

  return updated;
}

export async function deleteVirtualSwitchRecord(id: string): Promise<boolean> {
  const existing = state.virtualSwitches.find(
    (virtualSwitch) => virtualSwitch.id === id,
  );
  if (!existing) return false;

  await api.deleteVirtualSwitch(id);
  setState((prev) => ({
    ...prev,
    virtualSwitches: prev.virtualSwitches.filter(
      (virtualSwitch) => virtualSwitch.id !== id,
    ),
    ports: prev.ports.map((port) =>
      port.virtualSwitchId === id ? { ...port, virtualSwitchId: null } : port,
    ),
  }));

  void recordAudit(
    "virtual.switch.delete",
    "VirtualSwitch",
    id,
    `Deleted virtual switch ${existing.name}`,
  );

  return true;
}

export async function updatePort(
  id: string,
  changes: Partial<Omit<Port, "id" | "deviceId" | "position">>,
): Promise<Port | null> {
  const existing = state.ports.find((port) => port.id === id);
  if (!existing) return null;

  const patch: PortPatch = {};
  const allowedKeys = [
    "name",
    "kind",
    "speed",
    "linkState",
    "mode",
    "vlanId",
    "allowedVlanIds",
    "virtualSwitchId",
    "description",
    "face",
  ] as const;
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(changes, key)) {
      (patch as Record<string, unknown>)[key] = changes[key] ?? null;
    }
  }

  const updated = await api.updatePort(id, patch);
  setState((prev) => ({
    ...prev,
    ports: replaceById(prev.ports, updated, sortPorts),
  }));

  void recordAudit(
    "port.update",
    "Port",
    id,
    `Updated port ${updated.name} on ${state.devices.find((device) => device.id === updated.deviceId)?.hostname ?? updated.deviceId}`,
  );

  return updated;
}

export async function createPortRecord(input: Omit<Port, "id">): Promise<Port> {
  const created = await api.createPort(input);
  setState((prev) => ({
    ...prev,
    ports: sortPorts([...prev.ports, created]),
  }));
  void recordAudit(
    "port.create",
    "Port",
    created.id,
    `Added port ${created.name} on ${state.devices.find((device) => device.id === created.deviceId)?.hostname ?? created.deviceId}`,
  );
  return created;
}

export async function deletePortRecord(id: string): Promise<void> {
  const port = state.ports.find((entry) => entry.id === id);
  await api.deletePort(id);
  await loadAll(true);
  if (port) {
    void recordAudit(
      "port.delete",
      "Port",
      id,
      `Deleted port ${port.name} from ${state.devices.find((device) => device.id === port.deviceId)?.hostname ?? port.deviceId}`,
    );
  }
}

export async function createPortTemplateRecord(
  input: Omit<PortTemplate, "builtIn" | "id"> & { id?: string },
): Promise<PortTemplate> {
  const created = await api.createPortTemplate(input);
  setState((prev) => ({
    ...prev,
    portTemplates: sortPortTemplates([...prev.portTemplates, created]),
    deviceTypes: sortDeviceTypes(
      mergeDeviceTypeDefinitions(prev.deviceTypes, {
        devices: prev.devices,
        portTemplates: [...prev.portTemplates, created],
      }),
    ),
  }));
  void recordAudit(
    "port.template.create",
    "PortTemplate",
    created.id,
    `Added port template ${created.name}`,
  );
  return created;
}

export async function updatePortTemplateRecord(
  id: string,
  changes: PortTemplatePatch,
): Promise<PortTemplate> {
  const updated = await api.updatePortTemplate(id, changes);
  setState((prev) => ({
    ...prev,
    portTemplates: replaceById(prev.portTemplates, updated, sortPortTemplates),
    deviceTypes: sortDeviceTypes(
      mergeDeviceTypeDefinitions(prev.deviceTypes, {
        devices: prev.devices,
        portTemplates: replaceById(
          prev.portTemplates,
          updated,
          sortPortTemplates,
        ),
      }),
    ),
  }));
  void recordAudit(
    "port.template.update",
    "PortTemplate",
    id,
    `Updated port template ${updated.name}`,
  );
  return updated;
}

export async function deletePortTemplateRecord(id: string): Promise<void> {
  const existing = state.portTemplates.find((template) => template.id === id);
  await api.deletePortTemplate(id);
  setState((prev) => ({
    ...prev,
    portTemplates: removeById(prev.portTemplates, id),
  }));
  if (existing) {
    void recordAudit(
      "port.template.delete",
      "PortTemplate",
      id,
      `Deleted port template ${existing.name}`,
    );
  }
}

export async function createDeviceTypeRecord(input: {
  id?: string;
  label: string;
}): Promise<DeviceTypeDefinition> {
  const created = await api.createDeviceType(input);
  setState((prev) => ({
    ...prev,
    deviceTypes: sortDeviceTypes(
      mergeDeviceTypeDefinitions([...prev.deviceTypes, created], {
        devices: prev.devices,
        portTemplates: prev.portTemplates,
      }),
    ),
  }));
  return created;
}

export interface CreateCableInput {
  fromPortId: string;
  toPortId: string;
  cableType?: string;
  cableLength?: string;
  color?: string;
  notes?: string;
}

export async function createCable(input: CreateCableInput): Promise<PortLink> {
  const fromPort = state.ports.find((port) => port.id === input.fromPortId);
  const toPort = state.ports.find((port) => port.id === input.toPortId);

  if (!fromPort || !toPort) {
    throw new Error("Both cable endpoints must exist.");
  }
  if (fromPort.id === toPort.id) {
    throw new Error("A port cannot be connected to itself.");
  }
  if (
    state.portLinks.some((link) =>
      [link.fromPortId, link.toPortId].includes(fromPort.id),
    )
  ) {
    throw new Error(`${fromPort.name} is already linked.`);
  }
  if (
    state.portLinks.some((link) =>
      [link.fromPortId, link.toPortId].includes(toPort.id),
    )
  ) {
    throw new Error(`${toPort.name} is already linked.`);
  }

  const created = await api.createPortLink(input);

  setState((prev) => ({
    ...prev,
    portLinks: replaceById(prev.portLinks, created),
    ports: sortPorts(
      prev.ports.map((port) =>
        port.id === created.fromPortId || port.id === created.toPortId
          ? { ...port, linkState: "up" }
          : port,
      ),
    ),
  }));

  const fromDevice = state.devices.find(
    (device) => device.id === fromPort.deviceId,
  );
  const toDevice = state.devices.find(
    (device) => device.id === toPort.deviceId,
  );

  void recordAudit(
    "port.link",
    "PortLink",
    created.id,
    `Linked ${fromDevice?.hostname ?? fromPort.deviceId}:${fromPort.name} to ${toDevice?.hostname ?? toPort.deviceId}:${toPort.name}`,
  );

  return created;
}

export async function deleteCable(id: string): Promise<boolean> {
  const link = state.portLinks.find((entry) => entry.id === id);
  if (!link) return false;

  const remainingLinks = state.portLinks.filter((entry) => entry.id !== id);
  await api.deletePortLink(id);

  setState((prev) => ({
    ...prev,
    portLinks: removeById(prev.portLinks, id),
    ports: sortPorts(
      prev.ports.map((port) => {
        if (port.id !== link.fromPortId && port.id !== link.toPortId) {
          return port;
        }
        const stillLinked = remainingLinks.some(
          (entry) => entry.fromPortId === port.id || entry.toPortId === port.id,
        );
        return { ...port, linkState: stillLinked ? "up" : "down" };
      }),
    ),
  }));

  const fromPort = state.ports.find((port) => port.id === link.fromPortId);
  const toPort = state.ports.find((port) => port.id === link.toPortId);
  const fromDevice = fromPort
    ? state.devices.find((device) => device.id === fromPort.deviceId)
    : undefined;
  const toDevice = toPort
    ? state.devices.find((device) => device.id === toPort.deviceId)
    : undefined;

  void recordAudit(
    "port.unlink",
    "PortLink",
    id,
    `Removed cable ${fromDevice?.hostname ?? link.fromPortId}:${fromPort?.name ?? link.fromPortId} to ${toDevice?.hostname ?? link.toPortId}:${toPort?.name ?? link.toPortId}`,
  );

  return true;
}

export async function updateCable(
  id: string,
  changes: Partial<Omit<PortLink, "id">>,
): Promise<PortLink | null> {
  const existing = state.portLinks.find((link) => link.id === id);
  if (!existing) return null;

  const patch: Record<string, unknown> = {};
  const allowedKeys = [
    "fromPortId",
    "toPortId",
    "cableType",
    "cableLength",
    "color",
    "notes",
  ] as const;
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(changes, key)) {
      patch[key] = changes[key] ?? null;
    }
  }

  const updated = await api.updatePortLink(id, patch);

  setState((prev) => ({
    ...prev,
    portLinks: replaceById(prev.portLinks, updated),
    ports: sortPorts(
      prev.ports.map((port) => {
        if (
          ![
            existing.fromPortId,
            existing.toPortId,
            updated.fromPortId,
            updated.toPortId,
          ].includes(port.id)
        ) {
          return port;
        }
        const linked = replaceById(prev.portLinks, updated).some(
          (link) => link.fromPortId === port.id || link.toPortId === port.id,
        );
        return { ...port, linkState: linked ? "up" : "down" };
      }),
    ),
  }));

  const fromPort = state.ports.find((port) => port.id === updated.fromPortId);
  const toPort = state.ports.find((port) => port.id === updated.toPortId);
  const fromDevice = fromPort
    ? state.devices.find((device) => device.id === fromPort.deviceId)
    : undefined;
  const toDevice = toPort
    ? state.devices.find((device) => device.id === toPort.deviceId)
    : undefined;

  void recordAudit(
    "port.link.update",
    "PortLink",
    id,
    `Updated cable ${fromDevice?.hostname ?? updated.fromPortId}:${fromPort?.name ?? updated.fromPortId} to ${toDevice?.hostname ?? updated.toPortId}:${toPort?.name ?? updated.toPortId}`,
  );

  return updated;
}

export interface CreateDeviceInput {
  hostname: string;
  deviceType: Device["deviceType"];
  displayName?: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  managementIp?: string;
  macAddress?: string;
  status?: Device["status"];
  placement?: Device["placement"];
  parentDeviceId?: string;
  networkMode?: Device["networkMode"];
  ipAllocationMode?: IpAllocationMode;
  dhcpScopeId?: string | null;
  cpuCores?: number;
  memoryGb?: number;
  storageGb?: number;
  specs?: string;
  rackId?: string;
  roomId?: string;
  startU?: number;
  heightU?: number;
  face?: RackFace;
  tags?: string[];
  notes?: string;
  portTemplateId?: string;
}

export async function createDevice(input: CreateDeviceInput): Promise<Device> {
  const trimmedHostname = input.hostname.trim();
  const parentDevice = input.parentDeviceId
    ? state.devices.find((device) => device.id === input.parentDeviceId)
    : undefined;
  const trimmedManagementIp =
    input.managementIp?.trim() ||
    (input.networkMode === "host-shared"
      ? parentDevice?.managementIp
      : undefined);
  const trimmedMacAddress = input.macAddress?.trim() || undefined;

  validateManagementIp(trimmedManagementIp, {
    parentDeviceId: input.parentDeviceId,
    allowParentShare: input.networkMode === "host-shared",
  });

  const created = await api.createDevice({
    labId: state.lab.id,
    hostname: trimmedHostname,
    deviceType: input.deviceType,
    displayName: input.displayName,
    manufacturer: input.manufacturer,
    model: input.model,
    serial: input.serial,
    managementIp: trimmedManagementIp,
    macAddress: trimmedMacAddress,
    status: input.status ?? "unknown",
    placement: input.placement,
    parentDeviceId: input.parentDeviceId,
    networkMode: input.networkMode,
    cpuCores: input.cpuCores,
    memoryGb: input.memoryGb,
    storageGb: input.storageGb,
    specs: input.specs,
    rackId: input.rackId,
    roomId: input.roomId,
    startU: input.startU,
    heightU: input.heightU ?? 1,
    face: input.face ?? "front",
    tags: input.tags,
    notes: input.notes,
    lastSeen: new Date().toISOString(),
    portTemplateId: input.portTemplateId,
  });

  let syncResult: { upserted?: IpAssignment; deletedId?: string } = {};

  try {
    syncResult = await syncDeviceManagementAssignment(created, undefined, {
      allocationMode: input.ipAllocationMode,
      dhcpScopeId: input.dhcpScopeId,
    });
  } catch (error) {
    await api.deleteDevice(created.id);
    throw error;
  }

  const createdPorts = await api.getPorts({ deviceId: created.id });

  setState((prev) => ({
    ...prev,
    devices: sortDevices([...prev.devices, created]),
    deviceTypes: sortDeviceTypes(
      mergeDeviceTypeDefinitions(prev.deviceTypes, {
        devices: [...prev.devices, created],
        portTemplates: prev.portTemplates,
      }),
    ),
    ports: sortPorts([...prev.ports, ...createdPorts]),
    ipAssignments: applyAssignmentSync(prev.ipAssignments, syncResult),
  }));

  void recordAudit(
    "device.create",
    "Device",
    created.id,
    `Added device ${created.hostname} (${created.deviceType})`,
  );

  return created;
}

export async function updateDevice(
  id: string,
  changes: Partial<Omit<Device, "id" | "labId">> & { portTemplateId?: string },
): Promise<Device | null> {
  const existing = state.devices.find((device) => device.id === id);
  if (!existing) return null;

  const nextManagementIp = Object.prototype.hasOwnProperty.call(
    changes,
    "managementIp",
  )
    ? changes.managementIp?.trim() || undefined
    : existing.managementIp;
  const nextParentDeviceId = Object.prototype.hasOwnProperty.call(
    changes,
    "parentDeviceId",
  )
    ? (changes.parentDeviceId ?? null)
    : (existing.parentDeviceId ?? null);
  const nextNetworkMode = Object.prototype.hasOwnProperty.call(
    changes,
    "networkMode",
  )
    ? changes.networkMode
    : existing.networkMode;

  validateManagementIp(nextManagementIp, {
    existingAssignmentId: findManagementAssignment(
      id,
      existing.managementIp,
      nextManagementIp,
    )?.id,
    parentDeviceId: nextParentDeviceId,
    allowParentShare: nextNetworkMode === "host-shared",
  });

  const updated = await api.updateDevice(id, {
    ...normalizeDeviceChanges(changes),
    managementIp: Object.prototype.hasOwnProperty.call(changes, "managementIp")
      ? (nextManagementIp ?? null)
      : undefined,
    portTemplateId: changes.portTemplateId ?? undefined,
  });
  const syncResult = await syncDeviceManagementAssignment(
    updated,
    existing.managementIp,
  );

  const updatedHostSharedChildren: Device[] = [];
  if (updated.managementIp !== existing.managementIp) {
    const hostSharedChildren = state.devices.filter(
      (device) =>
        device.parentDeviceId === id &&
        device.networkMode === "host-shared" &&
        device.managementIp !== updated.managementIp,
    );
    for (const child of hostSharedChildren) {
      updatedHostSharedChildren.push(
        await api.updateDevice(child.id, {
          managementIp: updated.managementIp ?? null,
        }),
      );
    }
  }

  let nextPorts = state.ports;
  if (changes.portTemplateId) {
    const refreshedPorts = await api.getPorts({ deviceId: id });
    nextPorts = sortPorts([
      ...state.ports.filter((port) => port.deviceId !== id),
      ...refreshedPorts,
    ]);
  }

  setState((prev) => ({
    ...prev,
    devices: updatedHostSharedChildren.reduce(
      (devices, child) => replaceById(devices, child, sortDevices),
      replaceById(prev.devices, updated, sortDevices),
    ),
    deviceTypes: sortDeviceTypes(
      mergeDeviceTypeDefinitions(prev.deviceTypes, {
        devices: updatedHostSharedChildren.reduce(
          (devices, child) => replaceById(devices, child, sortDevices),
          replaceById(prev.devices, updated, sortDevices),
        ),
        portTemplates: prev.portTemplates,
      }),
    ),
    ports: nextPorts,
    ipAssignments: applyAssignmentSync(prev.ipAssignments, syncResult),
  }));

  void recordAudit(
    "device.update",
    "Device",
    id,
    `Updated device ${updated.hostname}`,
  );

  return updated;
}

export async function deleteDevice(id: string): Promise<boolean> {
  const device = state.devices.find((entry) => entry.id === id);
  if (!device) return false;

  const devicePortIds = state.ports
    .filter((port) => port.deviceId === id)
    .map((port) => port.id);
  const relatedAssignments = state.ipAssignments.filter(
    (assignment) =>
      assignment.deviceId === id ||
      (assignment.portId != null && devicePortIds.includes(assignment.portId)),
  );

  await Promise.all(
    relatedAssignments.map((assignment) =>
      api.deleteIpAssignment(assignment.id),
    ),
  );
  await api.deleteDevice(id);

  setState((prev) => ({
    ...prev,
    virtualSwitches: prev.virtualSwitches.filter(
      (virtualSwitch) => virtualSwitch.hostDeviceId !== id,
    ),
    devices: prev.devices
      .filter((entry) => entry.id !== id)
      .map((entry) =>
        entry.parentDeviceId === id
          ? { ...entry, parentDeviceId: undefined }
          : entry,
      ),
    ports: prev.ports
      .filter((port) => port.deviceId !== id)
      .map((port) =>
        prev.virtualSwitches.some(
          (virtualSwitch) =>
            virtualSwitch.hostDeviceId === id &&
            virtualSwitch.id === port.virtualSwitchId,
        )
          ? { ...port, virtualSwitchId: null }
          : port,
      ),
    portLinks: prev.portLinks.filter(
      (link) =>
        !devicePortIds.includes(link.fromPortId) &&
        !devicePortIds.includes(link.toPortId),
    ),
    ipAssignments: prev.ipAssignments.filter(
      (assignment) =>
        assignment.deviceId !== id &&
        (assignment.portId == null ||
          !devicePortIds.includes(assignment.portId)),
    ),
    deviceMonitors: prev.deviceMonitors.filter(
      (monitor) => monitor.deviceId !== id,
    ),
    deviceImages: prev.deviceImages.filter((image) => image.deviceId !== id),
    deviceServices: prev.deviceServices.filter(
      (service) => service.deviceId !== id,
    ),
    discoveredDevices: prev.discoveredDevices.map((entry) =>
      entry.importedDeviceId === id
        ? { ...entry, importedDeviceId: null, status: "new" }
        : entry,
    ),
    wifiControllers: prev.wifiControllers.map((controller) =>
      controller.deviceId === id
        ? { ...controller, deviceId: null }
        : controller,
    ),
    wifiAccessPoints: prev.wifiAccessPoints.filter(
      (entry) => entry.deviceId !== id,
    ),
    wifiRadios: prev.wifiRadios.filter((entry) => entry.apDeviceId !== id),
    wifiClientAssociations: prev.wifiClientAssociations.filter(
      (entry) => entry.clientDeviceId !== id && entry.apDeviceId !== id,
    ),
  }));

  void recordAudit(
    "device.delete",
    "Device",
    id,
    `Deleted device ${device.hostname}`,
  );

  return true;
}

export async function createDocumentationPageRecord(input: {
  title: string;
  content?: string;
}): Promise<DocumentationPage> {
  const created = await api.createDocumentationPage({
    labId: state.lab.id,
    title: input.title.trim(),
    content: input.content ?? "",
  });

  setState((prev) => ({
    ...prev,
    documentationPages: sortDocumentationPages([
      created,
      ...prev.documentationPages,
    ]),
  }));

  void recordAudit(
    "documentation.create",
    "DocumentationPage",
    created.id,
    `Added documentation page ${created.title}`,
  );

  return created;
}

export async function updateDocumentationPageRecord(
  id: string,
  changes: DocumentationPagePatch,
): Promise<DocumentationPage | null> {
  const existing = state.documentationPages.find((page) => page.id === id);
  if (!existing) return null;

  const updated = await api.updateDocumentationPage(id, changes);
  setState((prev) => ({
    ...prev,
    documentationPages: replaceById(
      prev.documentationPages,
      updated,
      sortDocumentationPages,
    ),
  }));

  void recordAudit(
    "documentation.update",
    "DocumentationPage",
    id,
    `Updated documentation page ${updated.title}`,
  );

  return updated;
}

export async function deleteDocumentationPageRecord(
  id: string,
): Promise<boolean> {
  const existing = state.documentationPages.find((page) => page.id === id);
  if (!existing) return false;

  await api.deleteDocumentationPage(id);
  setState((prev) => ({
    ...prev,
    documentationPages: removeById(prev.documentationPages, id),
  }));

  void recordAudit(
    "documentation.delete",
    "DocumentationPage",
    id,
    `Deleted documentation page ${existing.title}`,
  );

  return true;
}

export async function createDeviceImageRecord(input: {
  deviceId: string;
  label: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  notes?: string | null;
}): Promise<DeviceImage> {
  const created = await api.createDeviceImage({
    deviceId: input.deviceId,
    label: input.label.trim() || input.fileName.replace(/\.[^.]+$/, ""),
    fileName: input.fileName,
    mimeType: input.mimeType,
    dataUrl: input.dataUrl,
    notes: input.notes?.trim() || null,
  });

  setState((prev) => ({
    ...prev,
    deviceImages: sortDeviceImages([created, ...prev.deviceImages]),
  }));

  const device = state.devices.find((entry) => entry.id === created.deviceId);
  void recordAudit(
    "device.image.create",
    "DeviceImage",
    created.id,
    `Added image ${created.label} to ${device?.hostname ?? created.deviceId}`,
  );

  return created;
}

export async function updateDeviceImageRecord(
  id: string,
  changes: DeviceImagePatch,
): Promise<DeviceImage | null> {
  const existing = state.deviceImages.find((image) => image.id === id);
  if (!existing) return null;

  const updated = await api.updateDeviceImage(id, changes);
  setState((prev) => ({
    ...prev,
    deviceImages: replaceById(prev.deviceImages, updated, sortDeviceImages),
  }));

  void recordAudit(
    "device.image.update",
    "DeviceImage",
    id,
    `Updated image ${updated.label}`,
  );

  return updated;
}

export async function deleteDeviceImageRecord(id: string): Promise<boolean> {
  const existing = state.deviceImages.find((image) => image.id === id);
  if (!existing) return false;

  await api.deleteDeviceImage(id);
  setState((prev) => ({
    ...prev,
    deviceImages: removeById(prev.deviceImages, id),
  }));

  void recordAudit(
    "device.image.delete",
    "DeviceImage",
    id,
    `Deleted image ${existing.label}`,
  );

  return true;
}

export async function createDeviceServiceRecord(
  input: Omit<DeviceService, "id" | "createdAt" | "updatedAt">,
): Promise<DeviceService> {
  const created = await api.createDeviceService(input);
  setState((prev) => ({
    ...prev,
    deviceServices: replaceById(
      prev.deviceServices,
      created,
      sortDeviceServices,
    ),
  }));

  const device = state.devices.find((entry) => entry.id === created.deviceId);
  void recordAudit(
    "device.service.create",
    "DeviceService",
    created.id,
    `Added ${created.serviceType} service ${created.name} on ${device?.hostname ?? created.deviceId}`,
  );

  return created;
}

export async function updateDeviceServiceRecord(
  id: string,
  changes: DeviceServicePatch,
): Promise<DeviceService | null> {
  const existing = state.deviceServices.find((service) => service.id === id);
  if (!existing) return null;

  const updated = await api.updateDeviceService(id, changes);
  setState((prev) => ({
    ...prev,
    deviceServices: replaceById(
      prev.deviceServices,
      updated,
      sortDeviceServices,
    ),
  }));

  void recordAudit(
    "device.service.update",
    "DeviceService",
    id,
    `Updated service ${updated.name}`,
  );

  return updated;
}

export async function deleteDeviceServiceRecord(id: string): Promise<boolean> {
  const existing = state.deviceServices.find((service) => service.id === id);
  if (!existing) return false;

  await api.deleteDeviceService(id);
  setState((prev) => ({
    ...prev,
    deviceServices: removeById(prev.deviceServices, id),
  }));

  void recordAudit(
    "device.service.delete",
    "DeviceService",
    id,
    `Deleted service ${existing.name}`,
  );

  return true;
}

export async function createReferenceImageRecord(input: {
  entityType: ReferenceImage["entityType"];
  entityId: string;
  label: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  face?: ReferenceImage["face"];
  notes?: string | null;
}): Promise<ReferenceImage> {
  const created = await api.createReferenceImage({
    entityType: input.entityType,
    entityId: input.entityId,
    label: input.label.trim() || input.fileName.replace(/\.[^.]+$/, ""),
    fileName: input.fileName,
    mimeType: input.mimeType,
    dataUrl: input.dataUrl,
    face: input.entityType === "rack" ? (input.face ?? "front") : null,
    notes: input.notes?.trim() || null,
  });

  setState((prev) => ({
    ...prev,
    referenceImages: sortReferenceImages([
      created,
      ...prev.referenceImages,
    ]),
  }));

  void recordAudit(
    "reference.image.create",
    "ReferenceImage",
    created.id,
    `Added ${created.entityType} image ${created.label}`,
  );

  return created;
}

export async function updateReferenceImageRecord(
  id: string,
  changes: ReferenceImagePatch,
): Promise<ReferenceImage | null> {
  const existing = state.referenceImages.find((image) => image.id === id);
  if (!existing) return null;

  const updated = await api.updateReferenceImage(id, changes);
  setState((prev) => ({
    ...prev,
    referenceImages: replaceById(
      prev.referenceImages,
      updated,
      sortReferenceImages,
    ),
  }));

  void recordAudit(
    "reference.image.update",
    "ReferenceImage",
    id,
    `Updated ${updated.entityType} image ${updated.label}`,
  );

  return updated;
}

export async function deleteReferenceImageRecord(
  id: string,
): Promise<boolean> {
  const existing = state.referenceImages.find((image) => image.id === id);
  if (!existing) return false;

  await api.deleteReferenceImage(id);
  setState((prev) => ({
    ...prev,
    referenceImages: removeById(prev.referenceImages, id),
  }));

  void recordAudit(
    "reference.image.delete",
    "ReferenceImage",
    id,
    `Deleted ${existing.entityType} image ${existing.label}`,
  );

  return true;
}

export interface AllocateIpInput {
  subnetId: string;
  hostname: string;
  description?: string;
  assignmentType: IpAssignmentType;
  allocationMode?: IpAllocationMode;
  dhcpScopeId?: string | null;
  deviceId?: string;
}

export async function allocateIp(
  input: AllocateIpInput,
): Promise<IpAssignment | null> {
  const preview = previewNextIpAllocation(input.subnetId, input.assignmentType, {
    allocationMode: input.allocationMode,
    dhcpScopeId: input.dhcpScopeId,
  });
  if (!preview) return null;

  const subnet = state.subnets.find((entry) => entry.id === input.subnetId);
  const created = await api.createIpAssignment({
    subnetId: input.subnetId,
    ipAddress: preview.ipAddress,
    assignmentType: preview.assignmentType,
    allocationMode: preview.allocationMode,
    dhcpScopeId: preview.dhcpScopeId ?? null,
    deviceId: input.deviceId,
    hostname: input.hostname,
    description: input.description,
  });

  setState((prev) => ({
    ...prev,
    ipAssignments: replaceById(prev.ipAssignments, created, sortIpAssignments),
  }));

  void recordAudit(
    "ip.assign",
    "IpAssignment",
    created.id,
    `Assigned ${preview.ipAddress} to ${input.hostname} (${preview.assignmentType}) in ${subnet?.name ?? "subnet"}`,
  );

  return created;
}

export async function createIpAssignmentRecord(
  input: Omit<IpAssignment, "id">,
): Promise<IpAssignment> {
  const created = await api.createIpAssignment(input);
  const subnet = state.subnets.find((entry) => entry.id === input.subnetId);

  setState((prev) => ({
    ...prev,
    ipAssignments: replaceById(prev.ipAssignments, created, sortIpAssignments),
  }));

  void recordAudit(
    "ip.import",
    "IpAssignment",
    created.id,
    `Imported ${created.ipAddress} for ${created.hostname ?? "Hyper-V inventory"} in ${subnet?.name ?? "subnet"}`,
  );

  return created;
}

export async function unassignIp(id: string): Promise<boolean> {
  const assignment = state.ipAssignments.find((entry) => entry.id === id);
  if (!assignment) return false;

  const device = assignment.deviceId
    ? state.devices.find((entry) => entry.id === assignment.deviceId)
    : undefined;

  let updatedDevice: Device | undefined;
  if (device?.managementIp === assignment.ipAddress) {
    updatedDevice = await api.updateDevice(device.id, { managementIp: null });
  }

  await api.deleteIpAssignment(id);

  setState((prev) => ({
    ...prev,
    devices: updatedDevice
      ? replaceById(prev.devices, updatedDevice, sortDevices)
      : prev.devices,
    ipAssignments: removeById(prev.ipAssignments, id),
  }));

  void recordAudit(
    "ip.release",
    "IpAssignment",
    id,
    `Released ${assignment.ipAddress}${assignment.hostname ? ` from ${assignment.hostname}` : ""}`,
  );

  return true;
}

export interface AllocateVlanInput {
  rangeId: string;
  name: string;
  description?: string;
  color?: string;
}

export async function allocateVlan(
  input: AllocateVlanInput,
): Promise<Vlan | null> {
  const vlanId = previewNextVlanId(input.rangeId);
  if (vlanId == null) return null;

  const range = state.vlanRanges.find((entry) => entry.id === input.rangeId);
  const created = await api.createVlan({
    labId: state.lab.id,
    vlanId,
    name: input.name,
    description: input.description,
    color: input.color ?? range?.color,
  });

  setState((prev) => ({
    ...prev,
    vlans: sortVlans([...prev.vlans, created]),
  }));

  void recordAudit(
    "vlan.create",
    "Vlan",
    created.id,
    `Created VLAN ${vlanId} (${input.name}) in ${range?.name ?? "range"}`,
  );

  return created;
}

export async function createVlanRecord(
  input: Omit<Vlan, "id" | "labId">,
): Promise<Vlan> {
  const created = await api.createVlan({
    labId: state.lab.id,
    vlanId: input.vlanId,
    name: input.name,
    description: input.description,
    color: input.color,
  });

  setState((prev) => ({
    ...prev,
    vlans: sortVlans([...prev.vlans, created]),
  }));

  void recordAudit(
    "vlan.import",
    "Vlan",
    created.id,
    `Imported VLAN ${created.vlanId} (${created.name})`,
  );

  return created;
}

export async function deleteVlan(id: string): Promise<boolean> {
  const vlan = state.vlans.find((entry) => entry.id === id);
  if (!vlan) return false;

  await api.deleteVlan(id);

  setState((prev) => ({
    ...prev,
    vlans: prev.vlans.filter((entry) => entry.id !== id),
    ports: prev.ports.map((port) =>
      port.vlanId === id ? { ...port, vlanId: undefined } : port,
    ),
    subnets: prev.subnets.map((subnet) =>
      subnet.vlanId === id ? { ...subnet, vlanId: undefined } : subnet,
    ),
    wifiSsids: prev.wifiSsids.map((ssid) =>
      ssid.vlanId === id ? { ...ssid, vlanId: undefined } : ssid,
    ),
  }));

  void recordAudit(
    "vlan.delete",
    "Vlan",
    id,
    `Deleted VLAN ${vlan.vlanId} (${vlan.name})`,
  );

  return true;
}

export async function createVlanRangeRecord(
  input: Omit<VlanRange, "id">,
): Promise<VlanRange> {
  const created = await api.createVlanRange(input);
  setState((prev) => ({
    ...prev,
    vlanRanges: sortVlanRanges([...prev.vlanRanges, created]),
  }));
  void recordAudit(
    "vlan.range.create",
    "VlanRange",
    created.id,
    `Added VLAN range ${created.name}`,
  );
  return created;
}

export async function updateVlanRangeRecord(
  id: string,
  changes: VlanRangePatch,
): Promise<VlanRange> {
  const updated = await api.updateVlanRange(id, changes);
  setState((prev) => ({
    ...prev,
    vlanRanges: replaceById(prev.vlanRanges, updated, sortVlanRanges),
  }));
  void recordAudit(
    "vlan.range.update",
    "VlanRange",
    id,
    `Updated VLAN range ${updated.name}`,
  );
  return updated;
}

export async function deleteVlanRangeRecord(id: string): Promise<void> {
  const range = state.vlanRanges.find((entry) => entry.id === id);
  await api.deleteVlanRange(id);
  setState((prev) => ({
    ...prev,
    vlanRanges: removeById(prev.vlanRanges, id),
  }));
  if (range) {
    void recordAudit(
      "vlan.range.delete",
      "VlanRange",
      id,
      `Deleted VLAN range ${range.name}`,
    );
  }
}

export async function createSubnetRecord(
  input: Omit<Subnet, "id">,
): Promise<Subnet> {
  const created = await api.createSubnet(input);
  setState((prev) => ({
    ...prev,
    subnets: sortSubnets([...prev.subnets, created]),
  }));
  void recordAudit(
    "subnet.create",
    "Subnet",
    created.id,
    `Added subnet ${created.cidr} (${created.name})`,
  );
  return created;
}

export async function updateSubnetRecord(
  id: string,
  changes: SubnetPatch,
): Promise<Subnet> {
  const updated = await api.updateSubnet(id, changes);
  setState((prev) => ({
    ...prev,
    subnets: replaceById(prev.subnets, updated, sortSubnets),
  }));
  void recordAudit(
    "subnet.update",
    "Subnet",
    id,
    `Updated subnet ${updated.cidr}`,
  );
  return updated;
}

export async function deleteSubnetRecord(id: string): Promise<void> {
  const subnet = state.subnets.find((entry) => entry.id === id);
  await api.deleteSubnet(id);
  await loadAll(true);
  if (subnet) {
    void recordAudit(
      "subnet.delete",
      "Subnet",
      id,
      `Deleted subnet ${subnet.cidr}`,
    );
  }
}

export async function createDhcpScopeRecord(
  input: Omit<DhcpScope, "id">,
): Promise<DhcpScope> {
  const created = await api.createDhcpScope(input);
  setState((prev) => ({
    ...prev,
    scopes: sortScopes([...prev.scopes, created]),
  }));
  void recordAudit(
    "dhcp.scope.create",
    "DhcpScope",
    created.id,
    `Added DHCP scope ${created.name}`,
  );
  return created;
}

export async function updateDhcpScopeRecord(
  id: string,
  changes: DhcpScopePatch,
): Promise<DhcpScope> {
  const updated = await api.updateDhcpScope(id, changes);
  setState((prev) => ({
    ...prev,
    scopes: replaceById(prev.scopes, updated, sortScopes),
  }));
  void recordAudit(
    "dhcp.scope.update",
    "DhcpScope",
    id,
    `Updated DHCP scope ${updated.name}`,
  );
  return updated;
}

export async function deleteDhcpScopeRecord(id: string): Promise<void> {
  const scope = state.scopes.find((entry) => entry.id === id);
  await api.deleteDhcpScope(id);
  setState((prev) => ({
    ...prev,
    scopes: removeById(prev.scopes, id),
  }));
  if (scope) {
    void recordAudit(
      "dhcp.scope.delete",
      "DhcpScope",
      id,
      `Deleted DHCP scope ${scope.name}`,
    );
  }
}

export async function createIpZoneRecord(
  input: Omit<IpZone, "id">,
): Promise<IpZone> {
  const created = await api.createIpZone(input);
  setState((prev) => ({
    ...prev,
    ipZones: sortIpZones([...prev.ipZones, created]),
  }));
  void recordAudit(
    "ip.zone.create",
    "IpZone",
    created.id,
    `Added ${created.kind} zone ${created.startIp}-${created.endIp}`,
  );
  return created;
}

export async function updateIpZoneRecord(
  id: string,
  changes: {
    kind?: IpZone["kind"];
    startIp?: string;
    endIp?: string;
    description?: string;
  },
): Promise<IpZone> {
  const updated = await api.updateIpZone(id, changes);
  setState((prev) => ({
    ...prev,
    ipZones: replaceById(prev.ipZones, updated, sortIpZones),
  }));
  void recordAudit(
    "ip.zone.update",
    "IpZone",
    id,
    `Updated ${updated.kind} zone ${updated.startIp}-${updated.endIp}`,
  );
  return updated;
}

export async function deleteIpZoneRecord(id: string): Promise<void> {
  const zone = state.ipZones.find((entry) => entry.id === id);
  await api.deleteIpZone(id);
  setState((prev) => ({
    ...prev,
    ipZones: removeById(prev.ipZones, id),
  }));
  if (zone) {
    void recordAudit(
      "ip.zone.delete",
      "IpZone",
      id,
      `Deleted ${zone.kind} zone ${zone.startIp}-${zone.endIp}`,
    );
  }
}

export async function createUserAccount(input: {
  username: string;
  displayName?: string;
  password: string;
  role: UserRole;
  disabled?: boolean;
}): Promise<AppUser> {
  const created = await api.createUser(input);
  setState((prev) => ({
    ...prev,
    users: sortUsers([...prev.users, created]),
  }));
  void recordAudit(
    "user.create",
    "User",
    created.id,
    `Added user ${created.username}`,
  );
  return created;
}

export async function updateUserAccount(
  id: string,
  changes: UserPatch,
): Promise<AppUser> {
  const updated = await api.updateUser(id, changes);
  setState((prev) => ({
    ...prev,
    users: replaceById(prev.users, updated, sortUsers),
    currentUser: prev.currentUser?.id === id ? updated : prev.currentUser,
  }));
  void recordAudit(
    "user.update",
    "User",
    id,
    `Updated user ${updated.username}`,
  );
  return updated;
}

export async function deleteUserAccount(id: string): Promise<void> {
  const user = state.users.find((entry) => entry.id === id);
  await api.deleteUser(id);
  setState((prev) => ({
    ...prev,
    users: removeById(prev.users, id),
  }));
  if (user) {
    void recordAudit(
      "user.delete",
      "User",
      id,
      `Deleted user ${user.username}`,
    );
  }
}

export async function createDeviceMonitorConfig(
  deviceId: string,
  changes: MonitorPatch,
): Promise<DeviceMonitor> {
  const created = await api.createDeviceMonitor({
    deviceId,
    ...changes,
  });
  const device = await api.getDevice(deviceId);
  setState((prev) => ({
    ...prev,
    deviceMonitors: replaceById(prev.deviceMonitors, created, sortMonitors),
    devices: replaceById(prev.devices, device, sortDevices),
  }));
  void recordAudit(
    "monitor.create",
    "DeviceMonitor",
    created.id,
    `Added monitor ${created.name} for ${state.devices.find((entry) => entry.id === deviceId)?.hostname ?? deviceId}`,
  );
  return created;
}

export async function updateDeviceMonitorConfig(
  id: string,
  changes: MonitorPatch,
): Promise<DeviceMonitor | null> {
  const existing = state.deviceMonitors.find((monitor) => monitor.id === id);
  if (!existing) return null;

  const updated = await api.updateDeviceMonitor(id, changes);
  const device = await api.getDevice(existing.deviceId);

  setState((prev) => ({
    ...prev,
    deviceMonitors: replaceById(prev.deviceMonitors, updated, sortMonitors),
    devices: replaceById(prev.devices, device, sortDevices),
  }));
  void recordAudit(
    "monitor.update",
    "DeviceMonitor",
    updated.id,
    `Updated monitor ${updated.name} for ${state.devices.find((entry) => entry.id === existing.deviceId)?.hostname ?? existing.deviceId}`,
  );
  return updated;
}

export async function deleteDeviceMonitorConfig(id: string): Promise<boolean> {
  const existing = state.deviceMonitors.find((monitor) => monitor.id === id);
  if (!existing) return false;

  await api.deleteDeviceMonitor(id);
  const device = await api.getDevice(existing.deviceId);

  setState((prev) => ({
    ...prev,
    deviceMonitors: removeById(prev.deviceMonitors, id),
    devices: replaceById(prev.devices, device, sortDevices),
  }));
  void recordAudit(
    "monitor.delete",
    "DeviceMonitor",
    id,
    `Removed monitor ${existing.name} from ${state.devices.find((entry) => entry.id === existing.deviceId)?.hostname ?? existing.deviceId}`,
  );
  return true;
}

export async function runDeviceMonitorCheck(
  id: string,
): Promise<DeviceMonitor> {
  const monitor = await api.runDeviceMonitor(id);
  const device = await api.getDevice(monitor.deviceId);

  setState((prev) => ({
    ...prev,
    deviceMonitors: replaceById(prev.deviceMonitors, monitor, sortMonitors),
    devices: replaceById(prev.devices, device, sortDevices),
  }));

  return monitor;
}

export async function runDeviceMonitorChecksForDevice(
  deviceId: string,
): Promise<DeviceMonitor[]> {
  const { results } = await api.runDeviceMonitorsForDevice(deviceId);
  const device = await api.getDevice(deviceId);

  setState((prev) => {
    let nextMonitors = prev.deviceMonitors;
    for (const result of results) {
      nextMonitors = replaceById(nextMonitors, result, sortMonitors);
    }
    return {
      ...prev,
      deviceMonitors: nextMonitors,
      devices: replaceById(prev.devices, device, sortDevices),
    };
  });

  return results;
}

export async function runAllDeviceMonitorChecks(): Promise<void> {
  await api.runAllDeviceMonitors();
  await loadAll(true);
}

export async function scanDiscoveredSubnet(
  cidr: string,
): Promise<DiscoveryScanResult> {
  const result = await api.scanDiscoveredDevices({
    labId: state.lab.id,
    cidr,
  });

  setState((prev) => {
    const next = [...prev.discoveredDevices];
    for (const row of result.rows) {
      const existingIndex = next.findIndex((device) => device.id === row.id);
      if (existingIndex >= 0) {
        next[existingIndex] = row;
      } else {
        next.push(row);
      }
    }
    return {
      ...prev,
      discoveredDevices: sortDiscoveredDevices(next),
    };
  });

  void recordAudit(
    "discovery.scan",
    "Lab",
    state.lab.id,
    `Scanned ${cidr} and found ${result.discoveredCount} reachable devices`,
  );

  return result;
}

export async function updateDiscoveredDeviceRecord(
  id: string,
  changes: DiscoveredDevicePatch,
): Promise<DiscoveredDevice> {
  const updated = await api.updateDiscoveredDevice(id, changes);
  setState((prev) => ({
    ...prev,
    discoveredDevices: replaceById(
      prev.discoveredDevices,
      updated,
      sortDiscoveredDevices,
    ),
  }));
  void recordAudit(
    "discovery.update",
    "DiscoveredDevice",
    id,
    `Updated discovered device ${updated.hostname ?? updated.ipAddress}`,
  );
  return updated;
}

export async function deleteDiscoveredDeviceRecord(id: string): Promise<void> {
  const existing = state.discoveredDevices.find((device) => device.id === id);
  await api.deleteDiscoveredDevice(id);
  setState((prev) => ({
    ...prev,
    discoveredDevices: removeById(prev.discoveredDevices, id),
  }));
  if (existing) {
    void recordAudit(
      "discovery.delete",
      "DiscoveredDevice",
      id,
      `Removed discovered device ${existing.hostname ?? existing.ipAddress}`,
    );
  }
}

export async function createWifiControllerRecord(
  input: Omit<WifiController, "id">,
): Promise<WifiController> {
  const created = await api.createWifiController(input);
  await loadAll(true);
  void recordAudit(
    "wifi.controller.create",
    "WifiController",
    created.id,
    `Added WiFi controller ${created.name}`,
  );
  return created;
}

export async function updateWifiControllerRecord(
  id: string,
  changes: WifiControllerPatch,
): Promise<WifiController> {
  const updated = await api.updateWifiController(id, changes);
  await loadAll(true);
  void recordAudit(
    "wifi.controller.update",
    "WifiController",
    id,
    `Updated WiFi controller ${updated.name}`,
  );
  return updated;
}

export async function deleteWifiControllerRecord(id: string): Promise<void> {
  const existing = state.wifiControllers.find(
    (controller) => controller.id === id,
  );
  await api.deleteWifiController(id);
  await loadAll(true);
  if (existing) {
    void recordAudit(
      "wifi.controller.delete",
      "WifiController",
      id,
      `Deleted WiFi controller ${existing.name}`,
    );
  }
}

export async function createWifiSsidRecord(
  input: Omit<WifiSsid, "id">,
): Promise<WifiSsid> {
  const created = await api.createWifiSsid(input);
  await loadAll(true);
  void recordAudit(
    "wifi.ssid.create",
    "WifiSsid",
    created.id,
    `Added WiFi SSID ${created.name}`,
  );
  return created;
}

export async function updateWifiSsidRecord(
  id: string,
  changes: WifiSsidPatch,
): Promise<WifiSsid> {
  const updated = await api.updateWifiSsid(id, changes);
  await loadAll(true);
  void recordAudit(
    "wifi.ssid.update",
    "WifiSsid",
    id,
    `Updated WiFi SSID ${updated.name}`,
  );
  return updated;
}

export async function deleteWifiSsidRecord(id: string): Promise<void> {
  const existing = state.wifiSsids.find((ssid) => ssid.id === id);
  await api.deleteWifiSsid(id);
  await loadAll(true);
  if (existing) {
    void recordAudit(
      "wifi.ssid.delete",
      "WifiSsid",
      id,
      `Deleted WiFi SSID ${existing.name}`,
    );
  }
}

export async function saveWifiAccessPointRecord(
  deviceId: string,
  changes: WifiAccessPointPatch,
): Promise<WifiAccessPoint> {
  const updated = await api.saveWifiAccessPoint(deviceId, changes);
  await loadAll(true);
  const device = state.devices.find((entry) => entry.id === deviceId);
  void recordAudit(
    "wifi.ap.update",
    "WifiAccessPoint",
    deviceId,
    `Updated WiFi access point ${device?.hostname ?? deviceId}`,
  );
  return updated;
}

export async function createWifiRadioRecord(
  input: Omit<WifiRadio, "id">,
): Promise<WifiRadio> {
  const created = await api.createWifiRadio(input);
  await loadAll(true);
  const ap = state.devices.find((entry) => entry.id === input.apDeviceId);
  void recordAudit(
    "wifi.radio.create",
    "WifiRadio",
    created.id,
    `Added ${created.band} radio ${created.slotName} on ${ap?.hostname ?? input.apDeviceId}`,
  );
  return created;
}

export async function updateWifiRadioRecord(
  id: string,
  changes: WifiRadioPatch,
): Promise<WifiRadio> {
  const updated = await api.updateWifiRadio(id, changes);
  await loadAll(true);
  void recordAudit(
    "wifi.radio.update",
    "WifiRadio",
    id,
    `Updated WiFi radio ${updated.slotName}`,
  );
  return updated;
}

export async function deleteWifiRadioRecord(id: string): Promise<void> {
  const existing = state.wifiRadios.find((radio) => radio.id === id);
  await api.deleteWifiRadio(id);
  await loadAll(true);
  if (existing) {
    void recordAudit(
      "wifi.radio.delete",
      "WifiRadio",
      id,
      `Deleted WiFi radio ${existing.slotName}`,
    );
  }
}

export async function saveWifiClientAssociationRecord(
  clientDeviceId: string,
  changes: WifiClientAssociationPatch,
): Promise<WifiClientAssociation> {
  const updated = await api.saveWifiClientAssociation(clientDeviceId, changes);
  await loadAll(true);
  const client = state.devices.find((entry) => entry.id === clientDeviceId);
  const ap = state.devices.find((entry) => entry.id === updated.apDeviceId);
  const ssid = updated.ssidId
    ? state.wifiSsids.find((entry) => entry.id === updated.ssidId)
    : undefined;
  const clientPorts = state.ports.filter(
    (port) => port.deviceId === clientDeviceId,
  );
  if (!clientPorts.some((port) => port.kind === "wifi")) {
    await createPortRecord({
      deviceId: clientDeviceId,
      name: "WiFi",
      position:
        clientPorts.reduce((max, port) => Math.max(max, port.position), 0) + 1,
      kind: "wifi",
      speed: updated.band ?? undefined,
      linkState: "up",
      mode: "access",
      vlanId: ssid?.vlanId ?? undefined,
      allowedVlanIds: undefined,
      virtualSwitchId: null,
      description: [
        ap ? `AP ${ap.hostname}` : undefined,
        ssid ? `SSID ${ssid.name}` : undefined,
        updated.band ? `band ${updated.band}` : undefined,
        updated.channel ? `channel ${updated.channel}` : undefined,
      ]
        .filter(Boolean)
        .join(" | "),
      face: undefined,
    });
  }
  void recordAudit(
    "wifi.client.link",
    "WifiClientAssociation",
    clientDeviceId,
    `Linked ${client?.hostname ?? clientDeviceId} to ${ap?.hostname ?? updated.apDeviceId}${updated.ssidId ? ` on ${state.wifiSsids.find((ssid) => ssid.id === updated.ssidId)?.name ?? updated.ssidId}` : ""}`,
  );
  return updated;
}

export async function deleteWifiClientAssociationRecord(
  clientDeviceId: string,
): Promise<void> {
  const existing = state.wifiClientAssociations.find(
    (association) => association.clientDeviceId === clientDeviceId,
  );
  const client = state.devices.find((entry) => entry.id === clientDeviceId);
  await api.deleteWifiClientAssociation(clientDeviceId);
  await loadAll(true);
  if (existing) {
    const ap = state.devices.find((entry) => entry.id === existing.apDeviceId);
    void recordAudit(
      "wifi.client.unlink",
      "WifiClientAssociation",
      clientDeviceId,
      `Removed WiFi link between ${client?.hostname ?? clientDeviceId} and ${ap?.hostname ?? existing.apDeviceId}`,
    );
  }
}
