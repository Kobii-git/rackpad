import type { SnmpSession } from '../snmp.js'

export const SNMP_SYNC_COLLECTORS = ['vlans', 'subnets', 'dhcp'] as const
export type SnmpSyncCollector = (typeof SNMP_SYNC_COLLECTORS)[number]

export interface SnmpCollectedVlan {
  vlanNumber: number
  name: string
}

export interface SnmpCollectedSubnet {
  cidr: string
  name: string
  vlanNumber?: number | null
}

export interface SnmpCollectedDhcpScope {
  name: string
  startIp: string
  endIp: string
  subnetCidr?: string | null
  note?: string | null
}

export interface SnmpProfileCollection {
  vlans: SnmpCollectedVlan[]
  subnets: SnmpCollectedSubnet[]
  dhcpScopes: SnmpCollectedDhcpScope[]
}

export interface SnmpProfileDefinition {
  id: string
  label: string
  vendor: string
  description: string
  deviceTypes?: string[]
  collects: SnmpSyncCollector[]
  collect: (session: SnmpSession) => Promise<SnmpProfileCollection>
}

export type SnmpSyncDiffAction = 'create' | 'update' | 'delete' | 'unchanged'

export interface SnmpSyncVlanDiff {
  action: SnmpSyncDiffAction
  vlanNumber: number
  name: string
  existingId?: string | null
  existingName?: string | null
  changes?: string[]
  blockedReason?: string | null
}

export interface SnmpSyncSubnetDiff {
  action: SnmpSyncDiffAction
  cidr: string
  name: string
  vlanNumber?: number | null
  existingId?: string | null
  existingName?: string | null
  changes?: string[]
  blockedReason?: string | null
}

export interface SnmpSyncDhcpPreview {
  supported: boolean
  message: string
  scopes: SnmpCollectedDhcpScope[]
}

export interface SnmpSyncPreview {
  profileId: string
  deviceId: string
  labId: string
  target: string
  collectedAt: string
  policy: SnmpSyncPolicy
  vlans: SnmpSyncVlanDiff[]
  subnets: SnmpSyncSubnetDiff[]
  dhcp: SnmpSyncDhcpPreview
  summary: {
    vlanCreates: number
    vlanUpdates: number
    vlanDeletes: number
    subnetCreates: number
    subnetUpdates: number
    subnetDeletes: number
  }
  warnings: string[]
}

export const SNMP_SYNC_POLICIES = ['merge', 'mirror'] as const
export type SnmpSyncPolicy = (typeof SNMP_SYNC_POLICIES)[number]

export interface SnmpSyncApplyResult {
  profileId: string
  deviceId: string
  labId: string
  policy: SnmpSyncPolicy
  createdVlanIds: string[]
  updatedVlanIds: string[]
  deletedVlanIds: string[]
  createdSubnetIds: string[]
  updatedSubnetIds: string[]
  deletedSubnetIds: string[]
  skippedDeletes: number
  warnings: string[]
}
