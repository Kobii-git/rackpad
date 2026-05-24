import { db, parseRow } from '../db.js'
import { createId } from './ids.js'

const PORT_KINDS = ['rj45', 'sfp', 'sfp_plus', 'qsfp', 'fiber', 'power', 'console', 'usb', 'virtual'] as const
export type PortTemplateKind = (typeof PORT_KINDS)[number]
export type PortTemplateMode = 'access' | 'trunk'

export interface PortTemplatePort {
  name: string
  position: number
  kind: PortTemplateKind
  speed?: string
  mode?: PortTemplateMode
  allowedVlanIds?: string[] | null
  face?: 'front' | 'rear'
}

export interface PortTemplate {
  id: string
  name: string
  deviceTypes: string[]
  description: string
  ports: PortTemplatePort[]
  builtIn?: boolean
}

function rangeNames(prefix: string, count: number, kind: PortTemplateKind, speed?: string) {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}${index + 1}`,
    kind,
    speed,
    face: 'front' as const,
  }))
}

function patchPanelPorts(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const label = String(index + 1)
    const position = index + 1
    return [
      {
        name: label,
        kind: 'rj45' as const,
        speed: '1G',
        face: 'front' as const,
        position,
      },
      {
        name: label,
        kind: 'rj45' as const,
        speed: '1G',
        face: 'rear' as const,
        position,
      },
    ]
  }).flat()
}

function normalizePorts(
  ports: Array<{ name: string; kind: PortTemplateKind; speed?: string; mode?: PortTemplateMode; allowedVlanIds?: string[] | null; face?: 'front' | 'rear'; position?: number }>,
) {
  return ports.map((port, index) => ({
    name: port.name,
    position: port.position ?? index + 1,
    kind: port.kind,
    speed: port.speed,
    mode: port.mode ?? 'access',
    allowedVlanIds: port.mode === 'trunk' ? port.allowedVlanIds ?? [] : [],
    face: port.face ?? 'front',
  }))
}

export const BUILT_IN_PORT_TEMPLATES: PortTemplate[] = [
  {
    id: 'switch-24g-4sfp+',
    name: '24x1G + 4x10G SFP+',
    deviceTypes: ['switch'],
    description: 'Common 24-port access switch with 4 SFP+ uplinks.',
    ports: normalizePorts([
      ...rangeNames('', 24, 'rj45', '1G'),
      ...rangeNames('SFP+', 4, 'sfp_plus', '10G'),
    ]),
  },
  {
    id: 'switch-48g-4sfp+',
    name: '48x1G + 4x10G SFP+',
    deviceTypes: ['switch'],
    description: 'Common 48-port access switch with 4 SFP+ uplinks.',
    ports: normalizePorts([
      ...rangeNames('', 48, 'rj45', '1G'),
      ...rangeNames('SFP+', 4, 'sfp_plus', '10G'),
    ]),
  },
  {
    id: 'switch-28sfp+',
    name: '28x10G SFP+',
    deviceTypes: ['switch'],
    description: 'Aggregation switch with 28 SFP+ ports.',
    ports: normalizePorts(rangeNames('SFP+', 28, 'sfp_plus', '10G')),
  },
  {
    id: 'firewall-6x1g',
    name: '6x1G firewall',
    deviceTypes: ['firewall', 'router'],
    description: 'Firewall or router with six 1G copper ports.',
    ports: normalizePorts(
      Array.from({ length: 6 }, (_, index) => ({
        name: `igb${index}`,
        kind: 'rj45' as const,
        speed: '1G',
      })),
    ),
  },
  {
    id: 'server-4x1g-2x10g',
    name: '4x1G + 2x10G server',
    deviceTypes: ['server', 'storage'],
    description: 'Server with four 1G ports and two 10G uplinks.',
    ports: normalizePorts([
      ...Array.from({ length: 4 }, (_, index) => ({
        name: `eno${index + 1}`,
        kind: 'rj45' as const,
        speed: '1G',
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        name: `enp1s0f${index}`,
        kind: 'sfp_plus' as const,
        speed: '10G',
      })),
    ]),
  },
  {
    id: 'server-2x1g-2x10g',
    name: '2x1G + 2x10G server',
    deviceTypes: ['server', 'storage'],
    description: 'Compact server with two 1G ports and two 10G uplinks.',
    ports: normalizePorts([
      ...Array.from({ length: 2 }, (_, index) => ({
        name: `eno${index + 1}`,
        kind: 'rj45' as const,
        speed: '1G',
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        name: `enp1s0f${index}`,
        kind: 'sfp_plus' as const,
        speed: '10G',
      })),
    ]),
  },
  {
    id: 'vm-2xvirtio',
    name: '2x VirtIO workload',
    deviceTypes: ['vm', 'container'],
    description: 'Virtual machine or container with two documented VirtIO network interfaces.',
    ports: normalizePorts([
      { name: 'eth0', kind: 'virtual', speed: 'virtio' },
      { name: 'eth1', kind: 'virtual', speed: 'virtio' },
    ]),
  },
  {
    id: 'patch-panel-24',
    name: '24-port patch panel',
    deviceTypes: ['patch_panel'],
    description: 'Twenty-four front and rear copper patch panel terminations.',
    ports: normalizePorts(patchPanelPorts(24)),
  },
  {
    id: 'pdu-8',
    name: '8-outlet PDU',
    deviceTypes: ['pdu', 'ups'],
    description: 'Eight power outlets on the rear face.',
    ports: normalizePorts(
      Array.from({ length: 8 }, (_, index) => ({
        name: `Outlet ${index + 1}`,
        kind: 'power' as const,
        face: 'rear' as const,
      })),
    ),
  },
].map((template) => ({ ...template, builtIn: true }))

function parsePortTemplateRow(row: Record<string, unknown>): PortTemplate {
  const parsed = parseRow(row, ['deviceTypes', 'ports']) as Record<string, unknown> & {
    deviceTypes?: unknown
    ports?: unknown
  }

  const deviceTypes = Array.isArray(parsed.deviceTypes)
    ? parsed.deviceTypes.map((entry) => String(entry))
    : []
  const ports = Array.isArray(parsed.ports)
    ? normalizePorts(
        parsed.ports.map((entry) => {
          const port = entry as Record<string, unknown>
          return {
            name: String(port.name),
            position: Number(port.position),
            kind: String(port.kind) as PortTemplateKind,
            speed: port.speed ? String(port.speed) : undefined,
            mode: port.mode === 'trunk' ? 'trunk' : 'access',
            allowedVlanIds:
              port.mode === 'trunk' && Array.isArray(port.allowedVlanIds)
                ? port.allowedVlanIds.map((entry) => String(entry))
                : [],
            face: port.face === 'rear' ? 'rear' : 'front',
          }
        }),
      )
    : []

  return {
    id: String(parsed.id),
    name: String(parsed.name),
    description: String(parsed.description ?? ''),
    deviceTypes,
    ports,
    builtIn: false,
  }
}

export function listPortTemplates() {
  const rows = db.prepare('SELECT * FROM portTemplates ORDER BY name').all() as Record<string, unknown>[]
  return [...BUILT_IN_PORT_TEMPLATES, ...rows.map(parsePortTemplateRow)]
}

export function getPortTemplate(templateId: string) {
  return listPortTemplates().find((template) => template.id === templateId) ?? null
}

export function createPortsFromTemplate(deviceId: string, templateId: string) {
  const template = getPortTemplate(templateId)
  if (!template) return []

  return template.ports.map((port, index) => ({
    id: createId('p'),
    deviceId,
    name: port.name,
    position: port.position ?? index + 1,
    kind: port.kind,
    speed: port.speed ?? null,
    linkState: 'down',
    mode: port.mode ?? 'access',
    vlanId: null,
    allowedVlanIds: port.mode === 'trunk' ? JSON.stringify(port.allowedVlanIds ?? []) : null,
    description: null,
    face: port.face ?? 'front',
    virtualSwitchId: null,
  }))
}
