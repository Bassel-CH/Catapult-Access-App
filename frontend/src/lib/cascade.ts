/**
 * Selectors + the "Access-cascade" business rule, kept separate from React so
 * they are easy to reason about and unit-test later.
 *
 * The rule: within one app (one domain, inside one group), the "Access"
 * permission is the master switch. Revoking Access implies every other
 * permission in that app is revoked too, and those siblings become locked
 * (can't be edited) until Access is set back to Keep.
 *
 * SCOPE (decision "Path A"): the cascade is confined to a single
 * (person, group, app) — revoking a DIRECT grant's Access does NOT touch access
 * the person also holds to the same app via a POSITION. This deliberately
 * diverges from the original prototype's broader (person, app) sweep, and must
 * stay consistent with backend report_service.py — parity/compare_backend_to_reference.py
 * guards that both agree.
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
 * Apply one Keep/Revoke click, returning a NEW decisions map.
 * Clicking the active choice again clears it (toggle to undecided), matching
 * the prototype. Revoking an app's Access cascades revoke to its siblings.
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
