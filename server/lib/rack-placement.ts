import { db } from '../db.js'
import { ValidationError } from './validation.js'
import { currentRackStudioPlacement, placementConflict, type RackStudioDeviceRow } from './rack-studio-placement-core.js'

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
    SELECT *
    FROM devices
    WHERE rackId = ?
      AND COALESCE(face, 'front') = ?
      AND startU IS NOT NULL
      AND heightU IS NOT NULL
      AND COALESCE(rackMountKind, 'direct') = 'direct'
      AND id != COALESCE(?, '')
  `).all(input.rackId, face, input.deviceId ?? null) as RackStudioDeviceRow[]

  const column = rackSlot === 'right' ? 6 : 0
  const columnSpan = rackSlot === 'full' ? 12 : 6

  for (const device of overlaps) {
    const existing = currentRackStudioPlacement(device)
    if (existing.startU === null || existing.heightU === null || existing.column === null || existing.columnSpan === null) continue
    const existingEndU = existing.startU + existing.heightU - 1
    const uOverlap = !(endU < existing.startU || startU > existingEndU)
    const columnOverlap = column < existing.column + existing.columnSpan && column + columnSpan > existing.column
    if (uOverlap && columnOverlap) {
      throw placementConflict(`Rack position overlaps with ${device.hostname}.`, device, 'direct')
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
