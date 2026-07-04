import { db } from '../db.js'
import { ValidationError } from './validation.js'

interface RackPlacementInput {
  rackId?: string | null
  startU?: number | null
  heightU?: number | null
  face?: string | null
  rackSlot?: string | null
  deviceId?: string
}

const RACK_SLOTS = ['full', 'left', 'right'] as const
type RackSlot = (typeof RACK_SLOTS)[number]

function normalizeRackSlot(value: string | null | undefined): RackSlot {
  if (!value) return 'full'
  if (RACK_SLOTS.includes(value as RackSlot)) return value as RackSlot
  throw new ValidationError('Rack slot must be full, left, or right.')
}

function rackSlotsConflict(a: RackSlot, b: RackSlot) {
  if (a === 'full' || b === 'full') return true
  return a === b
}

export function validateRackPlacement(input: RackPlacementInput) {
  if (!input.rackId) {
    return {
      rackId: null,
      startU: null,
      heightU: null,
      face: null,
      rackSlot: 'full' as const,
    }
  }

  const rack = db.prepare('SELECT id, totalU FROM racks WHERE id = ?').get(input.rackId) as
    | { id: string; totalU: number }
    | undefined

  if (!rack) {
    throw new ValidationError('Selected rack does not exist.')
  }

  if (!Number.isInteger(input.startU)) {
    throw new ValidationError('Start U is required when a device is placed in a rack.')
  }

  const heightU = Number.isInteger(input.heightU) ? input.heightU! : 1
  if (heightU < 1) {
    throw new ValidationError('Height U must be at least 1.')
  }

  const startU = input.startU!
  if (startU < 1) {
    throw new ValidationError('Start U must be at least 1.')
  }

  const endU = startU + heightU - 1
  if (endU > rack.totalU) {
    throw new ValidationError(`Device would exceed rack height ${rack.totalU}U.`)
  }

  const face = input.face ?? 'front'
  if (!['front', 'rear'].includes(face)) {
    throw new ValidationError('Rack face must be front or rear.')
  }
  const rackSlot = normalizeRackSlot(input.rackSlot)

  const overlaps = db.prepare(`
    SELECT id, hostname, startU, heightU, rackSlot
    FROM devices
    WHERE rackId = ?
      AND COALESCE(face, 'front') = ?
      AND startU IS NOT NULL
      AND heightU IS NOT NULL
      AND id != COALESCE(?, '')
  `).all(input.rackId, face, input.deviceId ?? null) as Array<{
    id: string
    hostname: string
    startU: number
    heightU: number
    rackSlot: string | null
  }>

  for (const device of overlaps) {
    const deviceEnd = device.startU + device.heightU - 1
    const intersects = !(endU < device.startU || startU > deviceEnd)
    const existingRackSlot = normalizeRackSlot(device.rackSlot)
    if (intersects && rackSlotsConflict(rackSlot, existingRackSlot)) {
      throw new ValidationError(`Rack position overlaps with ${device.hostname}.`)
    }
  }

  return {
    rackId: input.rackId,
    startU,
    heightU,
    face,
    rackSlot,
  }
}
