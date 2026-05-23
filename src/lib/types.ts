export type ID = string;

export type DeviceType = string;

export interface DeviceTypeDefinition {
  id: DeviceType;
  label: string;
  builtIn: boolean;
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
  | "virtual";

export type RackFace = "front" | "rear";
export type LinkState = "up" | "down" | "disabled" | "unknown";
export type PortMode = "access" | "trunk";
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
export type UserRole = "admin" | "editor" | "viewer";
export type MonitorType = "none" | "icmp" | "tcp" | "http" | "https";
export type DiscoveryStatus = "new" | "imported" | "dismissed";
export type WifiBand = "2.4ghz" | "5ghz" | "6ghz";
export type VirtualSwitchKind = "external" | "internal" | "private";

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
  cpuCores?: number;
  memoryGb?: number;
  storageGb?: number;
  specs?: string;
  startU?: number;
  heightU?: number;
  face?: RackFace;
  tags?: string[];
  notes?: string;
  lastSeen?: string;
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

export interface DocumentationPage {
  id: ID;
  labId: ID;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
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
  description?: string;
  face?: RackFace;
}

export interface VirtualSwitch {
  id: ID;
  hostDeviceId: ID;
  name: string;
  kind: VirtualSwitchKind;
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
  deviceId?: ID;
  portId?: ID;
  vmId?: ID;
  containerId?: ID;
  hostname?: string;
  description?: string;
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

export interface AppUser {
  id: ID;
  username: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
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

export interface DeviceMonitor {
  id: ID;
  deviceId: ID;
  name: string;
  type: MonitorType;
  target?: string | null;
  port?: number | null;
  path?: string | null;
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
  scannedHostCount: number;
  discoveredCount: number;
  macAddressCount: number;
  vendorCount: number;
  diagnostics: DiscoveryScanDiagnostic[];
  rows: DiscoveredDevice[];
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
