export type ID = string;

export type DeviceType = string;

export interface DeviceTypeDefinition {
  id: DeviceType;
  label: string;
  builtIn: boolean;
  parentType?: DeviceType | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface DeviceTypeUsage {
  id: DeviceType;
  devices: number;
  discoveredDevices: number;
  portTemplates: number;
  driveBayTemplates: number;
  total: number;
}

export type PortKind =
  | "rj45"
  | "sfp"
  | "sfp_plus"
  | "qsfp"
  | "fiber"
  | "power"
  | "console"
  | "usb"
  | "virtual"
  | "wifi"
  | "sff"
  | "other";

export type RackFace = "front" | "rear";
export type RackSlot = "full" | "left" | "right";
export type LinkState = "up" | "down" | "disabled" | "unknown";
export type PortMode = "access" | "trunk";
export type PortRole = "physical" | "aggregate";
export type DeviceStatus =
  | "online"
  | "offline"
  | "warning"
  | "unknown"
  | "maintenance"
  | "unmanaged";
export type DevicePlacement =
  "rack" | "room" | "wireless" | "virtual" | "shelf";
export type IpAssignmentType =
  "device" | "interface" | "vm" | "container" | "reserved" | "infrastructure";
export type IpZoneKind = "static" | "dhcp" | "reserved" | "infrastructure";
export type IpAllocationMode = "static" | "dhcp-reservation";
export type UserRole = "admin" | "editor" | "viewer";
export type MonitorType = "none" | "icmp" | "tcp" | "http" | "https" | "snmp";
export type DiscoveryStatus = "new" | "imported" | "dismissed";
export type WifiBand = "2.4ghz" | "5ghz" | "6ghz";
export type VirtualSwitchKind = "external" | "internal" | "private";
export type DeviceNetworkMode = "normal" | "host-shared";
export type DriveInterface = "sata" | "sas" | "nvme" | "usb" | "other";
export type DriveFormFactor = "2.5" | "3.5" | "m2" | "u2" | "other";
export type DriveSlotType = "2.5" | "3.5" | "m2" | "u2" | "generic";
export type DriveSlotFace = "front" | "rear" | "internal";
export type DriveSlotLayout = "grid" | "list";
export type StoragePoolType =
  | "raid0"
  | "raid1"
  | "raid5"
  | "raid6"
  | "raid10"
  | "raidz1"
  | "raidz2"
  | "raidz3"
  | "mirror"
  | "unraid"
  | "jbod"
  | "other";
export type StoragePoolStatus =
  "healthy" | "degraded" | "rebuilding" | "offline" | "unknown";
export type DeviceServiceType =
  | "dhcp"
  | "dns"
  | "vpn"
  | "ntp"
  | "snmp"
  | "syslog"
  | "http"
  | "https"
  | "database"
  | "app"
  | "custom";

import type { SupportedLanguage } from "@/i18n/languages";

export type { SupportedLanguage };

export interface UiSettings {
  defaultLanguage: SupportedLanguage;
}

export interface NativeBackupEntry {
  name: string;
  size: number;
  createdAt: string;
}

export interface NativeBackupSettings {
  enabled: boolean;
  intervalHours: number;
  retentionCount: number;
}

export interface NativeBackupStatus {
  configured: boolean;
  configurationError: string | null;
  settings: NativeBackupSettings;
  scheduler: {
    running: boolean;
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    lastError: string | null;
  };
  backups: NativeBackupEntry[];
}

export interface AlertSettings {
  enabled: boolean;
  notifyOnDown: boolean;
  notifyOnRecovery: boolean;
  repeatWhileOffline: boolean;
  repeatIntervalMinutes: number;
  discordWebhookUrl: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUsername: string | null;
  smtpPassword: string | null;
  smtpFrom: string | null;
  smtpTo: string | null;
}

export interface Lab {
  id: ID;
  name: string;
  description?: string;
  location?: string;
}

export interface Room {
  id: ID;
  labId: ID;
  name: string;
  description?: string;
  location?: string;
  notes?: string;
}

export interface Rack {
  id: ID;
  labId: ID;
  name: string;
  totalU: number;
  description?: string;
  location?: string;
  notes?: string;
  roomId?: ID | null;
  studioX?: number | null;
  studioY?: number | null;
}

export interface Device {
  id: ID;
  labId: ID;
  rackId?: ID;
  roomId?: ID | null;
  hostname: string;
  displayName?: string;
  deviceType: DeviceType;
  manufacturer?: string;
  model?: string;
  serial?: string;
  managementIp?: string;
  macAddress?: string | null;
  ignoreDuplicateMac?: boolean;
  status: DeviceStatus;
  placement?: DevicePlacement;
  parentDeviceId?: ID;
  networkMode?: DeviceNetworkMode;
  cpuCores?: number;
  memoryGb?: number;
  storageGb?: number;
  specs?: string;
  startU?: number;
  heightU?: number;
  face?: RackFace;
  rackSlot?: RackSlot;
  tags?: string[];
  notes?: string;
  lastSeen?: string;
  snmpCredentialId?: ID | null;
  rackMountKind?: "direct" | "shelf" | "side" | "loose";
  rackColumn?: number | null;
  rackColumnSpan?: number | null;
  shelfX?: number | null;
  shelfY?: number | null;
  shelfWidth?: number | null;
  shelfHeight?: number | null;
  shelfOrientation?: 0 | 90 | 180 | 270;
  rackSide?: "left" | "right" | null;
}

export interface RackStudioPlacementState {
  mountKind: "direct" | "shelf" | "side" | "loose";
  roomId: ID | null;
  rackId: ID | null;
  parentDeviceId: ID | null;
  startU: number | null;
  heightU: number | null;
  face: RackFace | null;
  column: number | null;
  columnSpan: number | null;
  shelfX: number | null;
  shelfY: number | null;
  shelfWidth: number | null;
  shelfHeight: number | null;
  orientation: 0 | 90 | null;
  side: "left" | "right" | null;
}

export interface RackStudioRackCanvasState {
  roomId: ID | null;
  x: number | null;
  y: number | null;
}

export type RackStudioAction =
  | {
      kind: "rack.move";
      targetId: ID;
      expected: RackStudioRackCanvasState;
      next: RackStudioRackCanvasState;
    }
  | {
      kind: "device.place";
      targetId: ID;
      expected: RackStudioPlacementState;
      next: RackStudioPlacementState;
    };

export type RackStudioActionResult =
  | {
      kind: "rack.move";
      targetId: ID;
      before: RackStudioRackCanvasState;
      after: RackStudioRackCanvasState;
      rack: Rack;
    }
  | {
      kind: "device.place";
      targetId: ID;
      before: RackStudioPlacementState;
      after: RackStudioPlacementState;
      device: Device;
      devices: Device[];
    };

export type PhysicalLayoutStatus =
  | "accurate"
  | "legacy-default"
  | "generic-default"
  | "needs-mapping"
  | "invalid";

export type PhysicalFacePrimitiveV1 =
  | {
      kind: "panel" | "handle" | "vent" | "bay" | "display" | "outlet";
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      tone?: "dark" | "mid" | "light" | "accent";
    }
  | {
      kind: "screw" | "indicator";
      id: string;
      x: number;
      y: number;
      radius: number;
      tone?: "dark" | "mid" | "light" | "accent";
    }
  | {
      kind: "label";
      id: string;
      x: number;
      y: number;
      text: string;
      align?: "start" | "middle" | "end";
    };

export interface FaceDefinitionV1 {
  schemaVersion: 1;
  width: 1000;
  height: number;
  elements: PhysicalFacePrimitiveV1[];
}

export interface PhysicalPortSlotV1 {
  id: string;
  face: RackFace;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  connector: string;
  acceptedPortKinds: string[];
  groupId?: string;
  label?: string;
}

export interface ResolvedPhysicalLayoutV1 {
  schemaVersion: 1;
  sourceTemplateId: string;
  category: string;
  mount: {
    kind: "direct" | "shelf" | "side" | "loose";
    heightU: number;
    column: number;
    columnSpan: number;
  };
  faces: Record<RackFace, FaceDefinitionV1>;
  portSlots: PhysicalPortSlotV1[];
  moduleIds?: string[];
}

export interface PortBindingV1 {
  portId: ID;
  slotId: string;
}

export interface DevicePhysicalLayout {
  deviceId: ID;
  sourceTemplateId: string | null;
  status: PhysicalLayoutStatus;
  effectiveStatus: PhysicalLayoutStatus;
  snapshot: ResolvedPhysicalLayoutV1;
  bindings: PortBindingV1[];
  portFingerprint: string;
  currentPortFingerprint: string;
  unmappedPortIds: ID[];
  createdAt: string;
  updatedAt: string;
}

export interface HardwareTemplateV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  category: string;
  deviceTypes: string[];
  mountDefaults: {
    kind: "direct" | "shelf" | "side" | "loose";
    heightU: number;
    columnSpan: number;
  };
  front: FaceDefinitionV1;
  rear: FaceDefinitionV1;
  portSlots: PhysicalPortSlotV1[];
  moduleSlots: Array<{
    id: string;
    face: RackFace;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  modules: HardwareModuleV1[];
  portBlueprints: Array<Record<string, unknown>>;
  driveBayBlueprints: Array<Record<string, unknown>>;
  builtIn?: boolean;
}

export interface HardwareModuleV1 {
  id: string;
  name: string;
  slotId: string;
  face: RackFace;
  elements: PhysicalFacePrimitiveV1[];
  portSlots: PhysicalPortSlotV1[];
}

export interface HardwareTemplateDefault {
  deviceType: string;
  templateId: string;
  updatedAt: string;
}

export interface PhysicalLayoutPreview {
  deviceId: ID;
  templateId: string;
  snapshot: ResolvedPhysicalLayoutV1;
  bindings: PortBindingV1[];
  unmappedPortIds: ID[];
  conflicts: string[];
  linkedUnmappedPortIds: ID[];
  portsToCreate: Array<{
    slotId: string;
    name: string;
    position: number;
    kind: string;
    face: RackFace;
  }>;
  portFingerprint: string;
  moduleIds: string[];
  preserveBindings: boolean;
  comparison: {
    preservedBindingCount: number;
    addedSlotIds: string[];
    removedSlotIds: string[];
  };
}

export interface SnmpCredential {
  id: ID;
  labId: ID;
  name: string;
  version: "1" | "2c" | "3";
  hasCommunity: boolean;
  v3User?: string | null;
  v3AuthProto?: "MD5" | "SHA" | null;
  v3PrivProto?: "none" | "AES128" | null;
  v3Context?: string | null;
  hasV3AuthPass: boolean;
  hasV3PrivPass: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SnmpTrapLogEntry {
  id: ID;
  labId: ID;
  deviceId?: ID | null;
  sourceIp: string;
  trapOid?: string | null;
  ifIndex?: number | null;
  varbinds: Array<{ oid: string; value: string }>;
  resultAction: string;
  message: string;
  receivedAt: string;
}

export interface SnmpTrapReceiverStatus {
  enabled: boolean;
  listening: boolean;
  port: number;
  bind: string;
  lastTrapAt?: string | null;
  lastError?: string | null;
  trapsReceived: number;
}

export interface SnmpSyncProfile {
  id: string;
  label: string;
  vendor: string;
  description: string;
  deviceTypes?: string[];
  collects: Array<"vlans" | "subnets" | "dhcp">;
}

export type SnmpSyncDiffAction = "create" | "update" | "delete" | "unchanged";
export type SnmpSyncPolicy = "merge" | "mirror";

export interface SnmpSyncSchedule {
  id: ID;
  labId: ID;
  deviceId: ID;
  profileId: string;
  policy: SnmpSyncPolicy;
  intervalMs: number;
  enabled: boolean;
  lastRunAt?: string | null;
  lastResult?: "success" | "error" | null;
  lastMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnmpSyncVlanDiff {
  action: SnmpSyncDiffAction;
  vlanNumber: number;
  name: string;
  existingId?: string | null;
  existingName?: string | null;
  changes?: string[];
  blockedReason?: string | null;
}

export interface SnmpSyncSubnetDiff {
  action: SnmpSyncDiffAction;
  cidr: string;
  name: string;
  vlanNumber?: number | null;
  existingId?: string | null;
  existingName?: string | null;
  changes?: string[];
  blockedReason?: string | null;
}

export interface SnmpSyncPreview {
  profileId: string;
  deviceId: string;
  labId: string;
  target: string;
  collectedAt: string;
  policy: SnmpSyncPolicy;
  vlans: SnmpSyncVlanDiff[];
  subnets: SnmpSyncSubnetDiff[];
  dhcp: {
    supported: boolean;
    message: string;
    scopes: Array<{
      name: string;
      startIp: string;
      endIp: string;
      subnetCidr?: string | null;
      note?: string | null;
    }>;
    conflicts: Array<{ name: string; reason: string }>;
  };
  summary: {
    vlanCreates: number;
    vlanUpdates: number;
    vlanDeletes: number;
    subnetCreates: number;
    subnetUpdates: number;
    subnetDeletes: number;
    dhcpCreates: number;
    dhcpConflicts: number;
  };
  warnings: string[];
}

export interface SnmpSyncApplyResult {
  profileId: string;
  deviceId: string;
  labId: string;
  policy: SnmpSyncPolicy;
  createdVlanIds: string[];
  updatedVlanIds: string[];
  deletedVlanIds: string[];
  createdSubnetIds: string[];
  updatedSubnetIds: string[];
  deletedSubnetIds: string[];
  createdDhcpScopeIds: string[];
  skippedDhcpScopes: number;
  skippedDeletes: number;
  warnings: string[];
}

export type IntegrationProvider =
  "proxmox" | "unifi" | "omada" | "opnsense" | "dockhand";

export type IntegrationAuthKind =
  | "api-token"
  | "api-key"
  | "username-password"
  | "client-credentials"
  | "key-secret";

export type IntegrationScopeKind = "sites" | "nodes" | "environments";

export interface IntegrationProviderInfo {
  id: IntegrationProvider;
  label: string;
  vendor: string;
  authKinds: IntegrationAuthKind[];
  defaultAuthKind: IntegrationAuthKind;
  scopeKind: IntegrationScopeKind | null;
}

export interface IntegrationScope {
  id: string;
  label: string;
}

export type IntegrationAutoSyncMode = "merge" | "skip";

export interface IntegrationConnection {
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
  lastStatus: "unknown" | "ok" | "error";
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

export interface IntegrationTestResult {
  product: string;
  version: string | null;
  summary: Record<string, unknown>;
}

export interface IntegrationDevicePreview {
  name: string;
  kind:
    | "host"
    | "vm"
    | "container"
    | "switch"
    | "gateway"
    | "access-point"
    | "firewall"
    | "bridge"
    | "interface"
    | "other";
  model: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  status: string | null;
  detail: string | null;
}

export interface IntegrationPortSpec {
  name: string;
  kind: "rj45" | "sfp" | "sfp_plus" | "virtual" | "qsfp" | "wifi";
  speed: string | null;
  linkState: "up" | "down" | "unknown";
  mode?: "access" | "trunk" | null;
  untaggedVlanNumber?: number | null;
  taggedVlanNumbers?: number[];
  macAddress?: string | null;
  virtualSwitchName?: string | null;
  ipAddresses?: string[];
}

export interface IntegrationVirtualSwitchSpec {
  providerRecordId?: string;
  name: string;
  hostName: string;
  kind: "external" | "internal" | "private";
  notes: string | null;
}

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
  parentName?: string | null;
  ports: IntegrationPortSpec[];
}

export interface IntegrationWifiInventory {
  controllerName: string;
  vendor: string;
  managementIp: string | null;
  ssids: Array<{
    providerRecordId?: string;
    name: string;
    vlanNumber: number | null;
    security: string | null;
    hidden: boolean;
  }>;
}

export interface IntegrationDeviceSyncPlan {
  labId: string;
  devices: Array<{
    providerRecordId: string;
    action: "create" | "exists" | "conflict";
    name: string;
    deviceType: IntegrationImportableDevice["deviceType"];
    parentName: string | null;
    model: string | null;
    macAddress: string | null;
    ipAddress: string | null;
    portCount: number;
    existingId?: string;
    existingHostname?: string;
    reason: string | null;
    proposedUpdates: string[];
  }>;
  ssids: Array<{
    providerRecordId: string;
    action: "create" | "exists";
    name: string;
    vlanNumber: number | null;
  }>;
  virtualSwitches: Array<{
    providerRecordId: string;
    action: "create" | "exists" | "conflict";
    name: string;
    hostName: string;
    reason: string | null;
  }>;
  controllerName: string | null;
}

export interface IntegrationDeviceSyncResult {
  createdDeviceIds: string[];
  createdPortCount: number;
  createdSsidIds: string[];
  createdVirtualSwitchIds: string[];
  createdIpAssignmentIds: string[];
  linkedAccessPoints: number;
  skipped: string[];
}

export interface IntegrationSyncSchedule {
  id: string;
  connectionId: string;
  name: string;
  enabled: boolean;
  mode: IntegrationAutoSyncMode;
  cron: string;
  labIds: string[];
  failureCount: number;
  pausedUntil: string | null;
  lastRunAt: string | null;
  lastRunStatus: "ok" | "error" | "drift" | null;
  lastRunMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationInventoryResponse {
  connection: IntegrationConnection | null;
  preview: SnmpSyncPreview;
  mode: IntegrationAutoSyncMode;
  networkPreviewToken: string;
  networkPreviewExpiresAt: string;
  deviceSnapshotToken: string;
  deviceSnapshotExpiresAt: string;
  devices: IntegrationDevicePreview[];
  deviceSync: IntegrationDeviceSyncPlan;
  importableDevices: IntegrationImportableDevice[];
  virtualSwitches: IntegrationVirtualSwitchSpec[];
  wifi: IntegrationWifiInventory | null;
  warnings: string[];
}

export interface DeviceImage {
  id: ID;
  deviceId: ID;
  label: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReferenceImageEntityType = "rack" | "room";

export interface ReferenceImage {
  id: ID;
  labId: ID;
  entityType: ReferenceImageEntityType;
  entityId: ID;
  label: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  face?: RackFace | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentationPage {
  id: ID;
  labId: ID;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentationDeviceLink {
  id: ID;
  documentationPageId: ID;
  deviceId: ID;
  createdAt: string;
}

export interface Port {
  id: ID;
  deviceId: ID;
  name: string;
  position: number;
  kind: PortKind;
  speed?: string;
  linkState: LinkState;
  mode: PortMode;
  vlanId?: ID;
  allowedVlanIds?: ID[];
  virtualSwitchId?: ID | null;
  portRole?: PortRole;
  aggregatePortId?: ID | null;
  description?: string;
  face?: RackFace;
  snmpIfIndex?: number | null;
  macAddress?: string | null;
}

export interface VirtualSwitch {
  id: ID;
  hostDeviceId: ID;
  name: string;
  kind: VirtualSwitchKind;
  membersShareHostIp?: boolean;
  notes?: string | null;
}

export interface PortLink {
  id: ID;
  fromPortId: ID;
  toPortId: ID;
  cableType?: string;
  cableLength?: string;
  color?: string;
  notes?: string;
  label?: string;
  visible?: boolean;
  routeWaypoints?: CableRouteWaypoint[];
}

export interface CableRouteWaypoint {
  id: ID;
  roomId: ID;
  face: RackFace;
  x: number;
  y: number;
}

export interface Subnet {
  id: ID;
  labId: ID;
  cidr: string;
  name: string;
  description?: string;
  gateway?: string | null;
  dnsServers?: string[];
  vlanId?: ID;
  integrity: {
    state: "ok" | "legacy-overlap" | "invalid-cidr";
    canonicalCidr: string | null;
    conflicts: Array<{ id: ID; cidr: string; name: string }>;
  };
}

export interface DhcpScope {
  id: ID;
  subnetId: ID;
  name: string;
  startIp: string;
  endIp: string;
  gateway?: string;
  dnsServers?: string[];
  description?: string;
}

export interface IpAssignment {
  id: ID;
  subnetId: ID;
  ipAddress: string;
  assignmentType: IpAssignmentType;
  allocationMode?: IpAllocationMode;
  dhcpScopeId?: ID | null;
  deviceId?: ID;
  portId?: ID;
  vmId?: ID;
  containerId?: ID;
  hostname?: string;
  description?: string;
  integrity?: {
    state:
      "ok" | "cross-lab-reference" | "missing-reference" | "reference-mismatch";
    fields: Array<"deviceId" | "portId" | "vmId" | "containerId">;
  };
}

export interface AdminIntegrityReport {
  checkedAt: string;
  subnetConflicts: Array<{
    id: ID;
    labId: ID;
    cidr: string;
    name: string;
    integrity: Subnet["integrity"];
    childCounts: { assignments: number; dhcpScopes: number; zones: number };
  }>;
  assignmentReferences: Array<{
    id: ID;
    subnetId: ID;
    subnetLabId: ID;
    ipAddress: string;
    integrity: NonNullable<IpAssignment["integrity"]>;
    references: Pick<
      IpAssignment,
      "deviceId" | "portId" | "vmId" | "containerId"
    >;
  }>;
}

export interface DeviceService {
  id: ID;
  deviceId: ID;
  name: string;
  serviceType: DeviceServiceType;
  ipAssignmentId?: ID | null;
  portId?: ID | null;
  vlanId?: ID | null;
  monitorId?: ID | null;
  url?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DockerImportSource {
  id: ID;
  labId: ID;
  name: string;
  endpoint: string;
  hasToken: boolean;
  enabled: boolean;
  verifyTls: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Vlan {
  id: ID;
  labId: ID;
  vlanId: number;
  name: string;
  description?: string;
  color?: string;
}

export interface VlanRange {
  id: ID;
  labId: ID;
  name: string;
  startVlan: number;
  endVlan: number;
  purpose?: string;
  color?: string;
}

export interface IpZone {
  id: ID;
  subnetId: ID;
  kind: IpZoneKind;
  startIp: string;
  endIp: string;
  description?: string;
}

export interface AuditEntry {
  id: ID;
  ts: string;
  user: string;
  action: string;
  entityType: string;
  entityId: ID;
  summary: string;
}

export type LabRole = "editor" | "viewer";

export interface LabAccessEntry {
  labId: ID;
  role: LabRole;
}

export interface AppUser {
  id: ID;
  username: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  authProvider?: "local" | "oidc";
  oidcIssuer?: string | null;
  labAccess?: LabAccessEntry[];
}

export interface AuthSession {
  token: string;
  expiresAt: string;
  user: AppUser;
}

export interface OidcPublicConfig {
  enabled: boolean;
  label: string;
}

export interface DiscoveredSnmpInterface {
  ifIndex: number;
  descr: string;
  name?: string | null;
  alias?: string | null;
  operStatus?: number | null;
  operStatusLabel?: string | null;
  operStatusOid: string;
  highSpeedMbps?: number | null;
  matchedPortId?: string | null;
  matchedPortName?: string | null;
}

export interface DeviceMonitor {
  id: ID;
  deviceId: ID;
  name: string;
  type: MonitorType;
  target?: string | null;
  port?: number | null;
  path?: string | null;
  ignoreTlsErrors: boolean;
  snmpVersion?: "1" | "2c" | "3" | null;
  snmpCommunity?: string | null;
  snmpOid?: string | null;
  snmpExpectedValue?: string | null;
  snmpMatchMode?: "any" | "equals" | "notEquals" | "in" | "regex" | null;
  portId?: ID | null;
  snmpIfIndex?: number | null;
  snmpCredentialId?: ID | null;
  intervalMs?: number | null;
  enabled: boolean;
  sortOrder: number;
  lastCheckAt?: string | null;
  lastAlertAt?: string | null;
  lastResult?: string | null;
  lastMessage?: string | null;
}

export interface DiscoveredDevice {
  id: ID;
  labId: ID;
  ipAddress: string;
  hostname?: string | null;
  displayName?: string | null;
  deviceType?: DeviceType | null;
  placement?: DevicePlacement | null;
  macAddress?: string | null;
  vendor?: string | null;
  source: string;
  status: DiscoveryStatus;
  notes?: string | null;
  importedDeviceId?: ID | null;
  technicalRole?: string | null;
  technicalReason?: string | null;
  placementHint?: string | null;
  lastSeen?: string | null;
  lastScannedAt: string;
}

export interface DiscoveryScanDiagnostic {
  code: string;
  severity: "info" | "warning";
  message: string;
  detail?: string;
}

export interface DiscoveryScanResult {
  chunkCount?: number;
  scannedHostCount: number;
  discoveredCount: number;
  macAddressCount: number;
  vendorCount: number;
  technicalCount: number;
  diagnostics: DiscoveryScanDiagnostic[];
  rows: DiscoveredDevice[];
}

export type DiscoveryScanJobStatus =
  "queued" | "running" | "completed" | "failed";

export interface DiscoveryScanJob {
  id: ID;
  labId: ID;
  cidr: string;
  status: DiscoveryScanJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  result?: DiscoveryScanResult | null;
  error?: string | null;
  queuePosition?: number | null;
}

export interface DiscoveryScanJobResponse {
  job: DiscoveryScanJob;
}

export interface DiscoveryScanSchedule {
  id: ID;
  labId: ID;
  name?: string | null;
  cidr: string;
  intervalMs: number;
  enabled: boolean;
  lastRunAt?: string | null;
  lastResult?: "success" | "error" | string | null;
  lastMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WifiController {
  id: ID;
  labId: ID;
  deviceId?: ID | null;
  name: string;
  vendor?: string | null;
  model?: string | null;
  managementIp?: string | null;
  notes?: string | null;
}

export interface WifiSsid {
  id: ID;
  labId: ID;
  name: string;
  purpose?: string | null;
  security?: string | null;
  hidden: boolean;
  vlanId?: ID | null;
  color?: string | null;
}

export interface WifiAccessPoint {
  deviceId: ID;
  controllerId?: ID | null;
  location?: string | null;
  firmwareVersion?: string | null;
  notes?: string | null;
}

export interface WifiRadio {
  id: ID;
  apDeviceId: ID;
  slotName: string;
  band: WifiBand;
  channel: string;
  channelWidth?: string | null;
  txPower?: string | null;
  ssidIds: ID[];
  notes?: string | null;
}

export interface WifiClientAssociation {
  clientDeviceId: ID;
  apDeviceId: ID;
  radioId?: ID | null;
  ssidId?: ID | null;
  band?: WifiBand | null;
  channel?: string | null;
  signalDbm?: number | null;
  lastSeen?: string | null;
  lastRoamAt?: string | null;
  notes?: string | null;
}

export interface PortTemplatePort {
  name: string;
  position: number;
  kind: PortKind;
  speed?: string;
  mode?: PortMode;
  allowedVlanIds?: ID[] | null;
  linkState?: LinkState | null;
  vlanId?: ID | null;
  description?: string | null;
  face?: RackFace | null;
}

export interface PortTemplate {
  id: string;
  name: string;
  description: string;
  deviceTypes: DeviceType[];
  ports: PortTemplatePort[];
  builtIn?: boolean;
}

export interface DriveBayTemplateSlot {
  name: string;
  position: number;
  slotType: DriveSlotType;
}

export interface DriveBayTemplateSection {
  name: string;
  face: DriveSlotFace;
  layout: DriveSlotLayout;
  columns?: number | null;
  slots: DriveBayTemplateSlot[];
}

export interface DriveBayTemplate {
  id: ID;
  name: string;
  description: string;
  deviceTypes: DeviceType[];
  sections: DriveBayTemplateSection[];
  builtIn?: boolean;
}

export interface DriveSlot {
  id: ID;
  deviceId: ID;
  name: string;
  sectionName: string;
  sectionOrder: number;
  position: number;
  slotType: DriveSlotType;
  face: DriveSlotFace;
  layout: DriveSlotLayout;
  columns?: number | null;
  sectionInconsistent?: boolean;
  driveId?: ID | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorageDrive {
  id: ID;
  labId: ID;
  manufacturer?: string | null;
  model?: string | null;
  serial?: string | null;
  capacityGb: number;
  interface: DriveInterface;
  formFactor: DriveFormFactor;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  slotId?: ID | null;
  deviceId?: ID | null;
  deviceHostname?: string | null;
  slotName?: string | null;
  slotSectionName?: string | null;
  poolId?: ID | null;
  poolName?: string | null;
}

export interface StoragePool {
  id: ID;
  deviceId: ID;
  labId: ID;
  name: string;
  poolType: StoragePoolType;
  usableCapacityGb: number;
  status: StoragePoolStatus;
  notes?: string | null;
  driveIds: ID[];
  createdAt: string;
  updatedAt: string;
}

export interface DeviceWithPorts extends Device {
  ports: Port[];
}

export interface RackOccupant {
  device: Device;
  startU: number;
  heightU: number;
}
