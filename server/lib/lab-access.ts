import type { FastifyReply, FastifyRequest } from 'fastify'
import { db } from '../db.js'
import type { AuthUser } from './auth.js'
import { requireAuth } from './auth.js'

export const LAB_ROLES = ['editor', 'viewer'] as const
export type LabRole = (typeof LAB_ROLES)[number]

export interface LabAccessEntry {
  labId: string
  role: LabRole
}

export function isGlobalAdmin(user: AuthUser | null | undefined) {
  return user?.role === 'admin'
}

export function parseLabRole(value: unknown): LabRole | null {
  if (value === 'editor' || value === 'viewer') return value
  return null
}

export function fetchUserLabAccess(userId: string): LabAccessEntry[] {
  const rows = db
    .prepare('SELECT labId, role FROM userLabAccess WHERE userId = ? ORDER BY labId')
    .all(userId) as Array<{ labId: string; role: string }>

  return rows
    .map((row) => {
      const role = parseLabRole(row.role)
      if (!role) return null
      return { labId: String(row.labId), role }
    })
    .filter((entry): entry is LabAccessEntry => entry != null)
}

export function replaceUserLabAccess(userId: string, entries: LabAccessEntry[]) {
  const normalized = new Map<string, LabRole>()
  for (const entry of entries) {
    normalized.set(entry.labId, entry.role)
  }

  const replace = db.transaction((nextEntries: LabAccessEntry[]) => {
    db.prepare('DELETE FROM userLabAccess WHERE userId = ?').run(userId)
    const insert = db.prepare(
      'INSERT INTO userLabAccess (userId, labId, role) VALUES (?, ?, ?)',
    )
    for (const entry of nextEntries) {
      insert.run(userId, entry.labId, entry.role)
    }
  })

  replace([...normalized.entries()].map(([labId, role]) => ({ labId, role })))
}

export function backfillLabAccessForUser(userId: string, role: LabRole) {
  const labs = db.prepare('SELECT id FROM labs').all() as Array<{ id: string }>
  replaceUserLabAccess(
    userId,
    labs.map((lab) => ({ labId: lab.id, role })),
  )
}

export function getAccessibleLabIds(user: AuthUser, labAccess: LabAccessEntry[]): string[] | null {
  if (isGlobalAdmin(user)) return null
  return labAccess.map((entry) => entry.labId)
}

export function getLabRole(
  user: AuthUser,
  labId: string,
  labAccess: LabAccessEntry[],
): LabRole | 'admin' | null {
  if (isGlobalAdmin(user)) return 'admin'
  const entry = labAccess.find((item) => item.labId === labId)
  return entry?.role ?? null
}

export function canReadLab(user: AuthUser, labId: string, labAccess: LabAccessEntry[]) {
  return getLabRole(user, labId, labAccess) != null
}

export function canWriteLab(user: AuthUser, labId: string, labAccess: LabAccessEntry[]) {
  const role = getLabRole(user, labId, labAccess)
  return role === 'admin' || role === 'editor'
}

export function canEditLab(
  user: AppUserLike | null,
  labId: string,
  labAccess: LabAccessEntry[] = user?.labAccess ?? [],
) {
  if (!user) return false
  if (user.role === 'admin') return true
  const entry = labAccess.find((item) => item.labId === labId)
  return entry?.role === 'editor'
}

interface AppUserLike {
  id: string
  role: AuthUser['role']
  labAccess?: LabAccessEntry[]
}

export type LabListFilter =
  | { ok: true; labIds: string[] | null }
  | { ok: false; status: number; error: string }

export function resolveLabIdsForList(
  user: AuthUser,
  labAccess: LabAccessEntry[],
  requestedLabId?: string,
): LabListFilter {
  const accessible = getAccessibleLabIds(user, labAccess)

  if (accessible === null) {
    return { ok: true, labIds: requestedLabId ? [requestedLabId] : null }
  }

  if (accessible.length === 0) {
    return { ok: false, status: 403, error: 'You do not have access to any labs.' }
  }

  if (requestedLabId) {
    if (!accessible.includes(requestedLabId)) {
      return { ok: false, status: 403, error: 'You do not have access to this lab.' }
    }
    return { ok: true, labIds: [requestedLabId] }
  }

  return { ok: true, labIds: accessible }
}

export function labIdInClause(labIds: string[] | null, column = 'labId') {
  if (labIds === null) {
    return { clause: '', params: [] as string[] }
  }
  if (labIds.length === 0) {
    return { clause: '1 = 0', params: [] as string[] }
  }
  const placeholders = labIds.map(() => '?').join(', ')
  return {
    clause: `${column} IN (${placeholders})`,
    params: labIds,
  }
}

export function appendLabFilter(
  sql: string,
  params: unknown[],
  labIds: string[] | null,
  column = 'labId',
) {
  const { clause, params: labParams } = labIdInClause(labIds, column)
  if (!clause) {
    return { sql, params }
  }

  const hasWhere = /\bwhere\b/i.test(sql)
  const nextSql = `${sql}${hasWhere ? ' AND ' : ' WHERE '}${clause}`
  return { sql: nextSql, params: [...params, ...labParams] }
}

export function assertLabRead(
  req: FastifyRequest,
  reply: FastifyReply,
  labId: string,
): req is FastifyRequest & { authUser: AuthUser; labAccess: LabAccessEntry[] } {
  if (!requireAuth(req, reply)) return false
  if (!canReadLab(req.authUser, labId, req.labAccess ?? [])) {
    void reply.status(403).send({ error: 'You do not have access to this lab.' })
    return false
  }
  return true
}

export function assertLabWrite(
  req: FastifyRequest,
  reply: FastifyReply,
  labId: string,
): req is FastifyRequest & { authUser: AuthUser; labAccess: LabAccessEntry[] } {
  if (!requireAuth(req, reply)) return false
  if (!canWriteLab(req.authUser, labId, req.labAccess ?? [])) {
    void reply.status(403).send({ error: 'You do not have write access to this lab.' })
    return false
  }
  return true
}

export function assertGlobalAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): req is FastifyRequest & { authUser: AuthUser; labAccess: LabAccessEntry[] } {
  if (!requireAuth(req, reply)) return false
  if (!isGlobalAdmin(req.authUser)) {
    void reply.status(403).send({ error: 'Administrator access is required.' })
    return false
  }
  return true
}

export function assertLabReadFromRow(
  req: FastifyRequest,
  reply: FastifyReply,
  row: Record<string, unknown> | undefined,
  labColumn = 'labId',
) {
  if (!row) {
    void reply.status(404).send({ error: 'Not found.' })
    return false
  }
  return assertLabRead(req, reply, String(row[labColumn]))
}

export function assertLabWriteFromRow(
  req: FastifyRequest,
  reply: FastifyReply,
  row: Record<string, unknown> | undefined,
  labColumn = 'labId',
) {
  if (!row) {
    void reply.status(404).send({ error: 'Not found.' })
    return false
  }
  return assertLabWrite(req, reply, String(row[labColumn]))
}

export function listLabAccessForUsers(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, LabAccessEntry[]>()

  const placeholders = userIds.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT userId, labId, role FROM userLabAccess WHERE userId IN (${placeholders}) ORDER BY labId`)
    .all(...userIds) as Array<{ userId: string; labId: string; role: string }>

  const grouped = new Map<string, LabAccessEntry[]>()
  for (const row of rows) {
    const role = parseLabRole(row.role)
    if (!role) continue
    const list = grouped.get(row.userId) ?? []
    list.push({ labId: String(row.labId), role })
    grouped.set(row.userId, list)
  }
  return grouped
}
