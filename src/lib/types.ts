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
  | "wifi";

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
  | "maintenance";
export type DevicePlacement =
  | "rack"
  | "room"
  | "wireless"
  | "virtual"
  | "shelf";
export type IpAssignmentType =
  | "device"
  | "interface"
  | "vm"
  | "container"
  | "reserved"
  | "infrastructure";
export type IpZoneKind = "static" | "dhcp" | "reserved" | "infrastructure";
export type IpAllocationMode = "static" | "dhcp-reservation";
export type UserRole = "admin" | "editor" | "viewer";
export type MonitorType = "none" | "icmp" | "tcp" | "http" | "https" | "snmp";
export type DiscoveryStatus = "new" | "imported" | "dismissed";
export type WifiBand = "2.4ghz" | "5ghz" | "6ghz";
export type VirtualSwitchKind = "external" | "internal" | "private";
export type DeviceNetworkMode = "normal" | "host-shared";
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
  };
  summary: {
    vlanCreates: number;
    vlanUpdates: number;
    vlanDeletes: number;
    subnetCreates: number;
    subnetUpdates: number;
    subnetDeletes: number;
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
  skippedDeletes: number;
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
  snmpVersion?: "1" | "2c" | "3" | null;
  snmpCommunity?: string | null;
  snmpOid?: string | null;
  snmpExpectedValue?: string | null;
  snmpMatchMode?: "any" | "equals" | "notEquals" | "in" | null;
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

export interface DiscoveryScanScheduleRunResult {
  schedule: DiscoveryScanSchedule;
  scan: DiscoveryScanResult | null;
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

export interface DeviceWithPorts extends Device {
  ports: Port[];
}

export interface RackOccupant {
  device: Device;
  startU: number;
  heightU: number;
}
