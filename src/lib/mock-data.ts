import type {
  AuditEntry,
  Device,
  DhcpScope,
  IpAssignment,
  Lab,
  Port,
  PortLink,
  Rack,
  Subnet,
  Vlan,
} from "./types";

// ============================================================
// Rackpad mock dataset
// A believable homelab: 2 racks, real models, real cabling.
// ============================================================

export const lab: Lab = {
  id: "lab_home",
  name: "Home Lab",
  description: "Primary homelab in the basement closet.",
  location: "Basement / NW closet",
};

export const racks: Rack[] = [
  {
    id: "rack_net",
    labId: "lab_home",
    name: "NET-01",
    totalU: 24,
    description: "Network rack. Switching, firewall, controllers.",
    location: "Wall-mount, eye-level",
  },
  {
    id: "rack_cmp",
    labId: "lab_home",
    name: "CMP-01",
    totalU: 42,
    description: "Compute rack. Hypervisors, storage, GPU host.",
    location: "Floor-standing",
  },
];

// ----- Devices -----

export const devices: Device[] = [
  // ===== NET-01 =====
  {
    id: "d_pp24",
    labId: "lab_home",
    rackId: "rack_net",
    hostname: "pp-01",
    displayName: "Patch Panel A",
    deviceType: "patch_panel",
    manufacturer: "TRENDnet",
    model: "TC-P24C6",
    serial: "TN-PP-2901",
    status: "online",
    startU: 24,
    heightU: 1,
    face: "front",
    tags: ["cat6", "unmanaged"],
  },
  {
    id: "d_sw_tor",
    labId: "lab_home",
    rackId: "rack_net",
    hostname: "sw-tor-01",
    displayName: "Top-of-Rack Switch",
    deviceType: "switch",
    manufacturer: "Ubiquiti",
    model: "USW-Pro-48-PoE",
    serial: "F8C0:7A10:21B4",
    managementIp: "10.0.10.2",
    status: "online",
    startU: 23,
    heightU: 1,
    face: "front",
    tags: ["poe", "core"],
    lastSeen: new Date(Date.now() - 30_000).toISOString(),
  },
  {
    id: "d_sw_agg",
    labId: "lab_home",
    rackId: "rack_net",
    hostname: "sw-agg-01",
    displayName: "Aggregation Switch",
    deviceType: "switch",
    manufacturer: "Ubiquiti",
    model: "USW-Pro-Aggregation",
    serial: "F8C0:7A10:33A1",
    managementIp: "10.0.10.3",
    status: "online",
    startU: 22,
    heightU: 1,
    face: "front",
    tags: ["10g", "core"],
    lastSeen: new Date(Date.now() - 45_000).toISOString(),
  },
  {
    id: "d_fw",
    labId: "lab_home",
    rackId: "rack_net",
    hostname: "fw-01",
    displayName: "Edge Firewall",
    deviceType: "firewall",
    manufacturer: "Protectli",
    model: "VP4670",
    serial: "PT-VP-4711",
    managementIp: "10.0.10.1",
    status: "online",
    startU: 21,
    heightU: 1,
    face: "front",
    tags: ["pfsense", "edge"],
    lastSeen: new Date(Date.now() - 15_000).toISOString(),
  },
  {
    id: "d_unifi",
    labId: "lab_home",
    rackId: "rack_net",
    hostname: "unifi-01",
    displayName: "UniFi Cloud Key",
    deviceType: "server",
    manufacturer: "Ubiquiti",
    model: "UCK-G2-PLUS",
    managementIp: "10.0.10.4",
    status: "warning",
    startU: 20,
    heightU: 1,
    face: "front",
    tags: ["controller"],
    lastSeen: new Date(Date.now() - 600_000).toISOString(),
  },
  {
    id: "d_pdu_net",
    labId: "lab_home",
    rackId: "rack_net",
    hostname: "pdu-net-01",
    displayName: "Network PDU",
    deviceType: "pdu",
    manufacturer: "APC",
    model: "AP7900B",
    managementIp: "10.0.10.250",
    status: "online",
    startU: 1,
    heightU: 1,
    face: "rear",
    tags: ["metered"],
  },

  // ===== CMP-01 =====
  {
    id: "d_srv_pve1",
    labId: "lab_home",
    rackId: "rack_cmp",
    hostname: "pve-01",
    displayName: "Proxmox Node 1",
    deviceType: "server",
    manufacturer: "Supermicro",
    model: "SYS-5019D-FN8TP",
    serial: "SM-19D-A491",
    managementIp: "10.0.10.11",
    status: "online",
    startU: 40,
    heightU: 1,
    face: "front",
    tags: ["hypervisor", "xeon-d"],
    lastSeen: new Date(Date.now() - 20_000).toISOString(),
  },
  {
    id: "d_srv_pve2",
    labId: "lab_home",
    rackId: "rack_cmp",
    hostname: "pve-02",
    displayName: "Proxmox Node 2",
    deviceType: "server",
    manufacturer: "Supermicro",
    model: "SYS-5019D-FN8TP",
    serial: "SM-19D-A492",
    managementIp: "10.0.10.12",
    status: "online",
    startU: 39,
    heightU: 1,
    face: "front",
    tags: ["hypervisor", "xeon-d"],
    lastSeen: new Date(Date.now() - 25_000).toISOString(),
  },
  {
    id: "d_srv_pve3",
    labId: "lab_home",
    rackId: "rack_cmp",
    hostname: "pve-03",
    displayName: "Proxmox Node 3 (GPU)",
    deviceType: "server",
    manufacturer: "Supermicro",
    model: "SYS-2029U-TN24R4T",
    serial: "SM-29U-B112",
    managementIp: "10.0.10.13",
    status: "online",
    startU: 36,
    heightU: 2,
    face: "front",
    tags: ["hypervisor", "gpu", "epyc"],
    lastSeen: new Date(Date.now() - 12_000).toISOString(),
  },
  {
    id: "d_srv_nas",
    labId: "lab_home",
    rackId: "rack_cmp",
    hostname: "truenas-01",
    displayName: "TrueNAS Storage",
    deviceType: "storage",
    manufacturer: "Custom",
    model: "4U 24-Bay",
    managementIp: "10.0.10.20",
    status: "online",
    startU: 30,
    heightU: 4,
    face: "front",
    tags: ["truenas", "zfs", "24-bay"],
    lastSeen: new Date(Date.now() - 18_000).toISOString(),
  },
  {
    id: "d_srv_backup",
    labId: "lab_home",
    rackId: "rack_cmp",
    hostname: "backup-01",
    displayName: "Backup Server",
    deviceType: "server",
    manufacturer: "HPE",
    model: "DL360 Gen10",
    managementIp: "10.0.10.21",
    status: "maintenance",
    startU: 28,
    heightU: 1,
    face: "front",
    tags: ["pbs"],
    lastSeen: new Date(Date.now() - 86_400_000).toISOString(),
  },
  {
    id: "d_ups",
    labId: "lab_home",
    rackId: "rack_cmp",
    hostname: "ups-01",
    displayName: "Rack UPS",
    deviceType: "ups",
    manufacturer: "APC",
    model: "SMT2200RM2U",
    managementIp: "10.0.10.251",
    status: "online",
    startU: 1,
    heightU: 2,
    face: "front",
    tags: ["2200va"],
  },
  {
    id: "d_pdu_cmp",
    labId: "lab_home",
    rackId: "rack_cmp",
    hostname: "pdu-cmp-01",
    displayName: "Compute PDU",
    deviceType: "pdu",
    manufacturer: "APC",
    model: "AP8941",
    managementIp: "10.0.10.252",
    status: "online",
    startU: 42,
    heightU: 1,
    face: "rear",
    tags: ["switched"],
  },
];

// ----- Ports -----
// Helper to make port arrays compactly.
function make(
  deviceId: string,
  prefix: string,
  count: number,
  kind: Port["kind"],
  speed: string,
  options: { withLink?: number[]; vlanId?: string } = {},
): Port[] {
  return Array.from({ length: count }, (_, i) => {
    const pos = i + 1;
    const isLinked = options.withLink?.includes(pos) ?? Math.random() > 0.6;
    return {
      id: `p_${deviceId}_${pos}`,
      deviceId,
      name: `${prefix}${pos}`,
      position: pos,
      kind,
      speed,
      linkState: isLinked ? "up" : "down",
      mode: "access",
      vlanId: options.vlanId,
      face: "front",
    } satisfies Port;
  });
}

function makePatchPanel(
  deviceId: string,
  count: number,
  linkedFrontPorts: number[] = [],
): Port[] {
  return Array.from({ length: count }, (_, index) => {
    const position = index + 1;
    const linkState: Port["linkState"] = linkedFrontPorts.includes(position)
      ? "up"
      : "down";
    return [
      {
        id: `p_${deviceId}_${position}`,
        deviceId,
        name: String(position),
        position,
        kind: "rj45" as const,
        speed: "1G",
        linkState,
        mode: "access" as const,
        face: "front" as const,
      },
      {
        id: `p_${deviceId}_${position}_rear`,
        deviceId,
        name: String(position),
        position,
        kind: "rj45" as const,
        speed: "1G",
        linkState: "down" as const,
        mode: "access" as const,
        face: "rear" as const,
      },
    ];
  }).flat();
}

export const ports: Port[] = [
  // Patch panel — 24 front/rear copper terminations
  ...makePatchPanel("d_pp24", 24, [1, 2, 3, 4, 5, 8, 9, 12, 17, 22]),

  // ToR switch: 48 PoE + 4 SFP+
  ...make("d_sw_tor", "", 48, "rj45", "1G", {
    withLink: [1, 2, 3, 4, 5, 8, 9, 12, 17, 22, 23, 24, 25, 31, 33, 47, 48],
  }),
  ...make("d_sw_tor", "SFP", 4, "sfp_plus", "10G", { withLink: [1, 2] }).map(
    (p) => ({ ...p, name: `SFP+${p.position}` }),
  ),

  // Aggregation switch: 28 SFP+
  ...make("d_sw_agg", "SFP", 28, "sfp_plus", "10G", {
    withLink: [1, 2, 3, 4, 5, 6, 7, 8],
  }).map((p) => ({ ...p, name: `SFP+${p.position}` })),

  // Firewall: 6 RJ45
  ...make("d_fw", "igb", 6, "rj45", "1G", { withLink: [1, 2, 3] }).map((p) => ({
    ...p,
    name: `igb${p.position - 1}`,
  })),

  // Unifi: 1 RJ45
  ...make("d_unifi", "eth", 1, "rj45", "1G", { withLink: [1] }).map((p) => ({
    ...p,
    name: "eth0",
  })),

  // PVE-01: 4 RJ45 + 2 SFP+
  ...make("d_srv_pve1", "eno", 4, "rj45", "1G", { withLink: [1, 2] }).map(
    (p) => ({ ...p, name: `eno${p.position}` }),
  ),
  ...make("d_srv_pve1", "enp", 2, "sfp_plus", "10G", { withLink: [1, 2] }).map(
    (p) => ({ ...p, name: `enp1s0f${p.position - 1}` }),
  ),

  // PVE-02: same as PVE-01
  ...make("d_srv_pve2", "eno", 4, "rj45", "1G", { withLink: [1, 2] }).map(
    (p) => ({ ...p, name: `eno${p.position}` }),
  ),
  ...make("d_srv_pve2", "enp", 2, "sfp_plus", "10G", { withLink: [1, 2] }).map(
    (p) => ({ ...p, name: `enp1s0f${p.position - 1}` }),
  ),

  // PVE-03: 2 RJ45 + 4 SFP+
  ...make("d_srv_pve3", "eno", 2, "rj45", "1G", { withLink: [1] }).map((p) => ({
    ...p,
    name: `eno${p.position}`,
  })),
  ...make("d_srv_pve3", "enp", 4, "sfp_plus", "10G", {
    withLink: [1, 2, 3, 4],
  }).map((p) => ({ ...p, name: `enp4s0f${p.position - 1}` })),

  // TrueNAS: 2 RJ45 + 2 SFP+
  ...make("d_srv_nas", "igb", 2, "rj45", "1G", { withLink: [1] }).map((p) => ({
    ...p,
    name: `igb${p.position - 1}`,
  })),
  ...make("d_srv_nas", "ix", 2, "sfp_plus", "10G", { withLink: [1, 2] }).map(
    (p) => ({ ...p, name: `ix${p.position - 1}` }),
  ),

  // Backup: 4 RJ45
  ...make("d_srv_backup", "eno", 4, "rj45", "1G", { withLink: [1] }).map(
    (p) => ({ ...p, name: `eno${p.position}` }),
  ),
];

// Force a few specific link states for realism
ports.forEach((p) => {
  if (p.deviceId === "d_srv_backup") p.linkState = "down";
});

// ----- Port links (cables) -----

export const portLinks: PortLink[] = [
  // PP -> ToR (first 5 ports)
  {
    id: "l_1",
    fromPortId: "p_d_pp24_1",
    toPortId: "p_d_sw_tor_1",
    cableType: "Cat6",
    cableLength: "0.5m",
    color: "blue",
  },
  {
    id: "l_2",
    fromPortId: "p_d_pp24_2",
    toPortId: "p_d_sw_tor_2",
    cableType: "Cat6",
    cableLength: "0.5m",
    color: "blue",
  },
  {
    id: "l_3",
    fromPortId: "p_d_pp24_3",
    toPortId: "p_d_sw_tor_3",
    cableType: "Cat6",
    cableLength: "0.5m",
    color: "blue",
  },
  {
    id: "l_4",
    fromPortId: "p_d_pp24_4",
    toPortId: "p_d_sw_tor_4",
    cableType: "Cat6",
    cableLength: "0.5m",
    color: "blue",
  },
  {
    id: "l_5",
    fromPortId: "p_d_pp24_5",
    toPortId: "p_d_sw_tor_5",
    cableType: "Cat6",
    cableLength: "0.5m",
    color: "blue",
  },

  // ToR SFP+ -> Aggregation
  {
    id: "l_6",
    fromPortId: "p_d_sw_tor_49",
    toPortId: "p_d_sw_agg_1",
    cableType: "DAC",
    cableLength: "1m",
    color: "black",
  },
  {
    id: "l_7",
    fromPortId: "p_d_sw_tor_50",
    toPortId: "p_d_sw_agg_2",
    cableType: "DAC",
    cableLength: "1m",
    color: "black",
  },

  // Firewall -> ToR (WAN, LAN, DMZ)
  {
    id: "l_8",
    fromPortId: "p_d_fw_1",
    toPortId: "p_d_sw_tor_47",
    cableType: "Cat6",
    cableLength: "1m",
    color: "red",
  },
  {
    id: "l_9",
    fromPortId: "p_d_fw_2",
    toPortId: "p_d_sw_tor_48",
    cableType: "Cat6",
    cableLength: "1m",
    color: "green",
  },

  // Unifi -> ToR
  {
    id: "l_10",
    fromPortId: "p_d_unifi_1",
    toPortId: "p_d_sw_tor_24",
    cableType: "Cat6",
    cableLength: "0.5m",
    color: "yellow",
  },

  // PVEs -> Aggregation (10G)
  {
    id: "l_11",
    fromPortId: "p_d_srv_pve1_5",
    toPortId: "p_d_sw_agg_3",
    cableType: "DAC",
    cableLength: "3m",
    color: "black",
  },
  {
    id: "l_12",
    fromPortId: "p_d_srv_pve1_6",
    toPortId: "p_d_sw_agg_4",
    cableType: "DAC",
    cableLength: "3m",
    color: "black",
  },
  {
    id: "l_13",
    fromPortId: "p_d_srv_pve2_5",
    toPortId: "p_d_sw_agg_5",
    cableType: "DAC",
    cableLength: "3m",
    color: "black",
  },
  {
    id: "l_14",
    fromPortId: "p_d_srv_pve2_6",
    toPortId: "p_d_sw_agg_6",
    cableType: "DAC",
    cableLength: "3m",
    color: "black",
  },
  {
    id: "l_15",
    fromPortId: "p_d_srv_pve3_3",
    toPortId: "p_d_sw_agg_7",
    cableType: "DAC",
    cableLength: "3m",
    color: "black",
  },
  {
    id: "l_16",
    fromPortId: "p_d_srv_pve3_4",
    toPortId: "p_d_sw_agg_8",
    cableType: "DAC",
    cableLength: "3m",
    color: "black",
  },

  // TrueNAS -> Aggregation
  {
    id: "l_17",
    fromPortId: "p_d_srv_nas_3",
    toPortId: "p_d_sw_tor_31",
    cableType: "OM4 LC-LC",
    cableLength: "3m",
    color: "aqua",
  },
  {
    id: "l_18",
    fromPortId: "p_d_srv_nas_4",
    toPortId: "p_d_sw_tor_33",
    cableType: "OM4 LC-LC",
    cableLength: "3m",
    color: "aqua",
  },

  // PVE mgmt
  {
    id: "l_19",
    fromPortId: "p_d_srv_pve1_1",
    toPortId: "p_d_sw_tor_25",
    cableType: "Cat6",
    cableLength: "3m",
    color: "gray",
  },
  {
    id: "l_20",
    fromPortId: "p_d_srv_pve2_1",
    toPortId: "p_d_sw_tor_8",
    cableType: "Cat6",
    cableLength: "3m",
    color: "gray",
  },
];

// ----- VLANs -----

export const vlans: Vlan[] = [
  {
    id: "v_default",
    labId: "lab_home",
    vlanId: 10,
    name: "Default",
    description: "Mgmt + servers",
    color: "#6a9bd4",
  },
  {
    id: "v_iot",
    labId: "lab_home",
    vlanId: 20,
    name: "IoT",
    description: "Smart home, cameras",
    color: "#6abf69",
  },
  {
    id: "v_dmz",
    labId: "lab_home",
    vlanId: 30,
    name: "DMZ",
    description: "Public-facing services",
    color: "#d46060",
  },
  {
    id: "v_storage",
    labId: "lab_home",
    vlanId: 40,
    name: "Storage",
    description: "iSCSI, NFS, replication",
    color: "#b574d4",
  },
  {
    id: "v_guest",
    labId: "lab_home",
    vlanId: 50,
    name: "Guest",
    description: "Guest WiFi",
    color: "#d4a13c",
  },
];

// ----- Subnets -----

export const subnets: Subnet[] = [
  {
    id: "s_default",
    labId: "lab_home",
    cidr: "10.0.10.0/24",
    name: "Default / Mgmt",
    vlanId: "v_default",
    integrity: { state: "ok", canonicalCidr: "10.0.10.0/24", conflicts: [] },
  },
  {
    id: "s_iot",
    labId: "lab_home",
    cidr: "10.0.20.0/24",
    name: "IoT",
    vlanId: "v_iot",
    integrity: { state: "ok", canonicalCidr: "10.0.20.0/24", conflicts: [] },
  },
  {
    id: "s_dmz",
    labId: "lab_home",
    cidr: "10.0.30.0/24",
    name: "DMZ",
    vlanId: "v_dmz",
    integrity: { state: "ok", canonicalCidr: "10.0.30.0/24", conflicts: [] },
  },
  {
    id: "s_storage",
    labId: "lab_home",
    cidr: "10.0.40.0/24",
    name: "Storage",
    vlanId: "v_storage",
    integrity: { state: "ok", canonicalCidr: "10.0.40.0/24", conflicts: [] },
  },
  {
    id: "s_guest",
    labId: "lab_home",
    cidr: "10.0.50.0/24",
    name: "Guest",
    vlanId: "v_guest",
    integrity: { state: "ok", canonicalCidr: "10.0.50.0/24", conflicts: [] },
  },
];

// ----- DHCP scopes -----

export const scopes: DhcpScope[] = [
  {
    id: "sc_default",
    subnetId: "s_default",
    name: "default-pool",
    startIp: "10.0.10.100",
    endIp: "10.0.10.199",
    gateway: "10.0.10.1",
    dnsServers: ["10.0.10.1", "1.1.1.1"],
  },
  {
    id: "sc_iot",
    subnetId: "s_iot",
    name: "iot-pool",
    startIp: "10.0.20.100",
    endIp: "10.0.20.250",
    gateway: "10.0.20.1",
  },
  {
    id: "sc_dmz",
    subnetId: "s_dmz",
    name: "dmz-pool",
    startIp: "10.0.30.100",
    endIp: "10.0.30.150",
    gateway: "10.0.30.1",
  },
];

// ----- IP assignments -----

export const ipAssignments: IpAssignment[] = [
  {
    id: "ip_1",
    subnetId: "s_default",
    ipAddress: "10.0.10.1",
    assignmentType: "device",
    deviceId: "d_fw",
    hostname: "fw-01",
    description: "Edge firewall LAN",
  },
  {
    id: "ip_2",
    subnetId: "s_default",
    ipAddress: "10.0.10.2",
    assignmentType: "device",
    deviceId: "d_sw_tor",
    hostname: "sw-tor-01",
  },
  {
    id: "ip_3",
    subnetId: "s_default",
    ipAddress: "10.0.10.3",
    assignmentType: "device",
    deviceId: "d_sw_agg",
    hostname: "sw-agg-01",
  },
  {
    id: "ip_4",
    subnetId: "s_default",
    ipAddress: "10.0.10.4",
    assignmentType: "device",
    deviceId: "d_unifi",
    hostname: "unifi-01",
  },
  {
    id: "ip_5",
    subnetId: "s_default",
    ipAddress: "10.0.10.11",
    assignmentType: "device",
    deviceId: "d_srv_pve1",
    hostname: "pve-01",
  },
  {
    id: "ip_6",
    subnetId: "s_default",
    ipAddress: "10.0.10.12",
    assignmentType: "device",
    deviceId: "d_srv_pve2",
    hostname: "pve-02",
  },
  {
    id: "ip_7",
    subnetId: "s_default",
    ipAddress: "10.0.10.13",
    assignmentType: "device",
    deviceId: "d_srv_pve3",
    hostname: "pve-03",
  },
  {
    id: "ip_8",
    subnetId: "s_default",
    ipAddress: "10.0.10.20",
    assignmentType: "device",
    deviceId: "d_srv_nas",
    hostname: "truenas-01",
  },
  {
    id: "ip_9",
    subnetId: "s_default",
    ipAddress: "10.0.10.21",
    assignmentType: "device",
    deviceId: "d_srv_backup",
    hostname: "backup-01",
  },
  {
    id: "ip_10",
    subnetId: "s_default",
    ipAddress: "10.0.10.250",
    assignmentType: "device",
    deviceId: "d_pdu_net",
    hostname: "pdu-net-01",
  },
  {
    id: "ip_11",
    subnetId: "s_default",
    ipAddress: "10.0.10.251",
    assignmentType: "device",
    deviceId: "d_ups",
    hostname: "ups-01",
  },
  {
    id: "ip_12",
    subnetId: "s_default",
    ipAddress: "10.0.10.252",
    assignmentType: "device",
    deviceId: "d_pdu_cmp",
    hostname: "pdu-cmp-01",
  },

  // VMs on PVE
  {
    id: "ip_v1",
    subnetId: "s_default",
    ipAddress: "10.0.10.50",
    assignmentType: "vm",
    vmId: "vm_1",
    hostname: "gitea",
    description: "Gitea on pve-01",
  },
  {
    id: "ip_v2",
    subnetId: "s_default",
    ipAddress: "10.0.10.51",
    assignmentType: "vm",
    vmId: "vm_2",
    hostname: "home-assistant",
    description: "HA on pve-01",
  },
  {
    id: "ip_v3",
    subnetId: "s_default",
    ipAddress: "10.0.10.52",
    assignmentType: "vm",
    vmId: "vm_3",
    hostname: "plex",
    description: "Plex on pve-02",
  },
  {
    id: "ip_v4",
    subnetId: "s_default",
    ipAddress: "10.0.10.53",
    assignmentType: "vm",
    vmId: "vm_4",
    hostname: "nextcloud",
    description: "Nextcloud on pve-02",
  },
  {
    id: "ip_v5",
    subnetId: "s_default",
    ipAddress: "10.0.10.54",
    assignmentType: "vm",
    vmId: "vm_5",
    hostname: "ollama",
    description: "LLM host on pve-03",
  },

  // Containers
  {
    id: "ip_c1",
    subnetId: "s_default",
    ipAddress: "10.0.10.70",
    assignmentType: "container",
    containerId: "ct_1",
    hostname: "pihole",
  },
  {
    id: "ip_c2",
    subnetId: "s_default",
    ipAddress: "10.0.10.71",
    assignmentType: "container",
    containerId: "ct_2",
    hostname: "unbound",
  },
  {
    id: "ip_c3",
    subnetId: "s_default",
    ipAddress: "10.0.10.72",
    assignmentType: "container",
    containerId: "ct_3",
    hostname: "wireguard",
  },

  // Reservations
  {
    id: "ip_r1",
    subnetId: "s_default",
    ipAddress: "10.0.10.5",
    assignmentType: "reserved",
    hostname: "reserved",
    description: "Future controller",
  },
  {
    id: "ip_r2",
    subnetId: "s_default",
    ipAddress: "10.0.10.6",
    assignmentType: "reserved",
    hostname: "reserved",
  },

  // IoT
  {
    id: "ip_i1",
    subnetId: "s_iot",
    ipAddress: "10.0.20.10",
    assignmentType: "device",
    hostname: "cam-front-door",
  },
  {
    id: "ip_i2",
    subnetId: "s_iot",
    ipAddress: "10.0.20.11",
    assignmentType: "device",
    hostname: "cam-back-yard",
  },
  {
    id: "ip_i3",
    subnetId: "s_iot",
    ipAddress: "10.0.20.12",
    assignmentType: "device",
    hostname: "thermostat",
  },
];

// ----- Audit log -----

export const auditLog: AuditEntry[] = [
  {
    id: "a1",
    ts: new Date(Date.now() - 3 * 60_000).toISOString(),
    user: "admin",
    action: "ip.assign",
    entityType: "IpAssignment",
    entityId: "ip_v5",
    summary: "Assigned 10.0.10.54 to ollama (vm)",
  },
  {
    id: "a2",
    ts: new Date(Date.now() - 12 * 60_000).toISOString(),
    user: "admin",
    action: "device.update",
    entityType: "Device",
    entityId: "d_unifi",
    summary: "Marked unifi-01 status: warning",
  },
  {
    id: "a3",
    ts: new Date(Date.now() - 47 * 60_000).toISOString(),
    user: "admin",
    action: "port.link",
    entityType: "PortLink",
    entityId: "l_18",
    summary: "Linked truenas-01:ix1 ↔ sw-tor-01:31",
  },
  {
    id: "a4",
    ts: new Date(Date.now() - 2 * 3600_000).toISOString(),
    user: "editor",
    action: "device.create",
    entityType: "Device",
    entityId: "d_srv_pve3",
    summary: "Created pve-03 in CMP-01 U36-37",
  },
  {
    id: "a5",
    ts: new Date(Date.now() - 4 * 3600_000).toISOString(),
    user: "admin",
    action: "subnet.create",
    entityType: "Subnet",
    entityId: "s_storage",
    summary: "Created subnet 10.0.40.0/24 (Storage)",
  },
  {
    id: "a6",
    ts: new Date(Date.now() - 26 * 3600_000).toISOString(),
    user: "editor",
    action: "device.move",
    entityType: "Device",
    entityId: "d_srv_backup",
    summary: "Moved backup-01 to maintenance",
  },
];

// ----- Convenience aggregates -----

export const portsByDeviceId = ports.reduce<Record<string, Port[]>>(
  (acc, p) => {
    (acc[p.deviceId] ??= []).push(p);
    return acc;
  },
  {},
);

export const linkByPortId: Record<string, PortLink> = portLinks.reduce<
  Record<string, PortLink>
>((acc, l) => {
  acc[l.fromPortId] = l;
  acc[l.toPortId] = l;
  return acc;
}, {});

export const deviceById: Record<string, Device> = devices.reduce<
  Record<string, Device>
>((acc, d) => {
  acc[d.id] = d;
  return acc;
}, {});

export const portById: Record<string, Port> = ports.reduce<
  Record<string, Port>
>((acc, p) => {
  acc[p.id] = p;
  return acc;
}, {});

export const ipsBySubnetId: Record<string, IpAssignment[]> =
  ipAssignments.reduce<Record<string, IpAssignment[]>>((acc, ip) => {
    (acc[ip.subnetId] ??= []).push(ip);
    return acc;
  }, {});

export const vlanById: Record<string, Vlan> = vlans.reduce<
  Record<string, Vlan>
>((acc, v) => {
  acc[v.id] = v;
  return acc;
}, {});
