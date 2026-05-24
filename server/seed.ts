/**
 * Seed the database with the homelab mock dataset.
 * Only runs if the labs table is empty — safe to call on every startup.
 */
import { db, ensurePatchPanelPassThroughPorts } from './db.js'

// ── Seed data (mirrors src/lib/mock-data.ts) ──────────────────

const now = Date.now()

const lab = {
  id: 'lab_home',
  name: 'Home Lab',
  description: 'Primary homelab in the basement closet.',
  location: 'Basement / NW closet',
}

const studioLab = {
  id: 'lab_studio',
  name: 'Studio / Office',
  description: 'Detached office and maker-space network with its own edge gear.',
  location: 'Garden studio / upstairs office',
}

const labs = [lab, studioLab]

const demoRackImageDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAaQAAADwCAYAAABPJBBgAAAFq0lEQVR4nO3dMYoTcRiHYW+iW1pY2+wJLKe2mRvkXJbeKE2q1IrVCkMUtDMT5ntdnuJpfwQWvhfyh82bpw/PLwAw7c30BwCAJ0ECoEKQAEgQJAASBAmABEECIEGQAEgQJAASBAmABEECIEGQAEgQJAASBAmABEECIEGQAEgQJAASBAmABEECIEGQAEgQJAASBAmABEECIEGQAEgQJAASBAmABEECIEGQAEgQJAASUkF6+/7jPztfrgDc3HNHp2//7yB9+/7jpUKQAPa5545O3/5fBAngFREkQQJIECRBAkgQpAdZ1hMAB5u+/YIEwGb69gsSAJvp258MkjckgH28IQkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiANBun502cAbgRJkAASBEmQABIESZAAEgRJkAASBEmQABIESZAAEgRJkAASBEmQABIESZAAEgRJkAASBEmQABIESZAAEgRJkAASBEmQABIESZAAEgTpQZb1BMDBpm+/IAGwmb79ggTAZvr2J4PkDQlgH29Ig0E6X64A3AiSIAEkCJIgASQIkiABJAiSIAEkCJIgASQIkiABJAiSIAEkCJIgASQIkiABJAiSIAEkCJIgASQIkiABJAjSYJCm/7MuQIkgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiA9yLKeADjY9O0XJAA207dfkADYTN/+ZJC8IQHs4w1JkAASBEmQABIEaTBI58sVgBtBEiSABEESJIAEQRIkgARBEiSABEESJIAEQRIkgARBEiSABEESJIAEQRIkgARBEiSABEESJIAEQRIkgARBEiSABEESJIAEQRoM0vRvjwCUCJIgASQIkiABJAiSIAEkCJIgASQIkiABJAiSIAEkCJIgASQIkiABJAiSIAEkCJIgASQIkiABJAiSIAEkCNKDLOsJgINN335BAmAzffsFCYDN9O1PBskbEsA+3pAECSBBkAQJIEGQBAkgQZAECSBBkAQJIEGQBAkgQZAECSBBkAQJIEGQBAkgQZAECSBBkAQJIEGQBAkgQZAECSBBkAQJIEGQBAkgQZAECSBBkAQJIEGQBAkgQZAECSBBkAQJIEGQBAkgQZAECSBBkAQJIEGQBAkgQZAECSBBkAQJIEGQBAkgQZAECSBBkAaDdL5cAbgRJEECSBCkB1nWEwAHm779ggTAZvr2CxIAm+nbnwySNySAfbwhCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIA0G6d3XL3+494/4945du3bt/o+7giRIdu3atZvYFSRBsmvXrt3EriAJkl27du0mdgVJkOzatWs3sStIgmTXrl27iV1BEiS7du3aTewKkiDZtWvXbmJXkATJrl27dhO7giRIdu3atZvYFSRBsmvXrt3EriAJkl27du0mdgVJkOzatWs3sStIgmTXrl27iV1BEiS7du3aTewKkiDZtWvXbmJXkATJrl27dhO7giRIdu3atZvYFSRBsmvXrt3EriAJkl27du0mdgVJkOzatWs3sStIgmTXrl27iV1BEiS7du3aTewKkiDZtWvXbmJXkATJrl27dhO7gvQgy3oC4GDTt1+QANhM335BAmAzffuTQbrnu897v7sFeI28IQkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAkSQIIgCRJAgiAJEkCCIAHAToIEQIIgAZAgSAAkCBIACYIEQIIgAZAgSAAkCBIACYIEQIIgAZAgSAAkCBIACYIEQMJP2/WNeYcVhYAAAAAASUVORK5CYII='

const demoRoomImageDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAaQAAADwCAYAAABPJBBgAAAGVklEQVR4nO3VsQ0YRBBEUdfiEiiADkBUQinQAkXQChXQASJACMlEm9oXWJ7VzgtefsHs/Q8fv/v+EwCkfUg/AAA+ChIAWwgSACsIEgArCBIAKwgSACsIEgArCBIAKwgSACsIEgArCBIAKwgSACsIEgArCBIAKwgSACsIEgArCBIAKwgSACsIEgArCBIAKwgSACsIEgArCBIAKwgSACsIEgArCBIAKwgSACsIEgArCBIAKwgSACt8+Off/z4BQJogAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbDChz/+/OsTd6UHBvBKkI5LDwzglSAdlx4YwCtBOi49MIBXgnRcemAArwTpuPTAAF4J0nHpgQG8EqTj0gMDeCVIx33LMf3086/AYungCFI5QQJGOjiCVE6QgJEOjiCVEyRgpIMjSOUECRjp4AhSOUECRjo4glROkICRDo4glRMkYKSDI0jlBAkY6eAIUjlBAkY6OIJUTpCAkQ6OIJUTJGCkgyNI5QQJGOngCFI5QQJGOjiCVE6QgJEOjiCVEyRgpIMjSOUECRjp4AhSOUECRjo4glROkICRDo4glRMkYKSDI0jlBAkY6eAIUjlBAkY6OIJUTpCAkQ6OIJUTJGCkgyNI5QQJGOngCFI5QQJGOjiCVE6QgJEOjiCVEyRgpIMjSOUECRjp4AhSOUECRjo4glROkICRDo4glRMkYKSDI0jlBAkY6eAIUjlBAkY6OIJUrn0wABeCdJx6YEBvBKk49IDA3glSMelBwbwSpCOSw8M4JUgHZceGMArQTouPTCAV4J0XHpgAK8E6bj0wABeCdJx6YEBvBKk49IDA3glSMelBwbwSpCOSw8M4JUgHZceGMArQTouPTCAV4J0XHpgAK8E6bj0wABeCdJx6YEBvBKk49IDA3glSMd9yzH98NsvwGLp4AhSOUECRjo4glROkICRDo4glRMkYKSDI0jlBAkY6eAIUjlBAkY6OIJUTpCAkQ6OIJUTJGCkgyNI5QQJGOngCFI5QQJGOjiCVE6QgJEOjiCVEyRgpIMjSOUECRjp4AhSOUECRjo4glROkICRDo4glRMkYKSDI0jlBAkY6eAIUjlBAkY6OIJUTpCAkQ6OIJUTJGCkgyNI5QQJGOngCFI5QQJGOjiCVE6QgJEOjiCVEyRgpIMjSOUECRjp4AhSOUECRjo4glROkICRDo4glRMkYKSDI0jlBAkY6eAIUjlBAkY6OIJUTpCAkQ6OIJUTJGCkgyNI5QQJGOngCFK59MAAXgnScemBAbwSpOPSAwN4JUjHpQcG8EqQjksPDOCVIB2XHhjAK0E6Lj0wgFeCdFx6YACvBOm49MAAXgnScemBAbwSpOPSAwN4JUjHpQcG8EqQjksPDOCVIB2XHhjAK0E6Lj0wgFeCdFx6YACvBOm49MAAXgnScemBAbwSpOPSAwN4JUjHfcsx/fDbL8Bi6eAIUjlBAkY6OIJUTpCAkQ6OIJUTJGCkgyNI5QQJGOngCFI5QQJGOjiCVE6QgJEOjiCVEyRgpIMjSOUECRjp4AhSOUECRjo4glROkICRDo4glRMkYKSDI0jlBAkY6eAIUjlBAkY6OIJUTpCAkQ6OIJUTJGCkgyNI5QQJGOngCFI5QQJGOjiCVE6QgJEOjiCVEyRgpIMjSOUECRjp4AhSOUECRjo4glROkICRDo4glRMkYKSDI0jlBAkY6eAIUjlBAkY6OIJUTpCAkQ6OIJUTJGCkgyNI5QQJGOjhfDFL6AdyRPjbg89J/xJcIEl9N+tiAz0v/EV8iSHw16WMDPi/9R3yJIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsIIgAbCCIAGwgiABsML/zCz/u2tdqrYAAAAASUVORK5CYII='

const rooms = [
  { id: 'room_lab', labId: 'lab_home', name: 'Lab / server room', description: 'Primary rack room for compute, storage, switching, and edge services.', location: 'Basement / NW closet', notes: null },
  { id: 'room_lounge', labId: 'lab_home', name: 'Lounge', description: 'Downstairs living area with WiFi clients and media devices.', location: 'Ground floor', notes: null },
  { id: 'room_office', labId: 'lab_home', name: 'Office', description: 'Workspace devices, printer, build gear, and upstairs wireless coverage.', location: 'Upstairs office', notes: null },
  { id: 'room_studio', labId: 'lab_studio', name: 'Studio / workshop', description: 'Detached office and maker-space network area.', location: 'Garden studio', notes: null },
]

const racks = [
  { id: 'rack_net', labId: 'lab_home', roomId: 'room_lab', name: 'NET-01', totalU: 24, description: 'Network rack. Switching, firewall, controllers.', location: 'Wall-mount, eye-level', notes: null },
  { id: 'rack_cmp', labId: 'lab_home', roomId: 'room_lab', name: 'CMP-01', totalU: 42, description: 'Compute rack. Hypervisors, storage, GPU host.', location: 'Floor-standing', notes: null },
  { id: 'rack_studio', labId: 'lab_studio', roomId: 'room_studio', name: 'STU-01', totalU: 18, description: 'Detached office mini-rack. Edge, switching, and a compact hypervisor.', location: 'Wall rack by the workbench', notes: null },
]

const devices = [
  { id: 'd_pp24',      labId: 'lab_home', rackId: 'rack_net', hostname: 'pp-01',       displayName: 'Patch Panel A',       deviceType: 'patch_panel', manufacturer: 'TRENDnet',    model: 'TC-P24C6',           serial: 'TN-PP-2901',   managementIp: null,          status: 'online',      startU: 24, heightU: 1, face: 'front', tags: JSON.stringify(['cat6', 'unmanaged']),              notes: null, lastSeen: null },
  { id: 'd_sw_tor',    labId: 'lab_home', rackId: 'rack_net', hostname: 'sw-tor-01',   displayName: 'Top-of-Rack Switch',  deviceType: 'switch',      manufacturer: 'Ubiquiti',    model: 'USW-Pro-48-PoE',     serial: 'F8C0:7A10:21B4', managementIp: '10.0.10.2', status: 'online',      startU: 23, heightU: 1, face: 'front', tags: JSON.stringify(['poe', 'core']),                    notes: null, lastSeen: new Date(now - 30_000).toISOString() },
  { id: 'd_sw_agg',    labId: 'lab_home', rackId: 'rack_net', hostname: 'sw-agg-01',   displayName: 'Aggregation Switch',  deviceType: 'switch',      manufacturer: 'Ubiquiti',    model: 'USW-Pro-Aggregation', serial: 'F8C0:7A10:33A1', managementIp: '10.0.10.3', status: 'online',      startU: 22, heightU: 1, face: 'front', tags: JSON.stringify(['10g', 'core']),                    notes: null, lastSeen: new Date(now - 45_000).toISOString() },
  { id: 'd_fw',        labId: 'lab_home', rackId: 'rack_net', hostname: 'fw-01',        displayName: 'Edge Firewall',       deviceType: 'firewall',    manufacturer: 'Protectli',   model: 'VP4670',             serial: 'PT-VP-4711',   managementIp: '10.0.10.1', status: 'online',      startU: 21, heightU: 1, face: 'front', tags: JSON.stringify(['pfsense', 'edge']),                notes: null, lastSeen: new Date(now - 15_000).toISOString() },
  { id: 'd_unifi',     labId: 'lab_home', rackId: 'rack_net', hostname: 'unifi-01',     displayName: 'UniFi Cloud Key',     deviceType: 'server',      manufacturer: 'Ubiquiti',    model: 'UCK-G2-PLUS',        serial: null,           managementIp: '10.0.10.4', status: 'warning',     startU: 20, heightU: 1, face: 'front', tags: JSON.stringify(['controller']),                     notes: null, lastSeen: new Date(now - 600_000).toISOString() },
  { id: 'd_pdu_net',   labId: 'lab_home', rackId: 'rack_net', hostname: 'pdu-net-01',   displayName: 'Network PDU',         deviceType: 'pdu',         manufacturer: 'APC',         model: 'AP7900B',            serial: null,           managementIp: '10.0.10.250', status: 'online',    startU: 1,  heightU: 1, face: 'rear',  tags: JSON.stringify(['metered']),                        notes: null, lastSeen: null },
  { id: 'd_srv_pve1',  labId: 'lab_home', rackId: 'rack_cmp', hostname: 'pve-01',       displayName: 'Proxmox Node 1',      deviceType: 'server',      manufacturer: 'Supermicro',  model: 'SYS-5019D-FN8TP',   serial: 'SM-19D-A491',  managementIp: '10.0.10.11', status: 'online',     startU: 40, heightU: 1, face: 'front', tags: JSON.stringify(['hypervisor', 'xeon-d']),           notes: null, lastSeen: new Date(now - 20_000).toISOString() },
  { id: 'd_srv_pve2',  labId: 'lab_home', rackId: 'rack_cmp', hostname: 'pve-02',       displayName: 'Proxmox Node 2',      deviceType: 'server',      manufacturer: 'Supermicro',  model: 'SYS-5019D-FN8TP',   serial: 'SM-19D-A492',  managementIp: '10.0.10.12', status: 'online',     startU: 39, heightU: 1, face: 'front', tags: JSON.stringify(['hypervisor', 'xeon-d']),           notes: null, lastSeen: new Date(now - 25_000).toISOString() },
  { id: 'd_srv_pve3',  labId: 'lab_home', rackId: 'rack_cmp', hostname: 'pve-03',       displayName: 'Proxmox Node 3 (GPU)', deviceType: 'server',     manufacturer: 'Supermicro',  model: 'SYS-2029U-TN24R4T', serial: 'SM-29U-B112',  managementIp: '10.0.10.13', status: 'online',     startU: 36, heightU: 2, face: 'front', tags: JSON.stringify(['hypervisor', 'gpu', 'epyc']),      notes: null, lastSeen: new Date(now - 12_000).toISOString() },
  { id: 'd_srv_nas',   labId: 'lab_home', rackId: 'rack_cmp', hostname: 'truenas-01',   displayName: 'TrueNAS Storage',     deviceType: 'storage',     manufacturer: 'Custom',      model: '4U 24-Bay',          serial: null,           managementIp: '10.0.10.20', status: 'online',     startU: 30, heightU: 4, face: 'front', tags: JSON.stringify(['truenas', 'zfs', '24-bay']),       notes: null, lastSeen: new Date(now - 18_000).toISOString() },
  { id: 'd_srv_backup',labId: 'lab_home', rackId: 'rack_cmp', hostname: 'backup-01',    displayName: 'Backup Server',       deviceType: 'server',      manufacturer: 'HPE',         model: 'DL360 Gen10',        serial: null,           managementIp: '10.0.10.21', status: 'maintenance',startU: 28, heightU: 1, face: 'front', tags: JSON.stringify(['pbs']),                            notes: null, lastSeen: new Date(now - 86_400_000).toISOString() },
  { id: 'd_ups',       labId: 'lab_home', rackId: 'rack_cmp', hostname: 'ups-01',        displayName: 'Rack UPS',            deviceType: 'ups',         manufacturer: 'APC',         model: 'SMT2200RM2U',        serial: null,           managementIp: '10.0.10.251', status: 'online',    startU: 1,  heightU: 2, face: 'front', tags: JSON.stringify(['2200va']),                         notes: null, lastSeen: null },
  { id: 'd_pdu_cmp',   labId: 'lab_home', rackId: 'rack_cmp', hostname: 'pdu-cmp-01',   displayName: 'Compute PDU',         deviceType: 'pdu',         manufacturer: 'APC',         model: 'AP8941',             serial: null,           managementIp: '10.0.10.252', status: 'online',    startU: 42, heightU: 1, face: 'rear',  tags: JSON.stringify(['switched']),                       notes: null, lastSeen: null },
  { id: 'd_vm_gitea',  labId: 'lab_home', rackId: null,       hostname: 'gitea-01',     displayName: 'Gitea',               deviceType: 'vm',          manufacturer: 'Debian',      model: 'Bookworm VM',        serial: null,           managementIp: null,         status: 'online',      placement: 'virtual', parentDeviceId: 'd_srv_pve1', startU: null, heightU: null, face: null, tags: JSON.stringify(['git', 'dev']),                     notes: 'Hosted on pve-01', lastSeen: new Date(now - 90_000).toISOString(), cpuCores: 2,  memoryGb: 4,  storageGb: 120, specs: '2 vCPU | 4 GB RAM | 120 GB SSD' },
  { id: 'd_vm_ha',     labId: 'lab_home', rackId: null,       hostname: 'ha-01',        displayName: 'Home Assistant',      deviceType: 'vm',          manufacturer: 'Home Assistant', model: 'Appliance VM',    serial: null,           managementIp: null,         status: 'online',      placement: 'virtual', parentDeviceId: 'd_srv_pve1', startU: null, heightU: null, face: null, tags: JSON.stringify(['automation']),                    notes: 'Hosted on pve-01', lastSeen: new Date(now - 120_000).toISOString(), cpuCores: 4,  memoryGb: 8,  storageGb: 64,  specs: '4 vCPU | 8 GB RAM | 64 GB SSD' },
  { id: 'd_vm_plex',   labId: 'lab_home', rackId: null,       hostname: 'plex-01',      displayName: 'Plex',                deviceType: 'vm',          manufacturer: 'Ubuntu',      model: 'Media VM',           serial: null,           managementIp: null,         status: 'warning',     placement: 'virtual', parentDeviceId: 'd_srv_pve2', startU: null, heightU: null, face: null, tags: JSON.stringify(['media']),                         notes: 'Hosted on pve-02', lastSeen: new Date(now - 300_000).toISOString(), cpuCores: 8,  memoryGb: 16, storageGb: 250, specs: '8 vCPU | 16 GB RAM | 250 GB SSD' },
  { id: 'd_vm_next',   labId: 'lab_home', rackId: null,       hostname: 'nextcloud-01', displayName: 'Nextcloud',           deviceType: 'vm',          manufacturer: 'Ubuntu',      model: 'App VM',             serial: null,           managementIp: null,         status: 'online',      placement: 'virtual', parentDeviceId: 'd_srv_pve2', startU: null, heightU: null, face: null, tags: JSON.stringify(['files']),                         notes: 'Hosted on pve-02', lastSeen: new Date(now - 150_000).toISOString(), cpuCores: 4,  memoryGb: 8,  storageGb: 200, specs: '4 vCPU | 8 GB RAM | 200 GB SSD' },
  { id: 'd_vm_ollama', labId: 'lab_home', rackId: null,       hostname: 'ollama-01',    displayName: 'Ollama',              deviceType: 'vm',          manufacturer: 'Ubuntu',      model: 'GPU VM',             serial: null,           managementIp: null,         status: 'online',      placement: 'virtual', parentDeviceId: 'd_srv_pve3', startU: null, heightU: null, face: null, tags: JSON.stringify(['ai', 'gpu']),                     notes: 'Hosted on pve-03', lastSeen: new Date(now - 45_000).toISOString(), cpuCores: 16, memoryGb: 48, storageGb: 600, specs: '16 vCPU | 48 GB RAM | 600 GB SSD' },
  { id: 'd_ap_lounge', labId: 'lab_home', roomId: 'room_lounge', rackId: null,       hostname: 'ap-lounge-01', displayName: 'Lounge AP',           deviceType: 'ap',          manufacturer: 'Ubiquiti',    model: 'U6-Pro',             serial: 'UB-AP-6001',  managementIp: '10.0.10.30', status: 'online',      placement: 'wireless', parentDeviceId: null, startU: null, heightU: null, face: null, tags: JSON.stringify(['wifi', 'downstairs']),            notes: 'Ceiling-mounted in the lounge.', lastSeen: new Date(now - 10_000).toISOString() },
  { id: 'd_ap_office', labId: 'lab_home', roomId: 'room_office', rackId: null,       hostname: 'ap-office-01', displayName: 'Office AP',           deviceType: 'ap',          manufacturer: 'Ubiquiti',    model: 'U6-Lite',            serial: 'UB-AP-6002',  managementIp: '10.0.10.31', status: 'online',      placement: 'wireless', parentDeviceId: null, startU: null, heightU: null, face: null, tags: JSON.stringify(['wifi', 'upstairs']),              notes: 'Wall-mounted near the office desk.', lastSeen: new Date(now - 20_000).toISOString() },
  { id: 'd_wifi_phone',  labId: 'lab_home', roomId: 'room_lounge', rackId: null,     hostname: 'pixel-9-pro',  displayName: 'Kobus Phone',         deviceType: 'endpoint',    manufacturer: 'Google',      model: 'Pixel 9 Pro',        serial: null,           managementIp: '10.0.10.60', status: 'online',      placement: 'wireless', parentDeviceId: 'd_ap_lounge', startU: null, heightU: null, face: null, tags: JSON.stringify(['wifi', 'phone']),                 notes: 'Primary personal handset.', lastSeen: new Date(now - 15_000).toISOString() },
  { id: 'd_wifi_laptop', labId: 'lab_home', roomId: 'room_office', rackId: null,     hostname: 'x1-carbon',    displayName: 'Work Laptop',         deviceType: 'endpoint',    manufacturer: 'Lenovo',      model: 'ThinkPad X1 Carbon', serial: null,           managementIp: '10.0.10.61', status: 'online',      placement: 'wireless', parentDeviceId: 'd_ap_office', startU: null, heightU: null, face: null, tags: JSON.stringify(['wifi', 'laptop']),               notes: 'Normally docks in the office.', lastSeen: new Date(now - 40_000).toISOString() },
  { id: 'd_wifi_tv',     labId: 'lab_home', roomId: 'room_lounge', rackId: null,     hostname: 'lounge-tv',    displayName: 'Lounge TV',           deviceType: 'endpoint',    manufacturer: 'Samsung',     model: 'QN90',               serial: null,           managementIp: '10.0.50.120', status: 'online',     placement: 'wireless', parentDeviceId: 'd_ap_lounge', startU: null, heightU: null, face: null, tags: JSON.stringify(['wifi', 'media']),                notes: 'Streaming TV in the lounge.', lastSeen: new Date(now - 90_000).toISOString() },
  { id: 'd_wifi_doorbell', labId: 'lab_home', roomId: 'room_lounge', rackId: null,   hostname: 'doorbell-01',  displayName: 'Front Door Bell',     deviceType: 'endpoint',    manufacturer: 'Reolink',     model: 'Doorbell WiFi',      serial: null,           managementIp: '10.0.20.13', status: 'warning',     placement: 'wireless', parentDeviceId: 'd_ap_lounge', startU: null, heightU: null, face: null, tags: JSON.stringify(['wifi', 'iot', 'camera']),        notes: 'Occasionally roams poorly at night.', lastSeen: new Date(now - 600_000).toISOString() },
  { id: 'd_room_macmini',  labId: 'lab_home', roomId: 'room_office', rackId: null,   hostname: 'build-mini-01', displayName: 'Build Mini',         deviceType: 'server',      manufacturer: 'Apple',       model: 'Mac mini M2 Pro',    serial: null,           managementIp: '10.0.10.81', status: 'online',      placement: 'room', parentDeviceId: null, startU: null, heightU: null, face: null, tags: JSON.stringify(['desktop', 'ci']),              notes: 'Loose room tech used for CI, test builds, and ad-hoc virtualization.', lastSeen: new Date(now - 22_000).toISOString(), cpuCores: 10, memoryGb: 32, storageGb: 1000, specs: '10 CPU cores | 32 GB unified memory | 1 TB SSD' },
  { id: 'd_room_printer',  labId: 'lab_home', roomId: 'room_office', rackId: null,   hostname: 'printer-01',   displayName: 'Brother Laser',      deviceType: 'endpoint',    manufacturer: 'Brother',     model: 'HL-L3270CDW',        serial: null,           managementIp: '10.0.10.82', status: 'online',      placement: 'room', parentDeviceId: null, startU: null, heightU: null, face: null, tags: JSON.stringify(['printer', 'office']),         notes: 'Shared office printer in the upstairs study.', lastSeen: new Date(now - 180_000).toISOString() },
  { id: 'd_room_pi',       labId: 'lab_home', roomId: 'room_office', rackId: null,   hostname: 'pi-dashboard', displayName: 'Wall Dashboard Pi',  deviceType: 'endpoint',    manufacturer: 'Raspberry Pi', model: 'Pi 4 8GB',        serial: null,           managementIp: '10.0.20.40', status: 'online',      placement: 'room', parentDeviceId: null, startU: null, heightU: null, face: null, tags: JSON.stringify(['raspberry-pi', 'iot']),     notes: 'Room-mounted touchscreen and printer relay helper.', lastSeen: new Date(now - 55_000).toISOString() },
  { id: 'd_studio_fw',     labId: 'lab_studio', rackId: 'rack_studio', hostname: 'studio-fw-01', displayName: 'Studio Firewall',  deviceType: 'firewall', manufacturer: 'Protectli', model: 'VP2420', serial: 'PT-ST-2420', managementIp: '10.42.10.1', status: 'online', startU: 18, heightU: 1, face: 'front', tags: JSON.stringify(['opnsense', 'edge']), notes: 'Detached office perimeter firewall.', lastSeen: new Date(now - 35_000).toISOString() },
  { id: 'd_studio_sw',     labId: 'lab_studio', rackId: 'rack_studio', hostname: 'studio-sw-01', displayName: 'Studio Switch',   deviceType: 'switch', manufacturer: 'MikroTik', model: 'CRS326-24G-2S+', serial: 'MT-326-2401', managementIp: '10.42.10.2', status: 'online', startU: 17, heightU: 1, face: 'front', tags: JSON.stringify(['studio', 'core']), notes: 'Small office access switch.', lastSeen: new Date(now - 28_000).toISOString() },
  { id: 'd_studio_host',   labId: 'lab_studio', rackId: 'rack_studio', hostname: 'studio-pve-01', displayName: 'Studio Hypervisor', deviceType: 'server', manufacturer: 'Intel NUC', model: 'NUC 13 Pro', serial: 'NUC13-ST-01', managementIp: '10.42.10.10', status: 'online', startU: 15, heightU: 1, face: 'front', tags: JSON.stringify(['hypervisor', 'compact']), notes: 'Runs workshop tooling and utility VMs.', lastSeen: new Date(now - 18_000).toISOString(), cpuCores: 14, memoryGb: 64, storageGb: 2000, specs: '14 cores | 64 GB RAM | 2 TB NVMe' },
  { id: 'd_studio_vm_git', labId: 'lab_studio', rackId: null, hostname: 'studio-ci-01', displayName: 'Studio CI Runner', deviceType: 'vm', manufacturer: 'Ubuntu', model: 'Utility VM', serial: null, managementIp: null, status: 'online', placement: 'virtual', parentDeviceId: 'd_studio_host', startU: null, heightU: null, face: null, tags: JSON.stringify(['ci', 'runner']), notes: 'Lightweight build agent for the detached office lab.', lastSeen: new Date(now - 85_000).toISOString(), cpuCores: 4, memoryGb: 8, storageGb: 120, specs: '4 vCPU | 8 GB RAM | 120 GB SSD' },
  { id: 'd_studio_ap',     labId: 'lab_studio', roomId: 'room_studio', rackId: null, hostname: 'studio-ap-01', displayName: 'Studio AP',       deviceType: 'ap', manufacturer: 'Ubiquiti', model: 'U6-Mesh', serial: 'UB-ST-AP01', managementIp: '10.42.10.30', status: 'online', placement: 'wireless', parentDeviceId: null, startU: null, heightU: null, face: null, tags: JSON.stringify(['wifi', 'studio']), notes: 'Covers the detached office and patio.', lastSeen: new Date(now - 12_000).toISOString() },
  { id: 'd_studio_tablet', labId: 'lab_studio', roomId: 'room_studio', rackId: null, hostname: 'studio-ipad', displayName: 'Studio Tablet',   deviceType: 'endpoint', manufacturer: 'Apple', model: 'iPad Air', serial: null, managementIp: '10.42.10.60', status: 'online', placement: 'wireless', parentDeviceId: 'd_studio_ap', startU: null, heightU: null, face: null, tags: JSON.stringify(['wifi', 'tablet']), notes: 'Used for dashboards and media controls in the studio.', lastSeen: new Date(now - 30_000).toISOString() },
  { id: 'd_studio_printer', labId: 'lab_studio', roomId: 'room_studio', rackId: null, hostname: 'maker-printer', displayName: 'Label Printer', deviceType: 'endpoint', manufacturer: 'Brother', model: 'QL-820NWB', serial: null, managementIp: '10.42.20.25', status: 'online', placement: 'room', parentDeviceId: null, startU: null, heightU: null, face: null, tags: JSON.stringify(['printer', 'maker']), notes: 'Bench-side label printer for cabling and storage bins.', lastSeen: new Date(now - 600_000).toISOString() },
]

const demoMacAddressByDeviceId: Record<string, string> = {
  d_sw_tor: 'f8:c0:7a:10:21:b4',
  d_sw_agg: 'f8:c0:7a:10:33:a1',
  d_fw: '00:0d:b9:47:11:01',
  d_unifi: 'f4:92:bf:10:10:04',
  d_pdu_net: '00:c0:b7:10:02:50',
  d_srv_pve1: 'ac:1f:6b:10:10:11',
  d_srv_pve2: 'ac:1f:6b:10:10:12',
  d_srv_pve3: 'ac:1f:6b:10:10:13',
  d_srv_nas: 'd0:50:99:10:10:20',
  d_srv_backup: '9c:dc:71:10:10:21',
  d_ups: '28:29:86:10:02:51',
  d_pdu_cmp: '00:c0:b7:10:02:52',
  d_ap_lounge: '74:ac:b9:60:01:30',
  d_ap_office: '74:ac:b9:60:01:31',
  d_wifi_phone: '6c:ae:8b:10:10:60',
  d_wifi_laptop: '48:2a:e3:10:10:61',
  d_wifi_tv: '90:9a:4a:50:01:20',
  d_wifi_doorbell: 'd8:3a:dd:20:00:13',
  d_room_macmini: 'f0:18:98:44:55:66',
  d_room_printer: '3c:22:fb:11:22:33',
  d_room_pi: 'b8:27:eb:20:00:40',
  d_studio_fw: '00:0d:b9:42:10:01',
  d_studio_sw: '48:a9:8a:42:10:02',
  d_studio_host: '1c:69:7a:42:10:10',
  d_studio_ap: '74:ac:b9:42:10:30',
  d_studio_tablet: 'a4:d1:8c:42:10:60',
  d_studio_printer: '3c:22:fb:42:20:25',
}

const deviceCapacityById: Record<string, { cpuCores?: number; memoryGb?: number; storageGb?: number; specs?: string }> = {
  d_srv_pve1: { cpuCores: 8, memoryGb: 64, storageGb: 2000, specs: 'Xeon-D host | 8 cores | 64 GB RAM | 2 TB NVMe' },
  d_srv_pve2: { cpuCores: 8, memoryGb: 64, storageGb: 2000, specs: 'Xeon-D host | 8 cores | 64 GB RAM | 2 TB NVMe' },
  d_srv_pve3: { cpuCores: 32, memoryGb: 128, storageGb: 8000, specs: 'EPYC host | 32 cores | 128 GB RAM | 8 TB mixed SSD' },
  d_srv_backup: { cpuCores: 16, memoryGb: 64, storageGb: 12000, specs: 'Backup node | 16 cores | 64 GB RAM | 12 TB usable' },
  d_srv_nas: { cpuCores: 12, memoryGb: 128, storageGb: 96000, specs: '24-bay TrueNAS | 12 cores | 128 GB ECC | 96 TB raw' },
}

// Helper to generate ports compactly
function makePorts(
  deviceId: string,
  prefix: string,
  count: number,
  kind: string,
  speed: string,
  linkedPositions: number[],
  nameOverrides?: (pos: number) => string,
  vlanId?: string
) {
  const rows = []
  for (let i = 0; i < count; i++) {
    const pos = i + 1
    const name = nameOverrides ? nameOverrides(pos) : `${prefix}${pos}`
    rows.push({
      id: `p_${deviceId}_${pos}`,
      deviceId,
      name,
      position: pos,
      kind,
      speed,
      linkState: linkedPositions.includes(pos) ? 'up' : 'down',
      mode: 'access',
      vlanId: vlanId ?? null,
      allowedVlanIds: null,
      description: null,
      face: 'front',
    })
  }
  return rows
}

const ports = [
  // Patch panel — 24 cat6 ports (positions 49+ don't exist on a 24-port panel so just offset SFP by 48+1)
  ...makePorts('d_pp24', '', 24, 'rj45', '1G', [1, 2, 3, 4, 5, 8, 9, 12, 17, 22]),

  // ToR switch: 48 PoE RJ45 + 4 SFP+
  ...makePorts('d_sw_tor', '', 48, 'rj45', '1G', [1, 2, 3, 4, 5, 8, 9, 12, 17, 22, 23, 24, 25, 31, 33, 47, 48]),
  ...makePorts('d_sw_tor', 'SFP+', 4, 'sfp_plus', '10G', [1, 2], (pos) => `SFP+${pos}`).map((p, i) => ({ ...p, id: `p_d_sw_tor_${48 + i + 1}`, position: 48 + i + 1 })),

  // Aggregation switch: 28 SFP+
  ...makePorts('d_sw_agg', 'SFP+', 28, 'sfp_plus', '10G', [1, 2, 3, 4, 5, 6, 7, 8], (pos) => `SFP+${pos}`),

  // Firewall: 6 RJ45
  ...makePorts('d_fw', 'igb', 6, 'rj45', '1G', [1, 2, 3], (pos) => `igb${pos - 1}`),

  // Unifi: 1 RJ45
  ...makePorts('d_unifi', 'eth', 1, 'rj45', '1G', [1], () => 'eth0'),

  // PVE-01: 4 RJ45 + 2 SFP+
  ...makePorts('d_srv_pve1', 'eno', 4, 'rj45', '1G', [1, 2], (pos) => `eno${pos}`),
  ...makePorts('d_srv_pve1', 'enp', 2, 'sfp_plus', '10G', [1, 2], (pos) => `enp1s0f${pos - 1}`).map((p, i) => ({ ...p, id: `p_d_srv_pve1_${4 + i + 1}`, position: 4 + i + 1 })),

  // PVE-02: same as PVE-01
  ...makePorts('d_srv_pve2', 'eno', 4, 'rj45', '1G', [1, 2], (pos) => `eno${pos}`),
  ...makePorts('d_srv_pve2', 'enp', 2, 'sfp_plus', '10G', [1, 2], (pos) => `enp1s0f${pos - 1}`).map((p, i) => ({ ...p, id: `p_d_srv_pve2_${4 + i + 1}`, position: 4 + i + 1 })),

  // PVE-03: 2 RJ45 + 4 SFP+
  ...makePorts('d_srv_pve3', 'eno', 2, 'rj45', '1G', [1], (pos) => `eno${pos}`),
  ...makePorts('d_srv_pve3', 'enp', 4, 'sfp_plus', '10G', [1, 2, 3, 4], (pos) => `enp4s0f${pos - 1}`).map((p, i) => ({ ...p, id: `p_d_srv_pve3_${2 + i + 1}`, position: 2 + i + 1 })),

  // TrueNAS: 2 RJ45 + 2 SFP+
  ...makePorts('d_srv_nas', 'igb', 2, 'rj45', '1G', [1], (pos) => `igb${pos - 1}`),
  ...makePorts('d_srv_nas', 'ix', 2, 'sfp_plus', '10G', [1, 2], (pos) => `ix${pos - 1}`).map((p, i) => ({ ...p, id: `p_d_srv_nas_${2 + i + 1}`, position: 2 + i + 1 })),

  // Backup: 4 RJ45 (all down — forced offline)
  ...makePorts('d_srv_backup', 'eno', 4, 'rj45', '1G', [], (pos) => `eno${pos}`),

  ...makePorts('d_room_macmini', 'en', 1, 'rj45', '1G', [1], () => 'en0'),
  ...makePorts('d_room_printer', 'lan', 1, 'rj45', '1G', [1], () => 'lan0'),
  ...makePorts('d_room_pi', 'eth', 1, 'rj45', '1G', [1], () => 'eth0'),

  ...makePorts('d_studio_fw', 'igb', 6, 'rj45', '1G', [1, 2], (pos) => `igb${pos - 1}`),
  ...makePorts('d_studio_sw', '', 24, 'rj45', '1G', [5, 8, 9, 23, 24]),
  ...makePorts('d_studio_sw', 'SFP+', 2, 'sfp_plus', '10G', [], (pos) => `SFP+${pos}`).map((p, i) => ({ ...p, id: `p_d_studio_sw_${24 + i + 1}`, position: 24 + i + 1 })),
  ...makePorts('d_studio_host', 'eno', 2, 'rj45', '1G', [1], (pos) => `eno${pos}`),
  ...makePorts('d_studio_host', 'enp', 2, 'sfp_plus', '10G', [], (pos) => `enp1s0f${pos - 1}`).map((p, i) => ({ ...p, id: `p_d_studio_host_${2 + i + 1}`, position: 2 + i + 1 })),
  ...makePorts('d_studio_ap', 'eth', 1, 'rj45', '1G', [1], () => 'eth0'),
  ...makePorts('d_studio_printer', 'lan', 1, 'rj45', '1G', [1], () => 'lan0'),
]

const portLinks = [
  { id: 'l_1',  fromPortId: 'p_d_pp24_1',       toPortId: 'p_d_sw_tor_1',  cableType: 'Cat6',     cableLength: '0.5m', color: 'blue',   notes: null },
  { id: 'l_2',  fromPortId: 'p_d_pp24_2',       toPortId: 'p_d_sw_tor_2',  cableType: 'Cat6',     cableLength: '0.5m', color: 'blue',   notes: null },
  { id: 'l_3',  fromPortId: 'p_d_pp24_3',       toPortId: 'p_d_sw_tor_3',  cableType: 'Cat6',     cableLength: '0.5m', color: 'blue',   notes: null },
  { id: 'l_4',  fromPortId: 'p_d_pp24_4',       toPortId: 'p_d_sw_tor_4',  cableType: 'Cat6',     cableLength: '0.5m', color: 'blue',   notes: null },
  { id: 'l_5',  fromPortId: 'p_d_pp24_5',       toPortId: 'p_d_sw_tor_5',  cableType: 'Cat6',     cableLength: '0.5m', color: 'blue',   notes: null },
  { id: 'l_6',  fromPortId: 'p_d_sw_tor_49',    toPortId: 'p_d_sw_agg_1',  cableType: 'DAC',      cableLength: '1m',   color: 'black',  notes: null },
  { id: 'l_7',  fromPortId: 'p_d_sw_tor_50',    toPortId: 'p_d_sw_agg_2',  cableType: 'DAC',      cableLength: '1m',   color: 'black',  notes: null },
  { id: 'l_8',  fromPortId: 'p_d_fw_1',         toPortId: 'p_d_sw_tor_47', cableType: 'Cat6',     cableLength: '1m',   color: 'red',    notes: null },
  { id: 'l_9',  fromPortId: 'p_d_fw_2',         toPortId: 'p_d_sw_tor_48', cableType: 'Cat6',     cableLength: '1m',   color: 'green',  notes: null },
  { id: 'l_10', fromPortId: 'p_d_unifi_1',      toPortId: 'p_d_sw_tor_24', cableType: 'Cat6',     cableLength: '0.5m', color: 'yellow', notes: null },
  { id: 'l_11', fromPortId: 'p_d_srv_pve1_5',   toPortId: 'p_d_sw_agg_3',  cableType: 'DAC',      cableLength: '3m',   color: 'black',  notes: null },
  { id: 'l_12', fromPortId: 'p_d_srv_pve1_6',   toPortId: 'p_d_sw_agg_4',  cableType: 'DAC',      cableLength: '3m',   color: 'black',  notes: null },
  { id: 'l_13', fromPortId: 'p_d_srv_pve2_5',   toPortId: 'p_d_sw_agg_5',  cableType: 'DAC',      cableLength: '3m',   color: 'black',  notes: null },
  { id: 'l_14', fromPortId: 'p_d_srv_pve2_6',   toPortId: 'p_d_sw_agg_6',  cableType: 'DAC',      cableLength: '3m',   color: 'black',  notes: null },
  { id: 'l_15', fromPortId: 'p_d_srv_pve3_3',   toPortId: 'p_d_sw_agg_7',  cableType: 'DAC',      cableLength: '3m',   color: 'black',  notes: null },
  { id: 'l_16', fromPortId: 'p_d_srv_pve3_4',   toPortId: 'p_d_sw_agg_8',  cableType: 'DAC',      cableLength: '3m',   color: 'black',  notes: null },
  { id: 'l_17', fromPortId: 'p_d_srv_nas_3',    toPortId: 'p_d_sw_tor_31', cableType: 'OM4 LC-LC', cableLength: '3m',  color: 'aqua',   notes: null },
  { id: 'l_18', fromPortId: 'p_d_srv_nas_4',    toPortId: 'p_d_sw_tor_33', cableType: 'OM4 LC-LC', cableLength: '3m',  color: 'aqua',   notes: null },
  { id: 'l_19', fromPortId: 'p_d_srv_pve1_1',   toPortId: 'p_d_sw_tor_25', cableType: 'Cat6',     cableLength: '3m',   color: 'gray',   notes: null },
  { id: 'l_20', fromPortId: 'p_d_srv_pve2_1',   toPortId: 'p_d_sw_tor_8',  cableType: 'Cat6',     cableLength: '3m',   color: 'gray',   notes: null },
  { id: 'l_21', fromPortId: 'p_d_room_macmini_1', toPortId: 'p_d_sw_tor_17', cableType: 'Cat6',   cableLength: '12m',  color: 'white',  notes: 'Office build node uplink' },
  { id: 'l_22', fromPortId: 'p_d_room_printer_1', toPortId: 'p_d_sw_tor_22', cableType: 'Cat6',   cableLength: '15m',  color: 'green',  notes: 'Upstairs printer drop' },
  { id: 'l_23', fromPortId: 'p_d_room_pi_1',     toPortId: 'p_d_sw_tor_12', cableType: 'Cat6',    cableLength: '8m',   color: 'orange', notes: 'Wall dashboard and relay' },
  { id: 'l_24', fromPortId: 'p_d_studio_fw_1',   toPortId: 'p_d_studio_sw_23', cableType: 'Cat6', cableLength: '0.5m', color: 'red',    notes: 'Studio LAN handoff' },
  { id: 'l_25', fromPortId: 'p_d_studio_fw_2',   toPortId: 'p_d_studio_sw_24', cableType: 'Cat6', cableLength: '0.5m', color: 'green',  notes: 'Studio uplink / secondary VLAN trunk' },
  { id: 'l_26', fromPortId: 'p_d_studio_host_1', toPortId: 'p_d_studio_sw_5', cableType: 'Cat6',  cableLength: '1m',   color: 'gray',   notes: 'Studio hypervisor management' },
  { id: 'l_27', fromPortId: 'p_d_studio_ap_1',   toPortId: 'p_d_studio_sw_8', cableType: 'Cat6',  cableLength: '10m',  color: 'blue',   notes: 'Ceiling AP run' },
  { id: 'l_28', fromPortId: 'p_d_studio_printer_1', toPortId: 'p_d_studio_sw_9', cableType: 'Cat6', cableLength: '4m', color: 'yellow', notes: 'Maker-space label printer' },
]

const vlans = [
  { id: 'v_default', labId: 'lab_home', vlanId: 10, name: 'Default',  description: 'Mgmt + servers',           color: '#6a9bd4' },
  { id: 'v_iot',     labId: 'lab_home', vlanId: 20, name: 'IoT',      description: 'Smart home, cameras',      color: '#6abf69' },
  { id: 'v_dmz',     labId: 'lab_home', vlanId: 30, name: 'DMZ',      description: 'Public-facing services',   color: '#d46060' },
  { id: 'v_storage', labId: 'lab_home', vlanId: 40, name: 'Storage',  description: 'iSCSI, NFS, replication',  color: '#b574d4' },
  { id: 'v_guest',   labId: 'lab_home', vlanId: 50, name: 'Guest',    description: 'Guest WiFi',               color: '#d4a13c' },
  { id: 'v_studio_default', labId: 'lab_studio', vlanId: 10, name: 'Studio Default', description: 'Trusted office clients and infrastructure', color: '#7dd3fc' },
  { id: 'v_studio_iot',     labId: 'lab_studio', vlanId: 20, name: 'Studio IoT',     description: 'Makerspace gear, printers, and helpers', color: '#f59e0b' },
]

const vlanRanges = [
  { id: 'vr_mgmt',    labId: 'lab_home', name: 'Management', startVlan: 1,   endVlan: 19,  purpose: 'Core infrastructure and management', color: '#6a9bd4' },
  { id: 'vr_iot',     labId: 'lab_home', name: 'IoT',        startVlan: 20,  endVlan: 29,  purpose: 'Smart home and IoT devices',         color: '#6abf69' },
  { id: 'vr_dmz',     labId: 'lab_home', name: 'DMZ',        startVlan: 30,  endVlan: 39,  purpose: 'Public-facing services',             color: '#d46060' },
  { id: 'vr_storage', labId: 'lab_home', name: 'Storage',    startVlan: 40,  endVlan: 49,  purpose: 'Storage traffic',                    color: '#b574d4' },
  { id: 'vr_user',    labId: 'lab_home', name: 'User',       startVlan: 50,  endVlan: 99,  purpose: 'Guest and user VLANs',               color: '#d4a13c' },
  { id: 'vr_studio_core', labId: 'lab_studio', name: 'Studio Core', startVlan: 1, endVlan: 29, purpose: 'Studio office networks and edge services', color: '#7dd3fc' },
]

const subnets = [
  { id: 's_default', labId: 'lab_home', cidr: '10.0.10.0/24', name: 'Default / Mgmt', description: null, vlanId: 'v_default' },
  { id: 's_iot',     labId: 'lab_home', cidr: '10.0.20.0/24', name: 'IoT',            description: null, vlanId: 'v_iot' },
  { id: 's_dmz',     labId: 'lab_home', cidr: '10.0.30.0/24', name: 'DMZ',            description: null, vlanId: 'v_dmz' },
  { id: 's_storage', labId: 'lab_home', cidr: '10.0.40.0/24', name: 'Storage',        description: null, vlanId: 'v_storage' },
  { id: 's_guest',   labId: 'lab_home', cidr: '10.0.50.0/24', name: 'Guest',          description: null, vlanId: 'v_guest' },
  { id: 's_studio_default', labId: 'lab_studio', cidr: '10.42.10.0/24', name: 'Studio Default', description: 'Studio office management and trusted clients', vlanId: 'v_studio_default' },
  { id: 's_studio_iot',     labId: 'lab_studio', cidr: '10.42.20.0/24', name: 'Studio IoT',     description: 'Studio bench gear and label printers',     vlanId: 'v_studio_iot' },
]

const dhcpScopes = [
  { id: 'sc_default', subnetId: 's_default', name: 'default-pool', startIp: '10.0.10.100', endIp: '10.0.10.199', gateway: '10.0.10.1',  dnsServers: JSON.stringify(['10.0.10.1', '1.1.1.1']), description: null },
  { id: 'sc_iot',     subnetId: 's_iot',     name: 'iot-pool',     startIp: '10.0.20.100', endIp: '10.0.20.250', gateway: '10.0.20.1',  dnsServers: null, description: null },
  { id: 'sc_dmz',     subnetId: 's_dmz',     name: 'dmz-pool',     startIp: '10.0.30.100', endIp: '10.0.30.150', gateway: '10.0.30.1',  dnsServers: null, description: null },
  { id: 'sc_studio_default', subnetId: 's_studio_default', name: 'studio-default-pool', startIp: '10.42.10.100', endIp: '10.42.10.180', gateway: '10.42.10.1', dnsServers: JSON.stringify(['10.42.10.1', '1.1.1.1']), description: 'Studio office DHCP scope' },
  { id: 'sc_studio_iot', subnetId: 's_studio_iot', name: 'studio-iot-pool', startIp: '10.42.20.100', endIp: '10.42.20.200', gateway: '10.42.20.1', dnsServers: null, description: 'Studio makerspace helpers' },
]

const ipZones = [
  { id: 'iz_default_infra',   subnetId: 's_default', kind: 'infrastructure', startIp: '10.0.10.1',   endIp: '10.0.10.9',   description: 'Gateways and core infra' },
  { id: 'iz_default_static',  subnetId: 's_default', kind: 'static',         startIp: '10.0.10.10',  endIp: '10.0.10.99',  description: 'Static assignments' },
  { id: 'iz_default_dhcp',    subnetId: 's_default', kind: 'dhcp',           startIp: '10.0.10.100', endIp: '10.0.10.199', description: 'DHCP pool' },
  { id: 'iz_default_reserved',subnetId: 's_default', kind: 'reserved',       startIp: '10.0.10.200', endIp: '10.0.10.254', description: 'Reserved' },
  { id: 'iz_studio_default_static', subnetId: 's_studio_default', kind: 'static', startIp: '10.42.10.1', endIp: '10.42.10.80', description: 'Studio static infrastructure and APs' },
  { id: 'iz_studio_default_dhcp', subnetId: 's_studio_default', kind: 'dhcp', startIp: '10.42.10.100', endIp: '10.42.10.180', description: 'Studio trusted DHCP clients' },
  { id: 'iz_studio_iot_static', subnetId: 's_studio_iot', kind: 'static', startIp: '10.42.20.1', endIp: '10.42.20.80', description: 'Studio label printers and bench helpers' },
]

const ipAssignments = [
  { id: 'ip_1',  subnetId: 's_default', ipAddress: '10.0.10.1',  assignmentType: 'device',    deviceId: 'd_fw',        portId: null, vmId: null, containerId: null, hostname: 'fw-01',          description: 'Edge firewall LAN' },
  { id: 'ip_2',  subnetId: 's_default', ipAddress: '10.0.10.2',  assignmentType: 'device',    deviceId: 'd_sw_tor',    portId: null, vmId: null, containerId: null, hostname: 'sw-tor-01',      description: null },
  { id: 'ip_3',  subnetId: 's_default', ipAddress: '10.0.10.3',  assignmentType: 'device',    deviceId: 'd_sw_agg',    portId: null, vmId: null, containerId: null, hostname: 'sw-agg-01',      description: null },
  { id: 'ip_4',  subnetId: 's_default', ipAddress: '10.0.10.4',  assignmentType: 'device',    deviceId: 'd_unifi',     portId: null, vmId: null, containerId: null, hostname: 'unifi-01',       description: null },
  { id: 'ip_5',  subnetId: 's_default', ipAddress: '10.0.10.11', assignmentType: 'device',    deviceId: 'd_srv_pve1',  portId: null, vmId: null, containerId: null, hostname: 'pve-01',         description: null },
  { id: 'ip_6',  subnetId: 's_default', ipAddress: '10.0.10.12', assignmentType: 'device',    deviceId: 'd_srv_pve2',  portId: null, vmId: null, containerId: null, hostname: 'pve-02',         description: null },
  { id: 'ip_7',  subnetId: 's_default', ipAddress: '10.0.10.13', assignmentType: 'device',    deviceId: 'd_srv_pve3',  portId: null, vmId: null, containerId: null, hostname: 'pve-03',         description: null },
  { id: 'ip_8',  subnetId: 's_default', ipAddress: '10.0.10.20', assignmentType: 'device',    deviceId: 'd_srv_nas',   portId: null, vmId: null, containerId: null, hostname: 'truenas-01',     description: null },
  { id: 'ip_9',  subnetId: 's_default', ipAddress: '10.0.10.21', assignmentType: 'device',    deviceId: 'd_srv_backup',portId: null, vmId: null, containerId: null, hostname: 'backup-01',      description: null },
  { id: 'ip_10', subnetId: 's_default', ipAddress: '10.0.10.250',assignmentType: 'device',    deviceId: 'd_pdu_net',   portId: null, vmId: null, containerId: null, hostname: 'pdu-net-01',     description: null },
  { id: 'ip_11', subnetId: 's_default', ipAddress: '10.0.10.251',assignmentType: 'device',    deviceId: 'd_ups',       portId: null, vmId: null, containerId: null, hostname: 'ups-01',         description: null },
  { id: 'ip_12', subnetId: 's_default', ipAddress: '10.0.10.252',assignmentType: 'device',    deviceId: 'd_pdu_cmp',   portId: null, vmId: null, containerId: null, hostname: 'pdu-cmp-01',     description: null },
  { id: 'ip_v1', subnetId: 's_default', ipAddress: '10.0.10.50', assignmentType: 'vm',        deviceId: null,          portId: null, vmId: 'vm_1', containerId: null, hostname: 'gitea',        description: 'Gitea on pve-01' },
  { id: 'ip_v2', subnetId: 's_default', ipAddress: '10.0.10.51', assignmentType: 'vm',        deviceId: null,          portId: null, vmId: 'vm_2', containerId: null, hostname: 'home-assistant',description: 'HA on pve-01' },
  { id: 'ip_v3', subnetId: 's_default', ipAddress: '10.0.10.52', assignmentType: 'vm',        deviceId: null,          portId: null, vmId: 'vm_3', containerId: null, hostname: 'plex',         description: 'Plex on pve-02' },
  { id: 'ip_v4', subnetId: 's_default', ipAddress: '10.0.10.53', assignmentType: 'vm',        deviceId: null,          portId: null, vmId: 'vm_4', containerId: null, hostname: 'nextcloud',    description: 'Nextcloud on pve-02' },
  { id: 'ip_v5', subnetId: 's_default', ipAddress: '10.0.10.54', assignmentType: 'vm',        deviceId: null,          portId: null, vmId: 'vm_5', containerId: null, hostname: 'ollama',       description: 'LLM host on pve-03' },
  { id: 'ip_c1', subnetId: 's_default', ipAddress: '10.0.10.70', assignmentType: 'container', deviceId: null,          portId: null, vmId: null, containerId: 'ct_1', hostname: 'pihole',       description: null },
  { id: 'ip_c2', subnetId: 's_default', ipAddress: '10.0.10.71', assignmentType: 'container', deviceId: null,          portId: null, vmId: null, containerId: 'ct_2', hostname: 'unbound',      description: null },
  { id: 'ip_c3', subnetId: 's_default', ipAddress: '10.0.10.72', assignmentType: 'container', deviceId: null,          portId: null, vmId: null, containerId: 'ct_3', hostname: 'wireguard',    description: null },
  { id: 'ip_r1', subnetId: 's_default', ipAddress: '10.0.10.5',  assignmentType: 'reserved',  deviceId: null,          portId: null, vmId: null, containerId: null, hostname: 'reserved',      description: 'Future controller' },
  { id: 'ip_r2', subnetId: 's_default', ipAddress: '10.0.10.6',  assignmentType: 'reserved',  deviceId: null,          portId: null, vmId: null, containerId: null, hostname: 'reserved',      description: null },
  { id: 'ip_i1', subnetId: 's_iot',     ipAddress: '10.0.20.10', assignmentType: 'device',    deviceId: null,          portId: null, vmId: null, containerId: null, hostname: 'cam-front-door', description: null },
  { id: 'ip_i2', subnetId: 's_iot',     ipAddress: '10.0.20.11', assignmentType: 'device',    deviceId: null,          portId: null, vmId: null, containerId: null, hostname: 'cam-back-yard',  description: null },
  { id: 'ip_i3', subnetId: 's_iot',     ipAddress: '10.0.20.12', assignmentType: 'device',    deviceId: null,          portId: null, vmId: null, containerId: null, hostname: 'thermostat',     description: null },
  { id: 'ip_ap1', subnetId: 's_default', ipAddress: '10.0.10.30', assignmentType: 'device',   deviceId: 'd_ap_lounge',   portId: null, vmId: null, containerId: null, hostname: 'ap-lounge-01',  description: 'Lounge AP management' },
  { id: 'ip_ap2', subnetId: 's_default', ipAddress: '10.0.10.31', assignmentType: 'device',   deviceId: 'd_ap_office',   portId: null, vmId: null, containerId: null, hostname: 'ap-office-01',  description: 'Office AP management' },
  { id: 'ip_wc1', subnetId: 's_default', ipAddress: '10.0.10.60', assignmentType: 'device',   deviceId: 'd_wifi_phone',  portId: null, vmId: null, containerId: null, hostname: 'pixel-9-pro',   description: 'Main SSID client' },
  { id: 'ip_wc2', subnetId: 's_default', ipAddress: '10.0.10.61', assignmentType: 'device',   deviceId: 'd_wifi_laptop', portId: null, vmId: null, containerId: null, hostname: 'x1-carbon',     description: 'Main SSID client' },
  { id: 'ip_wc3', subnetId: 's_guest',   ipAddress: '10.0.50.120', assignmentType: 'device',  deviceId: 'd_wifi_tv',     portId: null, vmId: null, containerId: null, hostname: 'lounge-tv',     description: 'Guest SSID client' },
  { id: 'ip_wc4', subnetId: 's_iot',     ipAddress: '10.0.20.13', assignmentType: 'device',   deviceId: 'd_wifi_doorbell', portId: null, vmId: null, containerId: null, hostname: 'doorbell-01', description: 'IoT SSID client' },
  { id: 'ip_room_1', subnetId: 's_default', ipAddress: '10.0.10.81', assignmentType: 'device', deviceId: 'd_room_macmini', portId: null, vmId: null, containerId: null, hostname: 'build-mini-01', description: 'Room-based build node' },
  { id: 'ip_room_2', subnetId: 's_default', ipAddress: '10.0.10.82', assignmentType: 'device', deviceId: 'd_room_printer', portId: null, vmId: null, containerId: null, hostname: 'printer-01', description: 'Shared office printer' },
  { id: 'ip_room_3', subnetId: 's_iot', ipAddress: '10.0.20.40', assignmentType: 'device', deviceId: 'd_room_pi', portId: null, vmId: null, containerId: null, hostname: 'pi-dashboard', description: 'Wall dashboard helper' },
  { id: 'ip_studio_1', subnetId: 's_studio_default', ipAddress: '10.42.10.1', assignmentType: 'device', deviceId: 'd_studio_fw', portId: null, vmId: null, containerId: null, hostname: 'studio-fw-01', description: 'Studio edge firewall' },
  { id: 'ip_studio_2', subnetId: 's_studio_default', ipAddress: '10.42.10.2', assignmentType: 'device', deviceId: 'd_studio_sw', portId: null, vmId: null, containerId: null, hostname: 'studio-sw-01', description: 'Studio switch management' },
  { id: 'ip_studio_3', subnetId: 's_studio_default', ipAddress: '10.42.10.10', assignmentType: 'device', deviceId: 'd_studio_host', portId: null, vmId: null, containerId: null, hostname: 'studio-pve-01', description: 'Studio hypervisor' },
  { id: 'ip_studio_4', subnetId: 's_studio_default', ipAddress: '10.42.10.30', assignmentType: 'device', deviceId: 'd_studio_ap', portId: null, vmId: null, containerId: null, hostname: 'studio-ap-01', description: 'Studio AP management' },
  { id: 'ip_studio_5', subnetId: 's_studio_default', ipAddress: '10.42.10.60', assignmentType: 'device', deviceId: 'd_studio_tablet', portId: null, vmId: null, containerId: null, hostname: 'studio-ipad', description: 'Studio trusted wireless client' },
  { id: 'ip_studio_6', subnetId: 's_studio_iot', ipAddress: '10.42.20.25', assignmentType: 'device', deviceId: 'd_studio_printer', portId: null, vmId: null, containerId: null, hostname: 'maker-printer', description: 'Studio label printer' },
  { id: 'ip_studio_vm_1', subnetId: 's_studio_default', ipAddress: '10.42.10.50', assignmentType: 'vm', deviceId: null, portId: null, vmId: 'vm_studio_ci', containerId: null, hostname: 'studio-ci-01', description: 'CI runner on studio hypervisor' },
]

const wifiControllers = [
  { id: 'wctrl_unifi', labId: 'lab_home', deviceId: 'd_unifi', name: 'UniFi Network', vendor: 'Ubiquiti', model: 'Cloud Key Gen2 Plus', managementIp: '10.0.10.4', notes: 'Primary house WiFi controller.' },
  { id: 'wctrl_studio', labId: 'lab_studio', deviceId: null, name: 'Studio Wireless', vendor: 'Ubiquiti', model: 'Hosted controller', managementIp: null, notes: 'Controller profile for the detached office AP.' },
]

const wifiSsids = [
  { id: 'wssid_main',  labId: 'lab_home', name: 'Home-Main',  purpose: 'Primary trusted wireless LAN', security: 'WPA2/WPA3 Personal', hidden: 0, vlanId: 'v_default', color: '#6a9bd4' },
  { id: 'wssid_iot',   labId: 'lab_home', name: 'Home-IoT',   purpose: 'IoT isolation SSID',            security: 'WPA2 Personal',      hidden: 0, vlanId: 'v_iot',     color: '#6abf69' },
  { id: 'wssid_guest', labId: 'lab_home', name: 'Home-Guest', purpose: 'Guest-only internet access',     security: 'WPA2 Personal',      hidden: 0, vlanId: 'v_guest',   color: '#d4a13c' },
  { id: 'wssid_studio_main', labId: 'lab_studio', name: 'Studio-Main', purpose: 'Trusted office clients and dashboards', security: 'WPA2/WPA3 Personal', hidden: 0, vlanId: 'v_studio_default', color: '#7dd3fc' },
  { id: 'wssid_studio_iot', labId: 'lab_studio', name: 'Studio-IoT', purpose: 'Maker-space helpers and wireless accessories', security: 'WPA2 Personal', hidden: 0, vlanId: 'v_studio_iot', color: '#f59e0b' },
]

const wifiAccessPoints = [
  { deviceId: 'd_ap_lounge', controllerId: 'wctrl_unifi', location: 'Ground floor lounge ceiling', firmwareVersion: '6.7.18', notes: 'Covers lounge, patio doors, and hallway.' },
  { deviceId: 'd_ap_office', controllerId: 'wctrl_unifi', location: 'Office wall mount', firmwareVersion: '6.7.18', notes: 'Covers office, landing, and upstairs bedrooms.' },
  { deviceId: 'd_studio_ap', controllerId: 'wctrl_studio', location: 'Detached office ceiling mount', firmwareVersion: '7.0.15', notes: 'Studio AP for office clients and maker-space sensors.' },
]

const wifiRadios = [
  { id: 'wr_lounge_24', apDeviceId: 'd_ap_lounge', slotName: 'radio0', band: '2.4ghz', channel: '6', channelWidth: '20 MHz', txPower: 'medium', notes: 'Long-range IoT coverage.' },
  { id: 'wr_lounge_5',  apDeviceId: 'd_ap_lounge', slotName: 'radio1', band: '5ghz',   channel: '44', channelWidth: '80 MHz', txPower: 'high',   notes: 'Primary downstairs high-speed radio.' },
  { id: 'wr_office_24', apDeviceId: 'd_ap_office', slotName: 'radio0', band: '2.4ghz', channel: '1', channelWidth: '20 MHz', txPower: 'medium', notes: 'Office 2.4 GHz coverage.' },
  { id: 'wr_office_5',  apDeviceId: 'd_ap_office', slotName: 'radio1', band: '5ghz',   channel: '149', channelWidth: '80 MHz', txPower: 'high',  notes: 'Primary upstairs high-speed radio.' },
  { id: 'wr_studio_24', apDeviceId: 'd_studio_ap', slotName: 'radio0', band: '2.4ghz', channel: '11', channelWidth: '20 MHz', txPower: 'medium', notes: 'Studio IoT and long-range coverage.' },
  { id: 'wr_studio_5',  apDeviceId: 'd_studio_ap', slotName: 'radio1', band: '5ghz',   channel: '36', channelWidth: '80 MHz', txPower: 'high',  notes: 'Primary studio office client radio.' },
]

const wifiRadioSsids = [
  { radioId: 'wr_lounge_24', ssidId: 'wssid_main' },
  { radioId: 'wr_lounge_24', ssidId: 'wssid_iot' },
  { radioId: 'wr_lounge_24', ssidId: 'wssid_guest' },
  { radioId: 'wr_lounge_5', ssidId: 'wssid_main' },
  { radioId: 'wr_lounge_5', ssidId: 'wssid_guest' },
  { radioId: 'wr_office_24', ssidId: 'wssid_main' },
  { radioId: 'wr_office_24', ssidId: 'wssid_iot' },
  { radioId: 'wr_office_5', ssidId: 'wssid_main' },
  { radioId: 'wr_office_5', ssidId: 'wssid_guest' },
  { radioId: 'wr_studio_24', ssidId: 'wssid_studio_main' },
  { radioId: 'wr_studio_24', ssidId: 'wssid_studio_iot' },
  { radioId: 'wr_studio_5', ssidId: 'wssid_studio_main' },
]

const wifiClientAssociations = [
  { clientDeviceId: 'd_wifi_phone', apDeviceId: 'd_ap_lounge', radioId: 'wr_lounge_5', ssidId: 'wssid_main', band: '5ghz', channel: '44', signalDbm: -52, lastSeen: new Date(now - 15_000).toISOString(), lastRoamAt: new Date(now - 20 * 60_000).toISOString(), notes: 'Usually sticks to the lounge AP while downstairs.' },
  { clientDeviceId: 'd_wifi_laptop', apDeviceId: 'd_ap_office', radioId: 'wr_office_5', ssidId: 'wssid_main', band: '5ghz', channel: '149', signalDbm: -47, lastSeen: new Date(now - 40_000).toISOString(), lastRoamAt: new Date(now - 35 * 60_000).toISOString(), notes: 'Roams to the office AP when docked.' },
  { clientDeviceId: 'd_wifi_tv', apDeviceId: 'd_ap_lounge', radioId: 'wr_lounge_5', ssidId: 'wssid_guest', band: '5ghz', channel: '44', signalDbm: -60, lastSeen: new Date(now - 90_000).toISOString(), lastRoamAt: new Date(now - 5 * 3600_000).toISOString(), notes: 'Guest SSID keeps the smart TV isolated.' },
  { clientDeviceId: 'd_wifi_doorbell', apDeviceId: 'd_ap_lounge', radioId: 'wr_lounge_24', ssidId: 'wssid_iot', band: '2.4ghz', channel: '6', signalDbm: -71, lastSeen: new Date(now - 600_000).toISOString(), lastRoamAt: new Date(now - 8 * 3600_000).toISOString(), notes: 'Edge-of-coverage IoT client.' },
  { clientDeviceId: 'd_studio_tablet', apDeviceId: 'd_studio_ap', radioId: 'wr_studio_5', ssidId: 'wssid_studio_main', band: '5ghz', channel: '36', signalDbm: -49, lastSeen: new Date(now - 30_000).toISOString(), lastRoamAt: new Date(now - 65 * 60_000).toISOString(), notes: 'Pinned to the studio trusted SSID for dashboards and media.' },
]

const portTemplates = [
  {
    id: 'tpl_lab_mini_firewall',
    name: '4x2.5G + 2x10G Firewall',
    description: 'Compact firewall template captured from a modern multi-NIC edge appliance.',
    deviceTypes: JSON.stringify(['firewall', 'router']),
    ports: JSON.stringify([
      { name: 'wan0', position: 1, kind: 'rj45', speed: '2.5G', face: 'front' },
      { name: 'wan1', position: 2, kind: 'rj45', speed: '2.5G', face: 'front' },
      { name: 'lan0', position: 3, kind: 'rj45', speed: '2.5G', face: 'front' },
      { name: 'lan1', position: 4, kind: 'rj45', speed: '2.5G', face: 'front' },
      { name: 'sfp+1', position: 5, kind: 'sfp_plus', speed: '10G', face: 'front' },
      { name: 'sfp+2', position: 6, kind: 'sfp_plus', speed: '10G', face: 'front' },
    ]),
    createdAt: new Date(now - 14 * 24 * 3600_000).toISOString(),
    updatedAt: new Date(now - 2 * 24 * 3600_000).toISOString(),
  },
  {
    id: 'tpl_micro_hypervisor',
    name: '2x1G + 2x10G Micro Host',
    description: 'Small-form-factor hypervisor with two copper ports and dual SFP+ uplinks.',
    deviceTypes: JSON.stringify(['server', 'storage']),
    ports: JSON.stringify([
      { name: 'eno1', position: 1, kind: 'rj45', speed: '1G', face: 'front' },
      { name: 'eno2', position: 2, kind: 'rj45', speed: '1G', face: 'front' },
      { name: 'enp1s0f0', position: 3, kind: 'sfp_plus', speed: '10G', face: 'front' },
      { name: 'enp1s0f1', position: 4, kind: 'sfp_plus', speed: '10G', face: 'front' },
    ]),
    createdAt: new Date(now - 10 * 24 * 3600_000).toISOString(),
    updatedAt: new Date(now - 3 * 24 * 3600_000).toISOString(),
  },
]

const discoveredDevices = [
  { id: 'disc_home_dup', labId: 'lab_home', ipAddress: '10.0.10.82', hostname: 'printer-01', displayName: 'Brother Laser Upstairs', deviceType: 'endpoint', placement: 'room', macAddress: '3c:22:fb:11:22:33', vendor: 'Brother', source: 'seed-demo', status: 'new', notes: 'Scan result matches the upstairs printer and demonstrates duplicate detection.', importedDeviceId: null, lastSeen: new Date(now - 4 * 60_000).toISOString(), lastScannedAt: new Date(now - 4 * 60_000).toISOString() },
  { id: 'disc_home_imported', labId: 'lab_home', ipAddress: '10.0.10.81', hostname: 'build-mini-01', displayName: 'Build Mini', deviceType: 'server', placement: 'room', macAddress: 'f0:18:98:44:55:66', vendor: 'Apple', source: 'seed-demo', status: 'imported', notes: 'Previously linked into inventory to showcase the imported state.', importedDeviceId: 'd_room_macmini', lastSeen: new Date(now - 12 * 60_000).toISOString(), lastScannedAt: new Date(now - 12 * 60_000).toISOString() },
  { id: 'disc_home_dismissed', labId: 'lab_home', ipAddress: '10.0.20.77', hostname: 'temp-cam-probe', displayName: 'Unknown camera probe', deviceType: 'endpoint', placement: 'room', macAddress: 'd8:3a:dd:ab:cd:ef', vendor: 'TP-Link', source: 'seed-demo', status: 'dismissed', notes: 'Dismissed after determining it was a transient test client.', importedDeviceId: null, lastSeen: new Date(now - 36 * 60_000).toISOString(), lastScannedAt: new Date(now - 36 * 60_000).toISOString() },
  { id: 'disc_studio_new', labId: 'lab_studio', ipAddress: '10.42.20.50', hostname: 'laser-cutter-probe', displayName: 'Laser cutter bridge', deviceType: 'laser_cutter', placement: 'room', macAddress: 'b8:27:eb:77:88:99', vendor: 'Raspberry Pi', source: 'seed-demo', status: 'new', notes: 'Awaiting manual review before import into the studio lab. Uses a custom device type to show flexible inventory categories.', importedDeviceId: null, lastSeen: new Date(now - 9 * 60_000).toISOString(), lastScannedAt: new Date(now - 9 * 60_000).toISOString() },
]

const deviceMonitors = [
  { id: 'mon_fw_icmp', deviceId: 'd_fw', name: 'Management ICMP', type: 'icmp', target: '10.0.10.1', port: null, path: null, intervalMs: 60000, enabled: 1, sortOrder: 0, lastCheckAt: new Date(now - 20_000).toISOString(), lastAlertAt: null, lastResult: 'online', lastMessage: 'ICMP 10.0.10.1 reachable.' },
  { id: 'mon_fw_https', deviceId: 'd_fw', name: 'Firewall UI', type: 'https', target: '10.0.10.1', port: 443, path: '/', intervalMs: 120000, enabled: 1, sortOrder: 1, lastCheckAt: new Date(now - 24_000).toISOString(), lastAlertAt: null, lastResult: 'online', lastMessage: 'https://10.0.10.1:443/ returned 200.' },
  { id: 'mon_pve1_icmp', deviceId: 'd_srv_pve1', name: 'Management ICMP', type: 'icmp', target: '10.0.10.11', port: null, path: null, intervalMs: 60000, enabled: 1, sortOrder: 0, lastCheckAt: new Date(now - 18_000).toISOString(), lastAlertAt: null, lastResult: 'online', lastMessage: 'ICMP 10.0.10.11 reachable.' },
  { id: 'mon_pve1_ssh', deviceId: 'd_srv_pve1', name: 'SSH', type: 'tcp', target: '10.0.10.11', port: 22, path: null, intervalMs: 120000, enabled: 1, sortOrder: 1, lastCheckAt: new Date(now - 18_000).toISOString(), lastAlertAt: null, lastResult: 'online', lastMessage: 'TCP 10.0.10.11:22 reachable.' },
  { id: 'mon_pve1_storage', deviceId: 'd_srv_pve1', name: 'Storage VLAN', type: 'icmp', target: '10.0.40.11', port: null, path: null, intervalMs: 180000, enabled: 1, sortOrder: 2, lastCheckAt: new Date(now - 32_000).toISOString(), lastAlertAt: null, lastResult: 'online', lastMessage: 'ICMP 10.0.40.11 reachable.' },
  { id: 'mon_backup_icmp', deviceId: 'd_srv_backup', name: 'Management ICMP', type: 'icmp', target: '10.0.10.21', port: null, path: null, intervalMs: 60000, enabled: 1, sortOrder: 0, lastCheckAt: new Date(now - 45_000).toISOString(), lastAlertAt: new Date(now - 40 * 60_000).toISOString(), lastResult: 'offline', lastMessage: 'ICMP 10.0.10.21 failed: Request timeout.' },
  { id: 'mon_ap_lounge_icmp', deviceId: 'd_ap_lounge', name: 'AP ICMP', type: 'icmp', target: '10.0.10.30', port: null, path: null, intervalMs: 120000, enabled: 1, sortOrder: 0, lastCheckAt: new Date(now - 16_000).toISOString(), lastAlertAt: null, lastResult: 'online', lastMessage: 'ICMP 10.0.10.30 reachable.' },
  { id: 'mon_studio_fw_icmp', deviceId: 'd_studio_fw', name: 'Studio ICMP', type: 'icmp', target: '10.42.10.1', port: null, path: null, intervalMs: 60000, enabled: 1, sortOrder: 0, lastCheckAt: new Date(now - 21_000).toISOString(), lastAlertAt: null, lastResult: 'online', lastMessage: 'ICMP 10.42.10.1 reachable.' },
  { id: 'mon_studio_host_https', deviceId: 'd_studio_host', name: 'Hypervisor UI', type: 'https', target: '10.42.10.10', port: 8006, path: '/', intervalMs: 120000, enabled: 1, sortOrder: 0, lastCheckAt: new Date(now - 26_000).toISOString(), lastAlertAt: null, lastResult: 'online', lastMessage: 'https://10.42.10.10:8006/ returned 200.' },
  { id: 'mon_studio_ap_icmp', deviceId: 'd_studio_ap', name: 'AP ICMP', type: 'icmp', target: '10.42.10.30', port: null, path: null, intervalMs: 120000, enabled: 1, sortOrder: 0, lastCheckAt: new Date(now - 22_000).toISOString(), lastAlertAt: null, lastResult: 'online', lastMessage: 'ICMP 10.42.10.30 reachable.' },
]

const appSettings = [
  {
    key: 'alertSettings',
    value: JSON.stringify({
      enabled: false,
      notifyOnDown: true,
      notifyOnRecovery: true,
      repeatWhileOffline: true,
      repeatIntervalMinutes: 180,
      discordWebhookUrl: null,
      telegramBotToken: null,
      telegramChatId: null,
      smtpHost: null,
      smtpPort: 587,
      smtpSecure: false,
      smtpUsername: null,
      smtpPassword: null,
      smtpFrom: null,
      smtpTo: null,
    }),
    updatedAt: new Date(now - 3 * 24 * 3600_000).toISOString(),
  },
]

const documentationPages = [
  {
    id: 'doc_home_runbook',
    labId: 'lab_home',
    title: 'Home Lab Runbook',
    content: [
      '# Home Lab Runbook',
      '',
      '## Weekly checks',
      '',
      '- Review Dashboard health and recent monitor activity.',
      '- Open Visualizer in Health mode and check warning or offline devices.',
      '- Confirm backup-01 maintenance notes before applying updates.',
      '',
      '## Rack reference',
      '',
      `![CMP-01 rack front reference](${demoRackImageDataUrl})`,
      '',
      '## Known maintenance windows',
      '',
      '| Device | Window | Notes |',
      '| --- | --- | --- |',
      '| backup-01 | Sunday 02:00 | PBS sync and disk scrub |',
      '| truenas-01 | First Saturday | Pool scrub and SMART checks |',
      '| sw-tor-01 | As needed | Firmware with rollback config saved |',
    ].join('\n'),
    createdAt: new Date(now - 5 * 24 * 3600_000).toISOString(),
    updatedAt: new Date(now - 2 * 3600_000).toISOString(),
  },
  {
    id: 'doc_oidc_authentik',
    labId: 'lab_home',
    title: 'OIDC Authentik Checklist',
    content: [
      '# OIDC Authentik Checklist',
      '',
      'Use this page as a copyable example for a private Rackpad deployment.',
      '',
      '```bash',
      'OIDC_ENABLED=1',
      'OIDC_LABEL=Authentik',
      'OIDC_ISSUER_URL=https://authentik.example.com/application/o/rackpad',
      'OIDC_REDIRECT_URI=https://rackpad.example.com/api/auth/oidc/callback',
      'OIDC_DEFAULT_ROLE=viewer',
      'OIDC_ADMIN_GROUPS=admin',
      'OIDC_DEBUG=1',
      '```',
      '',
      'If sign-in returns a provider 404, test the discovery document directly:',
      '',
      '```bash',
      'curl https://authentik.example.com/application/o/rackpad/.well-known/openid-configuration',
      '```',
      '',
      'Disable `OIDC_DEBUG` again after the provider is confirmed.',
    ].join('\n'),
    createdAt: new Date(now - 4 * 24 * 3600_000).toISOString(),
    updatedAt: new Date(now - 90 * 60_000).toISOString(),
  },
  {
    id: 'doc_studio_notes',
    labId: 'lab_studio',
    title: 'Studio Network Notes',
    content: [
      '# Studio Network Notes',
      '',
      'The studio lab is a smaller rack with a detached-office AP, a compact hypervisor, and maker-space peripherals.',
      '',
      `![Studio room reference](${demoRoomImageDataUrl})`,
      '',
      '- Keep Studio-Main on VLAN 10 for trusted clients.',
      '- Keep Studio-IoT on VLAN 20 for printers, sensors, and shop tools.',
      '- The laser cutter bridge is intentionally left in Discovery to show staged custom device import.',
    ].join('\n'),
    createdAt: new Date(now - 3 * 24 * 3600_000).toISOString(),
    updatedAt: new Date(now - 45 * 60_000).toISOString(),
  },
]

const deviceImages = [
  {
    id: 'img_pve1_rack_front',
    deviceId: 'd_srv_pve1',
    label: 'Rack front reference',
    fileName: 'pve-01-rack-front.png',
    mimeType: 'image/png',
    dataUrl: demoRackImageDataUrl,
    notes: 'Example device image used to document the host position and nearby cabling.',
    createdAt: new Date(now - 3 * 24 * 3600_000).toISOString(),
    updatedAt: new Date(now - 3 * 24 * 3600_000).toISOString(),
  },
  {
    id: 'img_ap_lounge_mount',
    deviceId: 'd_ap_lounge',
    label: 'Ceiling mount reference',
    fileName: 'lounge-ap-mount.png',
    mimeType: 'image/png',
    dataUrl: demoRoomImageDataUrl,
    notes: 'Example room reference for wireless placement and AP association documentation.',
    createdAt: new Date(now - 2 * 24 * 3600_000).toISOString(),
    updatedAt: new Date(now - 2 * 24 * 3600_000).toISOString(),
  },
]

const auditLog = [
  { id: 'a1', ts: new Date(now - 3 * 60_000).toISOString(),         user: 'admin',  action: 'ip.assign',     entityType: 'IpAssignment', entityId: 'ip_v5',        summary: 'Assigned 10.0.10.54 to ollama (vm)' },
  { id: 'a2', ts: new Date(now - 12 * 60_000).toISOString(),        user: 'admin',  action: 'device.update', entityType: 'Device',       entityId: 'd_unifi',      summary: 'Marked unifi-01 status: warning' },
  { id: 'a3', ts: new Date(now - 47 * 60_000).toISOString(),        user: 'admin',  action: 'port.link',     entityType: 'PortLink',     entityId: 'l_18',         summary: 'Linked truenas-01:ix1 ↔ sw-tor-01:31' },
  { id: 'a4', ts: new Date(now - 2 * 3600_000).toISOString(),       user: 'editor', action: 'device.create', entityType: 'Device',       entityId: 'd_srv_pve3',   summary: 'Created pve-03 in CMP-01 U36-37' },
  { id: 'a5', ts: new Date(now - 4 * 3600_000).toISOString(),       user: 'admin',  action: 'subnet.create', entityType: 'Subnet',       entityId: 's_storage',    summary: 'Created subnet 10.0.40.0/24 (Storage)' },
  { id: 'a6', ts: new Date(now - 26 * 3600_000).toISOString(),      user: 'editor', action: 'device.move',   entityType: 'Device',       entityId: 'd_srv_backup', summary: 'Moved backup-01 to maintenance' },
  { id: 'a7', ts: new Date(now - 7 * 60_000).toISOString(),         user: 'system', action: 'alert.down', entityType: 'Alert', entityId: 'mon_backup_icmp', summary: 'Rackpad outage alert for backup-01 / Management ICMP delivered via email and Discord.' },
  { id: 'a8', ts: new Date(now - 65 * 60_000).toISOString(),        user: 'admin',  action: 'discovery.link', entityType: 'DiscoveredDevice', entityId: 'disc_home_imported', summary: 'Linked discovered build-mini-01 to the Build Mini inventory record.' },
  { id: 'a9', ts: new Date(now - 95 * 60_000).toISOString(),        user: 'editor', action: 'wifi.client.update', entityType: 'WifiClientAssociation', entityId: 'd_studio_tablet', summary: 'Updated studio-ipad association to Studio-Main on studio-ap-01.' },
  { id: 'a10', ts: new Date(now - 7 * 3600_000).toISOString(),      user: 'admin',  action: 'port-template.create', entityType: 'PortTemplate', entityId: 'tpl_micro_hypervisor', summary: 'Captured a custom micro-host port template from studio-pve-01.' },
]

// ── Insert ─────────────────────────────────────────────────────

export function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM labs').get() as { count: number }
  if (count > 0) return

  console.log('[rackpad] Seeding database with initial homelab data…')

  const insertLab = db.prepare('INSERT INTO labs VALUES (@id, @name, @description, @location)')
  const insertRoom = db.prepare('INSERT INTO rooms (id, labId, name, description, location, notes) VALUES (@id, @labId, @name, @description, @location, @notes)')
  const insertRack = db.prepare('INSERT INTO racks (id, labId, name, totalU, description, location, notes, roomId) VALUES (@id, @labId, @name, @totalU, @description, @location, @notes, @roomId)')
  const insertDevice = db.prepare(`
    INSERT INTO devices
      (id, labId, rackId, hostname, displayName, deviceType, manufacturer, model, serial, managementIp, macAddress, status,
       startU, heightU, face, tags, notes, lastSeen, placement, parentDeviceId, roomId, cpuCores, memoryGb, storageGb, specs)
    VALUES
      (@id, @labId, @rackId, @hostname, @displayName, @deviceType, @manufacturer, @model, @serial, @managementIp, @macAddress, @status,
       @startU, @heightU, @face, @tags, @notes, @lastSeen, @placement, @parentDeviceId, @roomId, @cpuCores, @memoryGb, @storageGb, @specs)
  `)
  const insertPort = db.prepare(`
    INSERT INTO ports (id, deviceId, name, position, kind, speed, linkState, mode, vlanId, allowedVlanIds, description, face)
    VALUES (@id, @deviceId, @name, @position, @kind, @speed, @linkState, @mode, @vlanId, @allowedVlanIds, @description, @face)
  `)
  const insertPortTemplate = db.prepare('INSERT INTO portTemplates VALUES (@id, @name, @description, @deviceTypes, @ports, @createdAt, @updatedAt)')
  const insertVlan = db.prepare('INSERT INTO vlans VALUES (@id, @labId, @vlanId, @name, @description, @color)')
  const insertVlanRange = db.prepare('INSERT INTO vlanRanges VALUES (@id, @labId, @name, @startVlan, @endVlan, @purpose, @color)')
  const insertPortLink = db.prepare('INSERT INTO portLinks VALUES (@id, @fromPortId, @toPortId, @cableType, @cableLength, @color, @notes)')
  const insertSubnet = db.prepare('INSERT INTO subnets VALUES (@id, @labId, @cidr, @name, @description, @vlanId)')
  const insertDhcpScope = db.prepare('INSERT INTO dhcpScopes VALUES (@id, @subnetId, @name, @startIp, @endIp, @gateway, @dnsServers, @description)')
  const insertIpZone = db.prepare('INSERT INTO ipZones VALUES (@id, @subnetId, @kind, @startIp, @endIp, @description)')
  const insertIpAssignment = db.prepare('INSERT INTO ipAssignments VALUES (@id, @subnetId, @ipAddress, @assignmentType, @deviceId, @portId, @vmId, @containerId, @hostname, @description)')
  const insertDiscoveredDevice = db.prepare(`
    INSERT INTO discoveredDevices (
      id,
      labId,
      ipAddress,
      hostname,
      displayName,
      deviceType,
      placement,
      source,
      status,
      notes,
      importedDeviceId,
      lastSeen,
      lastScannedAt,
      macAddress,
      vendor
    ) VALUES (
      @id,
      @labId,
      @ipAddress,
      @hostname,
      @displayName,
      @deviceType,
      @placement,
      @source,
      @status,
      @notes,
      @importedDeviceId,
      @lastSeen,
      @lastScannedAt,
      @macAddress,
      @vendor
    )
  `)
  const insertDeviceMonitor = db.prepare('INSERT INTO deviceMonitors VALUES (@id, @deviceId, @name, @type, @target, @port, @path, @intervalMs, @enabled, @sortOrder, @lastCheckAt, @lastResult, @lastMessage, @lastAlertAt)')
  const insertWifiController = db.prepare('INSERT INTO wifiControllers VALUES (@id, @labId, @deviceId, @name, @vendor, @model, @managementIp, @notes)')
  const insertWifiSsid = db.prepare('INSERT INTO wifiSsids VALUES (@id, @labId, @name, @purpose, @security, @hidden, @vlanId, @color)')
  const insertWifiAccessPoint = db.prepare('INSERT INTO wifiAccessPoints VALUES (@deviceId, @controllerId, @location, @firmwareVersion, @notes)')
  const insertWifiRadio = db.prepare('INSERT INTO wifiRadios VALUES (@id, @apDeviceId, @slotName, @band, @channel, @channelWidth, @txPower, @notes)')
  const insertWifiRadioSsid = db.prepare('INSERT INTO wifiRadioSsids VALUES (@radioId, @ssidId)')
  const insertWifiClientAssociation = db.prepare('INSERT INTO wifiClientAssociations VALUES (@clientDeviceId, @apDeviceId, @radioId, @ssidId, @band, @channel, @signalDbm, @lastSeen, @lastRoamAt, @notes)')
  const insertAppSetting = db.prepare('INSERT INTO appSettings VALUES (@key, @value, @updatedAt)')
  const insertDocumentationPage = db.prepare('INSERT INTO documentationPages (id, labId, title, content, createdAt, updatedAt) VALUES (@id, @labId, @title, @content, @createdAt, @updatedAt)')
  const insertDeviceImage = db.prepare('INSERT INTO deviceImages (id, deviceId, label, fileName, mimeType, dataUrl, notes, createdAt, updatedAt) VALUES (@id, @deviceId, @label, @fileName, @mimeType, @dataUrl, @notes, @createdAt, @updatedAt)')
  const insertAudit = db.prepare('INSERT INTO auditLog VALUES (@id, @ts, @user, @action, @entityType, @entityId, @summary)')

  // Wrap everything in a transaction so seed is atomic
  const seed = db.transaction(() => {
    for (const entry of labs) insertLab.run(entry)
    for (const room of rooms) insertRoom.run(room)
    for (const r of racks) insertRack.run(r)

    // VLANs must come before ports (foreign key vlanId)
    for (const v of vlans) insertVlan.run(v)
    for (const vr of vlanRanges) insertVlanRange.run(vr)

    for (const d of devices) {
      const capacity = deviceCapacityById[d.id] ?? {}
      const roomId = 'roomId' in d ? d.roomId : null
      const macAddress = (d as { macAddress?: string | null }).macAddress
      insertDevice.run({
        ...d,
        placement: d.placement ?? (d.rackId ? 'rack' : d.deviceType === 'vm' || d.deviceType === 'container' ? 'virtual' : d.deviceType === 'ap' ? 'wireless' : 'room'),
        parentDeviceId: d.parentDeviceId ?? null,
        roomId,
        macAddress: macAddress ?? demoMacAddressByDeviceId[d.id] ?? null,
        cpuCores: d.cpuCores ?? capacity.cpuCores ?? null,
        memoryGb: d.memoryGb ?? capacity.memoryGb ?? null,
        storageGb: d.storageGb ?? capacity.storageGb ?? null,
        specs: d.specs ?? capacity.specs ?? null,
      })
    }
    for (const p of ports) {
      insertPort.run({
        ...p,
        mode: p.mode ?? 'access',
        allowedVlanIds: p.allowedVlanIds ? JSON.stringify(p.allowedVlanIds) : null,
      })
    }
    for (const template of portTemplates) insertPortTemplate.run(template)
    for (const l of portLinks) insertPortLink.run(l)

    for (const s of subnets) insertSubnet.run(s)
    for (const sc of dhcpScopes) insertDhcpScope.run(sc)
    for (const iz of ipZones) insertIpZone.run(iz)
    for (const ip of ipAssignments) insertIpAssignment.run(ip)
    for (const discovered of discoveredDevices) insertDiscoveredDevice.run(discovered)
    for (const monitor of deviceMonitors) insertDeviceMonitor.run(monitor)
    for (const controller of wifiControllers) insertWifiController.run(controller)
    for (const ssid of wifiSsids) insertWifiSsid.run(ssid)
    for (const accessPoint of wifiAccessPoints) insertWifiAccessPoint.run(accessPoint)
    for (const radio of wifiRadios) insertWifiRadio.run(radio)
    for (const radioSsid of wifiRadioSsids) insertWifiRadioSsid.run(radioSsid)
    for (const association of wifiClientAssociations) insertWifiClientAssociation.run(association)
    for (const setting of appSettings) insertAppSetting.run(setting)
    for (const page of documentationPages) insertDocumentationPage.run(page)
    for (const image of deviceImages) insertDeviceImage.run(image)
    for (const a of auditLog) insertAudit.run(a)
  })

  seed()
  ensurePatchPanelPassThroughPorts()
  console.log('[rackpad] Seed complete.')
}

export function ensureDefaultLab() {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM labs').get() as { count: number }
  if (count > 0) return

  db.prepare('INSERT INTO labs VALUES (@id, @name, @description, @location)').run({
    ...lab,
    description: 'Primary homelab workspace.',
    location: null,
  })
}
