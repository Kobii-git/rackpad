#!/usr/bin/env node
// Generates a massive, realistic gold-mine network as a rackpad-backup-v1 JSON.
import { writeFileSync } from "node:fs";
import { scryptSync, randomBytes } from "node:crypto";

const now = Date.now();
const iso = (ms = 0) => new Date(now - ms).toISOString();
const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];

const counters = {};
const id = (p) => {
  counters[p] = (counters[p] || 0) + 1;
  return `${p}_${String(counters[p]).padStart(4, "0")}`;
};
const hex = (n) => Array.from({ length: n }, () => rand(16).toString(16)).join("");
const mac = () =>
  Array.from({ length: 6 }, () => rand(256).toString(16).padStart(2, "0")).join(":");
const serial = (pre) => `${pre}-${hex(8).toUpperCase()}`;
const demoAdminPassword = randomBytes(24).toString("base64url");

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(pw, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

const data = {};
for (const k of [
  "labs","rooms","racks","devices","virtualSwitches","ports","portLinks",
  "portTemplates","vlans","vlanRanges","subnets","dhcpScopes","ipZones",
  "ipAssignments","discoveredDevices","documentationPages","deviceImages",
  "referenceImages","auditLog","users","oidcIdentities","deviceMonitors",
  "snmpCredentials","snmpTrapSources","snmpTrapLog","deviceServices",
  "wifiControllers","wifiSsids","wifiAccessPoints","wifiRadios",
  "wifiRadioSsids","wifiClientAssociations","appSettings",
]) data[k] = [];

const LAB = "lab_aurora";
data.labs.push({
  id: LAB,
  name: "Aurora Gold Mine — Enterprise Network",
  description:
    "Full corporate, operational, and OT/SCADA network for the Aurora Gold Mine: two data centres, departmental access layers, and remote shaft/plant sites.",
  location: "Aurora Gold Mine, Witwatersrand Basin",
});

data.users.push({
  id: "u_admin",
  username: "admin",
  displayName: "Mine Network Admin",
  passwordHash: hashPassword(demoAdminPassword),
  role: "admin",
  disabled: 1,
  createdAt: iso(86400000 * 60),
  lastLoginAt: null,
});

// ── VLANs + subnets ────────────────────────────────────────────
const vlanDefs = [
  [10, "Management", "Infrastructure management", "#6a9bd4", "10.10.0.0/24"],
  [20, "Servers", "Server / compute", "#59c36a", "10.20.0.0/24"],
  [30, "Storage", "SAN / NAS storage", "#316aa9", "10.30.0.0/24"],
  [40, "Voice", "VoIP handsets", "#e6a93b", "10.40.0.0/24"],
  [50, "CCTV-Security", "Surveillance cameras + NVR", "#ba4141", "10.50.0.0/24"],
  [60, "OT-SCADA", "Mining OT / SCADA / PLCs", "#7c3aed", "10.60.0.0/24"],
  [70, "WiFi-Corp", "Corporate wireless", "#19889a", "10.70.0.0/24"],
  [80, "WiFi-Guest", "Guest wireless", "#97a7b7", "10.80.0.0/24"],
  [90, "Printers", "Print devices", "#a57a11", "10.90.0.0/24"],
  [100, "IoT-Sensors", "Environmental / IoT sensors", "#4dc8d7", "10.100.0.0/24"],
  [110, "Backup", "Backup / replication", "#34aebd", "10.110.0.0/24"],
  [200, "DMZ", "Internet-facing services", "#de6666", "10.200.0.0/24"],
];
const subnetByVlan = {};
for (const [vid, name, desc, color, cidr] of vlanDefs) {
  const vlanId = id("vlan");
  data.vlans.push({ id: vlanId, labId: LAB, vlanId: vid, name, description: desc, color });
  const subId = id("sub");
  data.subnets.push({ id: subId, labId: LAB, cidr, name, description: desc, vlanId });
  subnetByVlan[vid] = { subId, cidr, base: cidr.split("/")[0].split(".").slice(0, 3).join(".") };
}
data.vlanRanges.push(
  { id: id("vr"), labId: LAB, name: "Infrastructure", startVlan: 1, endVlan: 199, purpose: "Core, servers, storage, management", color: "#6a9bd4" },
  { id: id("vr"), labId: LAB, name: "Edge & DMZ", startVlan: 200, endVlan: 299, purpose: "DMZ and edge services", color: "#de6666" },
  { id: id("vr"), labId: LAB, name: "Departments", startVlan: 300, endVlan: 399, purpose: "Departmental user networks", color: "#59c36a" },
  { id: id("vr"), labId: LAB, name: "Remote Sites", startVlan: 400, endVlan: 499, purpose: "Shaft, plant and remote site networks", color: "#e6a93b" },
);

// management IP allocator (VLAN 10)
let mgmtHost = 2;
const mgmtSub = subnetByVlan[10];
function mgmtIp() {
  const ip = `${mgmtSub.base}.${mgmtHost++}`;
  return ip;
}
function assignIp(subVlan, ipAddress, type, deviceId, hostname, desc) {
  const s = subnetByVlan[subVlan];
  data.ipAssignments.push({
    id: id("ip"), subnetId: s.subId, ipAddress, assignmentType: type,
    deviceId: deviceId ?? null, portId: null, vmId: null, containerId: null,
    hostname: hostname ?? null, description: desc ?? null, allocationMode: "static", dhcpScopeId: null,
  });
}

// ── helpers: rooms / racks / devices / ports / cables ──────────
function addRoom(name, location, notes) {
  const rid = id("room");
  data.rooms.push({ id: rid, labId: LAB, name, description: notes ?? null, location, notes: null });
  return rid;
}
function addRack(roomId, name, totalU, location) {
  const rid = id("rack");
  data.racks.push({ id: rid, labId: LAB, roomId, name, totalU, description: null, location, notes: null });
  return rid;
}
function addDevice(o) {
  const did = id("d");
  const ip = o.mgmt ? mgmtIp() : null;
  data.devices.push({
    id: did, labId: LAB, rackId: o.rackId ?? null, hostname: o.hostname,
    displayName: o.displayName ?? null, deviceType: o.deviceType,
    manufacturer: o.manufacturer ?? null, model: o.model ?? null,
    serial: serial(o.sn ?? "AGM"), managementIp: ip, macAddress: mac(),
    status: o.status ?? "online", placement: o.placement ?? (o.rackId ? "rack" : "room"),
    parentDeviceId: null, roomId: o.roomId ?? null,
    cpuCores: o.cpuCores ?? null, memoryGb: o.memoryGb ?? null, storageGb: o.storageGb ?? null,
    specs: o.specs ?? null, startU: o.startU ?? null, heightU: o.heightU ?? (o.rackId ? 1 : null),
    face: o.face ?? (o.rackId ? "front" : null), tags: o.tags ?? [], notes: o.notes ?? null,
    lastSeen: iso(rand(3600000)), networkMode: "normal", snmpCredentialId: null,
  });
  if (ip) assignIp(10, ip, "device", did, o.hostname, `${o.deviceType} management`);
  return did;
}
function addPort(deviceId, name, position, kind, opts = {}) {
  const pid = id("p");
  data.ports.push({
    id: pid, deviceId, name, position, kind,
    speed: opts.speed ?? null, linkState: opts.linkState ?? "unknown",
    mode: opts.mode ?? null, vlanId: opts.vlanId ?? null,
    allowedVlanIds: opts.allowedVlanIds ?? null, description: opts.description ?? null,
    face: opts.face ?? "front", virtualSwitchId: null, snmpIfIndex: opts.snmpIfIndex ?? position,
  });
  return pid;
}
// switch ports: N copper access + M fiber uplinks. returns {access:[], uplink:[]}
function switchPorts(deviceId, access, uplink, accessSpeed = "1G", uplinkSpeed = "10G") {
  const out = { access: [], uplink: [] };
  let pos = 1;
  for (let i = 1; i <= access; i++)
    out.access.push(addPort(deviceId, `Gi1/0/${i}`, pos++, "rj45", { speed: accessSpeed, mode: "access" }));
  for (let i = 1; i <= uplink; i++)
    out.uplink.push(addPort(deviceId, `SFP+ ${i}`, pos++, "sfp_plus", { speed: uplinkSpeed, mode: "trunk" }));
  return out;
}
function nicPorts(deviceId, count, kind = "rj45", speed = "10G") {
  const arr = [];
  for (let i = 1; i <= count; i++) arr.push(addPort(deviceId, `${kind === "rj45" ? "eth" : "p"}${i}`, i, kind, { speed }));
  return arr;
}
const CABLES = {
  copper: ["Cat6", "Cat6a"],
  fiber: ["OM4", "OM3"],
  longhaul: ["Single-mode OS2"],
  dac: ["DAC"],
};
function cable(fromPortId, toPortId, type, length, color) {
  if (!fromPortId || !toPortId) {
    throw new Error(
      `Cannot create ${type ?? "unspecified"} cable: ` +
        `fromPortId=${fromPortId ?? "missing"}, toPortId=${toPortId ?? "missing"}.`,
    );
  }
  data.portLinks.push({
    id: id("pl"), fromPortId, toPortId, cableType: type,
    cableLength: length ?? null, color: color ?? null, notes: null,
  });
}

// ── SERVER ROOMS (2 data centres) ──────────────────────────────
function buildDataCentre(label, loc, primary) {
  const room = addRoom(label, loc, `${primary ? "Primary" : "Secondary / DR"} data centre`);
  const coreRack = addRack(room, `${primary ? "DC1" : "DC2"}-CORE`, 42, "Network core");
  const cmpRack = addRack(room, `${primary ? "DC1" : "DC2"}-CMP`, 42, "Compute");
  const stgRack = addRack(room, `${primary ? "DC1" : "DC2"}-STG`, 42, "Storage");

  const tag = primary ? "dc1" : "dc2";
  const u = { core: 40, cmp: 40, stg: 40 };
  // core switches
  const cores = [];
  for (let i = 1; i <= 2; i++) {
    const d = addDevice({ rackId: coreRack, roomId: room, hostname: `${tag}-core-${i}`, displayName: `${label} Core ${i}`, deviceType: "switch", manufacturer: "Cisco", model: "Nexus 9336C-FX2", mgmt: true, startU: u.core--, tags: ["core", "l3"], specs: "36x 100G QSFP28" });
    cores.push({ d, ...switchPorts(d, 0, 48, "100G", "100G") });
  }
  cable(cores[0].uplink[0], cores[1].uplink[0], "DAC", "1m", "blue");
  cable(cores[0].uplink[1], cores[1].uplink[1], "DAC", "1m", "blue");
  // distribution / aggregation
  const dist = [];
  if (primary) for (let i = 1; i <= 4; i++) {
    const d = addDevice({ rackId: coreRack, roomId: room, hostname: `${tag}-dist-${i}`, displayName: `${label} Distribution ${i}`, deviceType: "switch", manufacturer: "Aruba", model: "CX 8360-48Y6C", mgmt: true, startU: u.core--, tags: ["distribution"] });
    const sp = switchPorts(d, 48, 6, "25G", "100G");
    dist.push({ d, ...sp });
    cable(sp.uplink[4], cores[0].uplink[2 + i], pick(CABLES.fiber), "10m", "aqua");
    cable(sp.uplink[5], cores[1].uplink[2 + i], pick(CABLES.fiber), "10m", "aqua");
  }
  // firewalls (HA pair) + routers
  const fws = [];
  for (let i = 1; i <= 2; i++) {
    const d = addDevice({ rackId: coreRack, roomId: room, hostname: `${tag}-fw-${i}`, displayName: `${label} Firewall ${i}`, deviceType: "firewall", manufacturer: "Palo Alto", model: "PA-5410", mgmt: true, startU: u.core--, tags: ["firewall", "ha"] });
    const ports = [];
    for (let p = 1; p <= 12; p++) ports.push(addPort(d, `ethernet1/${p}`, p, p <= 8 ? "sfp_plus" : "rj45", { speed: "10G" }));
    fws.push({ d, ports });
    cable(ports[0], cores[0].uplink[10 + i], pick(CABLES.fiber), "5m", "red");
    cable(ports[1], cores[1].uplink[10 + i], pick(CABLES.fiber), "5m", "red");
  }
  cable(fws[0].ports[2], fws[1].ports[2], "DAC", "1m", "red"); // HA link
  for (let i = 1; i <= 2; i++) {
    const d = addDevice({ rackId: coreRack, roomId: room, hostname: `${tag}-wan-rtr-${i}`, displayName: `${label} WAN Router ${i}`, deviceType: "router", manufacturer: "Cisco", model: "ASR 1001-X", mgmt: true, startU: u.core--, tags: ["wan", "edge"] });
    const ports = nicPorts(d, 6, "sfp_plus", "10G");
    cable(ports[0], fws[i - 1].ports[3], pick(CABLES.fiber), "3m", "orange");
  }

  // compute: ToR switches + hypervisors + app/db/infra servers
  const tors = [];
  for (let i = 1; i <= 2; i++) {
    const d = addDevice({ rackId: cmpRack, roomId: room, hostname: `${tag}-tor-${i}`, displayName: `${label} ToR ${i}`, deviceType: "switch", manufacturer: "Aruba", model: "CX 8325-48Y8C", mgmt: true, startU: u.cmp--, tags: ["tor"] });
    const sp = switchPorts(d, 44, 4, "25G", "100G");
    tors.push({ d, ...sp });
    cable(sp.uplink[2], cores[0].uplink[20 + i], pick(CABLES.fiber), "5m", "aqua");
    cable(sp.uplink[3], cores[1].uplink[20 + i], pick(CABLES.fiber), "5m", "aqua");
  }
  let torPort = 0;
  function toTor(portId) {
    const t = tors[torPort % 2];
    const tp = t.access[Math.floor(torPort / 2)];
    torPort++;
    cable(portId, tp, pick(CABLES.dac), "2m", "black");
  }
  const serverPlan = primary
    ? [
        ["esxi", "Hypervisor", 4, "Dell", "PowerEdge R760", 64, 1024, 4000],
        ["esxi", "Hypervisor", 4, "Dell", "PowerEdge R760", 64, 1024, 4000],
        ["esxi", "Hypervisor", 4, "Dell", "PowerEdge R760", 64, 1024, 4000],
        ["ad-dns", "Active Directory / DNS", 2, "HPE", "ProLiant DL380", 16, 64, 1000],
        ["ad-dns", "Active Directory / DNS", 2, "HPE", "ProLiant DL380", 16, 64, 1000],
        ["dhcp", "DHCP / IPAM", 2, "HPE", "ProLiant DL360", 8, 32, 500],
        ["file", "File Server", 2, "Dell", "PowerEdge R750", 16, 128, 16000],
        ["sql", "SQL Database", 4, "Dell", "PowerEdge R760", 32, 256, 8000],
        ["erp-app", "ERP Application", 4, "HPE", "ProLiant DL380", 24, 192, 2000],
        ["intranet", "Intranet / Web", 2, "HPE", "ProLiant DL360", 8, 32, 500],
        ["scada-hist", "SCADA Historian", 4, "Dell", "PowerEdge R760", 24, 256, 12000],
        ["nvr", "CCTV NVR", 2, "Dell", "PowerEdge R750", 16, 64, 64000],
        ["backup", "Backup Server", 4, "HPE", "Apollo 4510", 24, 256, 200000],
        ["mail-relay", "Mail Relay", 2, "HPE", "ProLiant DL360", 8, 32, 500],
        ["monitoring", "Monitoring / NMS", 4, "Dell", "PowerEdge R650", 16, 64, 2000],
      ]
    : [
        ["esxi", "DR Hypervisor", 4, "Dell", "PowerEdge R760", 64, 1024, 4000],
        ["esxi", "DR Hypervisor", 4, "Dell", "PowerEdge R760", 64, 1024, 4000],
        ["ad-dns", "DR Active Directory / DNS", 2, "HPE", "ProLiant DL380", 16, 64, 1000],
        ["backup", "DR Backup / Replication", 4, "HPE", "Apollo 4510", 24, 256, 200000],
        ["scada-hist", "DR SCADA Historian", 4, "Dell", "PowerEdge R760", 24, 256, 12000],
      ];
  const servers = [];
  let svIp = primary ? 10 : 60;
  for (const [role, disp, nics, mfr, mdl, cpu, memx, stg] of serverPlan) {
    const d = addDevice({ rackId: cmpRack, roomId: room, hostname: `${tag}-${role}-${id("x").slice(-2)}`, displayName: disp, deviceType: "server", manufacturer: mfr, model: mdl, mgmt: true, startU: u.cmp > 2 ? u.cmp-- : null, heightU: 1, cpuCores: cpu, memoryGb: memx, storageGb: stg, tags: [role] });
    const np = nicPorts(d, nics, "sfp_plus", "25G");
    np.slice(0, 2).forEach(toTor);
    const sip = `${subnetByVlan[20].base}.${svIp++}`;
    assignIp(20, sip, "device", d, disp, `${disp} primary interface`);
    servers.push({ d, role, disp, ip: sip });
  }

  // storage
  const storage = [];
  let stIp = primary ? 10 : 40;
  const stgCount = primary ? 3 : 1;
  for (let i = 1; i <= stgCount; i++) {
    const d = addDevice({ rackId: stgRack, roomId: room, hostname: `${tag}-san-${i}`, displayName: `${label} Storage Array ${i}`, deviceType: "storage", manufacturer: "NetApp", model: "AFF A400", mgmt: true, startU: u.stg, heightU: 4, storageGb: 500000, tags: ["san", "nvme"] });
    u.stg -= 4;
    const np = nicPorts(d, 4, "sfp_plus", "32G");
    np.slice(0, 2).forEach(toTor);
    const sip = `${subnetByVlan[30].base}.${stIp++}`;
    assignIp(30, sip, "device", d, `Storage ${i}`, "Storage data interface");
    storage.push(d);
  }

  // power + patch
  for (let i = 1; i <= 2; i++) {
    addDevice({ rackId: coreRack, roomId: room, hostname: `${tag}-ups-${i}`, displayName: `${label} UPS ${i}`, deviceType: "ups", manufacturer: "APC", model: "Symmetra PX", startU: 4 - (i - 1) * 2, heightU: 2, tags: ["power"] });
    addDevice({ rackId: cmpRack, roomId: room, hostname: `${tag}-pdu-${i}`, displayName: `${label} PDU ${i}`, deviceType: "pdu", manufacturer: "APC", model: "Rack PDU 2G", startU: 42 - (i - 1), heightU: 1, tags: ["power"], placement: "rack" });
  }
  addDevice({ rackId: coreRack, roomId: room, hostname: `${tag}-pp-01`, displayName: `${label} Patch Panel`, deviceType: "patch_panel", manufacturer: "Panduit", model: "48-port Cat6a", startU: 42, heightU: 1 });

  return { room, cores, dist, tors, servers, storage };
}

const dc1 = buildDataCentre("Primary Data Centre", "Admin Building — Ground Floor", true);
const dc2 = buildDataCentre("DR Data Centre", "Shaft 2 Office — Secure Room", false);

// uplink target pools (distribution in DC1, cores as fallback)
const distUplinkPool = [];
for (const dsw of dc1.dist) for (const p of dsw.access) distUplinkPool.push(p);
const coreUplinkPool = [];
for (const c of [dc1.cores[0], dc1.cores[1], dc2.cores[0], dc2.cores[1]])
  for (let i = 24; i < 44; i++) coreUplinkPool.push(c.uplink[i]);
let distIdx = 0, coreIdx = 0;
const nextDistPort = () => distUplinkPool[distIdx++ % distUplinkPool.length];
const nextCorePort = () => coreUplinkPool[coreIdx++ % coreUplinkPool.length];

// ── 9 DEPARTMENTS ──────────────────────────────────────────────
const departments = [
  ["Mining Operations", 301], ["Processing Plant", 302], ["Engineering & Maintenance", 303],
  ["Geology & Survey", 304], ["Finance", 305], ["Human Resources", 306],
  ["Health, Safety & Environment", 307], ["Security & Surveillance", 308], ["Logistics & Warehouse", 309],
];
const apDevices = [];
let deptUserBase = 0;
for (const [deptName, vid] of departments) {
  // per-dept user subnet/VLAN
  const userBase = `10.${120 + deptUserBase}.0`;
  deptUserBase++;
  const uvlan = id("vlan");
  data.vlans.push({ id: uvlan, labId: LAB, vlanId: vid, name: `${deptName} Users`, description: `${deptName} workstations`, color: "#59c36a" });
  const usub = id("sub");
  data.subnets.push({ id: usub, labId: LAB, cidr: `${userBase}.0/24`, name: `${deptName} Users`, description: "User workstations", vlanId: uvlan });
  subnetByVlan[vid] = { subId: usub, cidr: `${userBase}.0/24`, base: userBase };
  data.dhcpScopes.push({ id: id("scope"), subnetId: usub, name: `${deptName} DHCP`, startIp: `${userBase}.50`, endIp: `${userBase}.250`, gateway: `${userBase}.1`, dnsServers: [`${subnetByVlan[10].base}.5`, `${subnetByVlan[10].base}.6`], description: "Workstation DHCP" });

  const room = addRoom(deptName, "Surface Operations", `${deptName} department`);
  const rack = addRack(room, `${deptName.split(" ")[0].toUpperCase().slice(0, 4)}-ACC`, 42, "Departmental comms room");
  let uPos = 40;
  const sws = [];
  for (let i = 1; i <= 6; i++) {
    const d = addDevice({ rackId: rack, roomId: room, hostname: `${deptName.split(" ")[0].toLowerCase().slice(0, 4)}-acc-${i}`, displayName: `${deptName} Access ${i}`, deviceType: "switch", manufacturer: "Aruba", model: "CX 6300M 48G", mgmt: true, startU: uPos--, tags: ["access"] });
    const sp = switchPorts(d, 48, 4, "1G", "10G");
    sws.push({ d, ...sp });
    // two uplinks to distribution (DC1)
    cable(sp.uplink[0], nextDistPort(), pick(CABLES.fiber), `${40 + rand(60)}m`, "aqua");
    cable(sp.uplink[1], nextDistPort(), pick(CABLES.fiber), `${40 + rand(60)}m`, "yellow");
    // a few endpoints on the first switch
    if (i === 1) {
      for (let e = 0; e < 4; e++) {
        const pc = addDevice({ roomId: room, hostname: `${deptName.split(" ")[0].toLowerCase().slice(0, 3)}-pc-${e + 1}`, displayName: `Workstation ${e + 1}`, deviceType: "endpoint", manufacturer: "Dell", model: "OptiPlex 7010", placement: "room", tags: ["workstation"] });
        const np = nicPorts(pc, 1, "rj45", "1G");
        cable(np[0], sp.access[e], pick(CABLES.copper), `${5 + rand(25)}m`, "blue");
        assignIp(vid, `${userBase}.${50 + e}`, "device", pc, `Workstation ${e + 1}`, null);
      }
      const printer = addDevice({ roomId: room, hostname: `${deptName.split(" ")[0].toLowerCase().slice(0, 3)}-prn-1`, displayName: `${deptName} Printer`, deviceType: "endpoint", manufacturer: "HP", model: "LaserJet E60175", placement: "room", tags: ["printer"] });
      cable(nicPorts(printer, 1, "rj45", "1G")[0], sp.access[10], pick(CABLES.copper), "12m", "white");
      assignIp(90, `${subnetByVlan[90].base}.${20 + deptUserBase}`, "device", printer, `${deptName} Printer`, null);
    }
  }
  // patch panel + AP
  addDevice({ rackId: rack, roomId: room, hostname: `${deptName.split(" ")[0].toLowerCase().slice(0, 4)}-pp-1`, displayName: `${deptName} Patch Panel`, deviceType: "patch_panel", manufacturer: "Panduit", model: "48-port Cat6a", startU: 42, heightU: 1 });
  const ap = addDevice({ roomId: room, hostname: `${deptName.split(" ")[0].toLowerCase().slice(0, 4)}-ap-1`, displayName: `${deptName} AP`, deviceType: "ap", manufacturer: "Aruba", model: "AP-635", mgmt: true, placement: "wireless", tags: ["wifi"] });
  cable(nicPorts(ap, 1, "rj45", "2.5G")[0], sws[0].access[47], pick(CABLES.copper), "20m", "green");
  apDevices.push(ap);
}

// ── 20 REMOTE SITES ────────────────────────────────────────────
const siteNames = [
  "Shaft 1 Headgear", "Shaft 2 Headgear", "Shaft 3 Headgear", "Main Processing Plant",
  "Primary Crusher", "Tailings Storage Facility", "North Access Gate", "South Access Gate",
  "Weighbridge", "Explosives Magazine", "Workshop A", "Workshop B", "Diesel Fuel Bay",
  "Water Treatment Plant", "Main Substation", "Conveyor Control C1", "Stockpile Control",
  "Assay Laboratory", "Mine Clinic", "Training Centre",
];
let siteVlan = 401;
siteNames.forEach((siteName, idx) => {
  const base = `10.${150 + idx}.0`;
  const vlanIdRow = id("vlan");
  data.vlans.push({ id: vlanIdRow, labId: LAB, vlanId: siteVlan, name: siteName, description: `${siteName} site network`, color: "#e6a93b" });
  const sub = id("sub");
  data.subnets.push({ id: sub, labId: LAB, cidr: `${base}.0/24`, name: siteName, description: "Remote site network", vlanId: vlanIdRow });
  subnetByVlan[siteVlan] = { subId: sub, cidr: `${base}.0/24`, base };
  siteVlan++;

  const room = addRoom(siteName, "Remote Site", `${siteName} field cabinet`);
  const rack = addRack(room, `SITE-${String(idx + 1).padStart(2, "0")}`, 12, "Field cabinet / DIN enclosure");
  let uPos = 10;
  const sws = [];
  const swCount = idx < 6 ? 2 : 1; // bigger sites get 2 switches
  for (let i = 1; i <= swCount; i++) {
    const d = addDevice({ rackId: rack, roomId: room, hostname: `site${idx + 1}-sw-${i}`, displayName: `${siteName} Switch ${i}`, deviceType: "switch", manufacturer: "Cisco", model: "IE-3400 (Industrial)", mgmt: true, startU: uPos--, tags: ["edge", "industrial"] });
    const sp = switchPorts(d, 24, 2, "1G", "10G");
    sws.push({ d, ...sp });
    // WAN uplink to core (long-haul fiber)
    cable(sp.uplink[0], nextCorePort(), pick(CABLES.longhaul), `${500 + rand(4000)}m`, "yellow");
    if (i === 2) cable(sp.uplink[1], sws[0].uplink[1], pick(CABLES.fiber), "20m", "aqua");
  }
  // an OT/SCADA PLC gateway + AP + UPS
  const plc = addDevice({ rackId: rack, roomId: room, hostname: `site${idx + 1}-plc-gw`, displayName: `${siteName} PLC Gateway`, deviceType: "server", manufacturer: "Siemens", model: "SIMATIC IPC", mgmt: true, startU: uPos, heightU: 1, tags: ["ot", "scada"], cpuCores: 4, memoryGb: 16, storageGb: 256 });
  cable(nicPorts(plc, 2, "rj45", "1G")[0], sws[0].access[0], pick(CABLES.copper), "3m", "purple");
  assignIp(60, `${subnetByVlan[60].base}.${20 + idx}`, "device", plc, `${siteName} PLC`, "SCADA gateway");
  // a couple of cameras (CCTV)
  for (let c = 0; c < 2; c++) {
    const cam = addDevice({ roomId: room, hostname: `site${idx + 1}-cam-${c + 1}`, displayName: `${siteName} Camera ${c + 1}`, deviceType: "endpoint", manufacturer: "Axis", model: "P3265-LVE", placement: "room", tags: ["cctv"] });
    cable(nicPorts(cam, 1, "rj45", "1G")[0], sws[0].access[2 + c], pick(CABLES.copper), `${10 + rand(40)}m`, "red");
    assignIp(50, `${subnetByVlan[50].base}.${30 + idx * 2 + c}`, "device", cam, `${siteName} Cam ${c + 1}`, null);
  }
  const ap = addDevice({ roomId: room, hostname: `site${idx + 1}-ap-1`, displayName: `${siteName} AP`, deviceType: "ap", manufacturer: "Aruba", model: "AP-567 (Outdoor)", mgmt: true, placement: "wireless", tags: ["wifi", "outdoor"] });
  cable(nicPorts(ap, 1, "rj45", "2.5G")[0], sws[0].access[5], pick(CABLES.copper), "25m", "green");
  apDevices.push(ap);
  addDevice({ rackId: rack, roomId: room, hostname: `site${idx + 1}-ups`, displayName: `${siteName} UPS`, deviceType: "ups", manufacturer: "Eaton", model: "9PX", startU: 1, heightU: 2, tags: ["power"] });
});

// ── WiFi: controller, SSIDs, APs, radios ───────────────────────
const wcDeviceId = dc1.servers.find((s) => s.role === "monitoring")?.d ?? dc1.servers[0].d;
const controllerId = id("wc");
data.wifiControllers.push({ id: controllerId, labId: LAB, deviceId: wcDeviceId, name: "Aurora WLAN Controller", vendor: "Aruba", model: "Mobility Conductor (VM)", managementIp: `${subnetByVlan[10].base}.250`, notes: "Central WLAN management" });
const ssidDefs = [
  ["AuroraGold-Corp", "Corporate staff", "WPA3-Enterprise", 0, 70, "#19889a"],
  ["AuroraGold-Guest", "Visitor access", "WPA2-PSK + captive portal", 0, 80, "#97a7b7"],
  ["AuroraGold-OT", "Handheld / OT devices", "WPA3-Enterprise", 1, 60, "#7c3aed"],
  ["AuroraGold-IoT", "IoT sensors", "WPA2-PSK", 1, 100, "#4dc8d7"],
];
const ssidIds = [];
for (const [name, purpose, security, hidden, vid, color] of ssidDefs) {
  const sid = id("ssid");
  const vlanRow = data.vlans.find((v) => v.vlanId === vid);
  data.wifiSsids.push({ id: sid, labId: LAB, name, purpose, security, hidden, vlanId: vlanRow?.id ?? null, color });
  ssidIds.push(sid);
}
for (const apId of apDevices) {
  data.wifiAccessPoints.push({ deviceId: apId, controllerId, location: null, firmwareVersion: "10.4.1.2", notes: null });
  const bands = [["2.4 GHz", 6, "20MHz", "12 dBm"], ["5 GHz", 44, "80MHz", "18 dBm"], ["6 GHz", 37, "160MHz", "18 dBm"]];
  for (const [band, ch, width, power] of bands) {
    const radioId = id("radio");
    data.wifiRadios.push({ id: radioId, apDeviceId: apId, slotName: band, band, channel: ch, channelWidth: width, txPower: power, notes: null });
    // corp+guest on 2.4/5, OT/IoT on all
    const ssidsForRadio = band === "6 GHz" ? [ssidIds[0]] : ssidIds;
    for (const s of ssidsForRadio) data.wifiRadioSsids.push({ radioId, ssidId: s });
  }
}

// ── Device services (on key servers) ───────────────────────────
function svc(deviceId, name, serviceType, vid, url) {
  data.deviceServices.push({
    id: id("svc"), deviceId, name, serviceType,
    ipAssignmentId: null, portId: null,
    vlanId: vid ? data.vlans.find((v) => v.vlanId === vid)?.id ?? null : null,
    monitorId: null, url: url ?? null, notes: null,
    createdAt: iso(86400000 * 20), updatedAt: iso(86400000),
  });
}
for (const s of dc1.servers) {
  if (s.role === "ad-dns") { svc(s.d, "Active Directory", "ad", 20); svc(s.d, "DNS", "dns", 20); }
  if (s.role === "dhcp") svc(s.d, "DHCP", "dhcp", 20);
  if (s.role === "file") svc(s.d, "SMB File Share", "file", 20);
  if (s.role === "sql") svc(s.d, "SQL Server", "database", 20);
  if (s.role === "erp-app") svc(s.d, "ERP", "app", 20, "https://erp.aurora.mine");
  if (s.role === "intranet") svc(s.d, "Intranet", "web", 200, "https://intranet.aurora.mine");
  if (s.role === "scada-hist") svc(s.d, "SCADA Historian", "app", 60);
  if (s.role === "nvr") svc(s.d, "CCTV NVR", "app", 50);
  if (s.role === "backup") svc(s.d, "Veeam Backup", "backup", 110);
  if (s.role === "monitoring") svc(s.d, "Network Monitoring", "app", 10, "https://nms.aurora.mine");
  if (s.role === "mail-relay") svc(s.d, "SMTP Relay", "app", 200);
}

// ── Monitors on core infrastructure ────────────────────────────
let sortOrder = 0;
function monitor(deviceId, name, target) {
  data.deviceMonitors.push({
    id: id("mon"), deviceId, name, type: "icmp", target, port: null, path: null,
    snmpVersion: null, snmpCommunity: null, snmpOid: null, snmpExpectedValue: null,
    snmpMatchMode: null, portId: null, snmpIfIndex: null, snmpCredentialId: null,
    intervalMs: 300000, enabled: 1, sortOrder: sortOrder++,
    lastCheckAt: iso(120000), lastAlertAt: null, lastResult: "online", lastMessage: "Reachable",
  });
}
for (const c of [...dc1.cores, ...dc2.cores]) monitor(c.d, "Core reachability", data.devices.find((x) => x.id === c.d)?.managementIp);
for (const s of dc1.servers.slice(0, 6)) monitor(s.d, `${s.disp} ICMP`, data.devices.find((x) => x.id === s.d)?.managementIp);

// ── Documentation ──────────────────────────────────────────────
data.documentationPages.push({
  id: id("doc"), labId: LAB, title: "Network Overview — Aurora Gold Mine",
  content: `# Aurora Gold Mine — Network Overview\n\nTwo data centres (Primary in the Admin Building, DR at Shaft 2) anchor a collapsed-core design.\n\n- **Core:** redundant Nexus 9336C-FX2 pair, 100G spine.\n- **Distribution:** 4x Aruba CX 8360 in DC1.\n- **Access:** 9 departments x 6 access switches; 20 remote sites on industrial IE-3400 switches over long-haul fibre.\n- **OT/SCADA:** isolated VLAN 60 with PLC gateways at each shaft/plant.\n- **Security:** Palo Alto PA-5410 HA pair; segmented CCTV (VLAN 50) and OT networks.\n\nSee the IPAM and VLAN views for the full address plan.`,
  createdAt: iso(86400000 * 25), updatedAt: iso(86400000 * 2),
});
data.documentationPages.push({
  id: id("doc"), labId: LAB, title: "OT / SCADA Segmentation",
  content: `# OT / SCADA Network\n\nVLAN **60** carries all operational technology: PLC gateways, SCADA historians, and mining control systems. It is firewalled from corporate VLANs and only reachable through the PA-5410 with explicit rules. Each shaft and plant has a Siemens SIMATIC IPC gateway bridging field devices to the historian in both data centres.`,
  createdAt: iso(86400000 * 18), updatedAt: iso(86400000 * 3),
});

// ── App settings ───────────────────────────────────────────────
data.appSettings.push({ key: "branding", value: JSON.stringify({ name: "Aurora Gold Mine" }), updatedAt: iso() });

const snapshot = {
  format: "rackpad-backup-v1",
  appVersion: "1.6.0-beta.1",
  exportedAt: iso(),
  exportedBy: "generator",
  secretsRedacted: true,
  data,
};

const out = process.argv[2] ?? "rackpad-backup-goldmine-demo.json";
writeFileSync(out, JSON.stringify(snapshot, null, 0));
const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length]).filter(([, n]) => n > 0));
console.log("wrote", out);
console.log(JSON.stringify(counts, null, 2));
console.log("disabled demo admin password:", demoAdminPassword);
