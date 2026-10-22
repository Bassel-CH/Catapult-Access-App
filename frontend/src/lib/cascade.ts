/**
 * The Access rule and the decision helpers built on it, kept free of React.
 *
 * Within one app, inside one group, revoking "Access" revokes the rest of the
 * app and locks it until Access is set back. A direct grant and access through
 * a position are separate groups ("Path A" in docs/decisions.md).
 *
 * This copy only gives instant feedback; the backend's report_service.py is
 * the record, and the two must agree.
 */
import type { AuditPerson, AuditDecision } from '../types/api'

export type DecisionMap = Record<string, AuditDecision>

/** True if this permission is an app's master "Access" toggle. */
export function isAccess(name: string): boolean {
  return name.trim().toLowerCase() === 'access'
}

interface PermIndexEntry {
  name: string
  /** All permission ids in the same app (same group + domain), including self. */
  appPermIds: string[]
  /** The "Access" permission id for this app, if the app has one. */
  accessId: string | null
}

/** Flat index: permission id → its app context. Cheap to rebuild on demand. */
export function indexTree(people: AuditPerson[]): Map<string, PermIndexEntry> {
  const idx = new Map<string, PermIndexEntry>()
  for (const person of people) {
    for (const group of person.groups) {
      for (const app of group.apps) {
        const appPermIds = app.permissions.map((p) => p.id)
        const access = app.permissions.find((p) => isAccess(p.name))
        const accessId = access ? access.id : null
        for (const perm of app.permissions) {
          idx.set(perm.id, { name: perm.name, appPermIds, accessId })
        }
      }
    }
  }
  return idx
}

/**
 * Apply one Keep/Revoke click and return a new decisions map. Clicking the
 * active choice again clears it; revoking Access revokes the rest of its app.
 */
export function applyDecision(
  people: AuditPerson[],
  decisions: DecisionMap,
  permId: string,
  value: 'keep' | 'revoke',
): DecisionMap {
  const idx = indexTree(people)
  const current = decisions[permId]?.decision ?? null
  const next = current === value ? null : value

  const out: DecisionMap = {
    ...decisions,
    [permId]: { ...decisions[permId], decision: next },
  }

  const entry = idx.get(permId)
  if (entry && next === 'revoke' && isAccess(entry.name)) {
    for (const sib of entry.appPermIds) {
      out[sib] = { ...out[sib], decision: 'revoke' }
    }
  }
  return out
}

/** Set the same decision on many permissions at once (bulk Keep/Revoke all). */
export function applyBulk(
  decisions: DecisionMap,
  permIds: string[],
  value: 'keep' | 'revoke',
): DecisionMap {
  const out: DecisionMap = { ...decisions }
  for (const id of permIds) {
    out[id] = { ...out[id], decision: value }
  }
  return out
}

/** Ids that are locked because their app's Access is currently revoked. */
export function computeLocked(
  people: AuditPerson[],
  decisions: DecisionMap,
): Set<string> {
  const locked = new Set<string>()
  for (const person of people) {
    for (const group of person.groups) {
      for (const app of group.apps) {
        const access = app.permissions.find((p) => isAccess(p.name))
        if (!access) continue
        if (decisions[access.id]?.decision === 'revoke') {
          for (const perm of app.permissions) {
            if (!isAccess(perm.name)) locked.add(perm.id)
          }
        }
      }
    }
  }
  return locked
}

/** All permission ids under a set of apps/groups/people (any depth). */
export function collectPermIds(
  source: AuditPerson | AuditPerson['groups'][number] | AuditPerson['groups'][number]['apps'][number],
): string[] {
  if ('permissions' in source) return source.permissions.map((p) => p.id) // app
  if ('apps' in source) return source.apps.flatMap((a) => a.permissions.map((p) => p.id)) // group
  return source.groups.flatMap((g) => g.apps.flatMap((a) => a.permissions.map((p) => p.id))) // person
}

/** Count how many of the given ids have a decision (keep or revoke). */
export function countDecided(ids: string[], decisions: DecisionMap): number {
  let n = 0
  for (const id of ids) if (decisions[id]?.decision) n++
  return n
}

/** 'keep' if every id is kept, 'revoke' if every id is revoked, else null. */
export function scopeState(ids: string[], decisions: DecisionMap): 'keep' | 'revoke' | null {
  if (!ids.length) return null
  let allKeep = true
  let allRevoke = true
  for (const id of ids) {
    const d = decisions[id]?.decision
    if (d !== 'keep') allKeep = false
    if (d !== 'revoke') allRevoke = false
  }
  return allKeep ? 'keep' : allRevoke ? 'revoke' : null
}
