/**
 * Synthetic dataset that mirrors the real CSV's column structure and the two
 * PermissionSource values the backend emits. Generated deterministically (a
 * seeded RNG) so the mock returns the same data every run — stable for
 * eyeballing and for later snapshot tests.
 */
import type { StaffRow } from '../types/api'

/** domain (app) → the permissions it contains. "Access" is always first. */
const APPS: Record<string, string[]> = {
  'Staff Portal': ['Access', 'Edit Profile', 'View Directory'],
  'Clinic Editor': ['Access', 'Read: All Clinics', 'Edit Clinic Settings'],
  'Patient Editor': ['Access', 'View Patient', 'Edit Patient', 'Delete Patient'],
  'Scheduling': ['Access', 'Book Appointment', 'Cancel Appointment'],
  'Billing': ['Access', 'View Invoices', 'Post Payments', 'Issue Refund'],
  'Reporting': ['Access', 'Run Reports', 'Export Data'],
  'Admin Console': ['Access', 'Manage Users', 'Manage Roles', 'Audit Log'],
}

/** position → the apps its holders inherit. */
const POSITIONS: Record<string, string[]> = {
  'Team Lead': ['Staff Portal', 'Clinic Editor', 'Reporting'],
  'Patient Support': ['Patient Editor', 'Scheduling', 'Staff Portal'],
  'Clinician': ['Patient Editor', 'Scheduling'],
  'Front Desk': ['Scheduling', 'Staff Portal'],
  'Billing Specialist': ['Billing', 'Reporting'],
  'Administrator': ['Admin Console', 'Reporting', 'Staff Portal'],
}

const FIRST = ['Amber', 'Jordan', 'Priya', 'Marcus', 'Elena', 'Tyler', 'Aisha',
  'Diego', 'Nina', 'Grace', 'Omar', 'Lena', 'Cole', 'Maya', 'Ravi']
const LAST = ['Reyes', 'Kapoor', 'Nolan', 'Ford', 'Chen', 'Okafor', 'Santos',
  'Bauer', 'Ellis', 'Kim', 'Haddad', 'Novak', 'Pratt', 'Singh', 'Diaz']

/** Tiny seeded PRNG (mulberry32) — deterministic across runs. */
function mulberry32(seed: number): () => number {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function buildFixtureRows(): StaffRow[] {
  const rnd = mulberry32(20260728)
  const rows: StaffRow[] = []
  const posNames = Object.keys(POSITIONS)
  const appNames = Object.keys(APPS)
  let sid = 4000
  const N = 14

  for (let u = 0; u < N; u++) {
    const id = 'S' + sid++
    const first = FIRST[u % FIRST.length]
    const last = LAST[(u * 2 + 3) % LAST.length]
    const name = `${first} ${last}`
    const email = `${first}.${last}`.toLowerCase() + '@catapulthealth.com'

    // 1–2 positions per person.
    const count = 1 + Math.floor(rnd() * 2)
    const mine = [...posNames].sort(() => rnd() - 0.5).slice(0, count)
    const primary = mine[0]

    // Position-based (inherited) rows.
    for (const pos of mine) {
      for (const app of POSITIONS[pos]) {
        APPS[app].forEach((perm, i) => {
          if (i === 0 || rnd() < 0.6) {
            rows.push({
              StaffId: id, StaffName: name, StaffEmailAddress: email,
              DomainName: app, PermissionName: perm, PositionName: pos,
              PermissionSource: 'Position-Based',
            })
          }
        })
      }
    }

    // Most people also have some hand-granted (direct) access — the rows an
    // auditor most wants to review.
    if (rnd() < 0.75) {
      const app = appNames[Math.floor(rnd() * appNames.length)]
      APPS[app].forEach((perm, i) => {
        if (i === 0 || rnd() < 0.5) {
          rows.push({
            StaffId: id, StaffName: name, StaffEmailAddress: email,
            DomainName: app, PermissionName: perm, PositionName: primary,
            PermissionSource: 'Direct Assignment',
          })
        }
      })
    }
  }

  return rows
}
