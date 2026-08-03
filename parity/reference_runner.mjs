/**
 * Parity runner — REFERENCE side (independent oracle, in Node).
 *
 * This is an independent implementation of the audit's agreed counting rules,
 * written from the prototype's structure but NOT importing any backend code, so
 * that agreement with backend/app/services proves the two arrived at the same
 * numbers independently.
 *
 * GROUPING is identical to prototype/option1-ui.html: each person's access is
 * split into a Direct-assignment group plus one group per position, then by app
 * (domain), then permission.
 *
 * CASCADE — DELIBERATE DIVERGENCE FROM THE PROTOTYPE (decision: "Path A").
 * The original prototype cascaded an "Access" revocation across a whole
 * (person, app), sweeping in position-inherited access. We chose the narrower,
 * more audit-accurate scope: an "Access" revocation cascades only within its
 * own (person, group, app), so revoking a DIRECT grant never silently revokes
 * access the person still holds through a POSITION. This runner encodes that
 * chosen behavior and is the oracle the backend must match.
 *
 * Fed the same VALID rows the backend keeps (PermissionSource is one of the two
 * real values); the backend's extra junk-row cleanup is verified separately.
 *
 * Usage: node reference_runner.mjs /abs/path/to/JulyPermissions.csv
 */
import { readFileSync } from 'node:fs'

const VALID_SOURCES = new Set(['Position-Based', 'Direct Assignment'])
const isAccess = (name) => String(name).trim().toLowerCase() === 'access'

// ── the prototype's CSV parser, verbatim ────────────────────────────────────
function parseCSV(text) {
  const rows = []; let i = 0, f = '', row = [], q = false
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  while (i < text.length) {
    const c = text[i]
    if (q) { if (c == '"') { if (text[i + 1] == '"') { f += '"'; i++ } else q = false } else f += c }
    else { if (c == '"') q = true; else if (c == ',') { row.push(f); f = '' } else if (c == '\n') { row.push(f); rows.push(row); row = []; f = '' } else f += c }
    i++
  }
  if (f.length || row.length) { row.push(f); rows.push(row) }
  if (!rows.length) return []
  const head = rows[0].map((h) => h.trim())
  return rows.slice(1).filter((r) => r.some((x) => x && x.trim()))
    .map((r) => { const o = {}; head.forEach((h, j) => (o[h] = (r[j] || '').trim())); return o })
}

// A leaf carries what a scenario rule needs, plus the (person, group, app) key
// the cascade is scoped to. group = source, plus position for position-based
// (mirrors the backend: one Direct group, one group per position).
function buildLeaves(rows) {
  const leaves = []
  for (const r of rows) {
    if (!VALID_SOURCES.has(r.PermissionSource)) continue
    const groupKey = r.PermissionSource === 'Position-Based'
      ? `${r.StaffId}|Position-Based|${r.PositionName}`
      : `${r.StaffId}|Direct Assignment`
    leaves.push({
      person: r.StaffId,
      source: r.PermissionSource,
      domain: r.DomainName,
      name: r.PermissionName,
      // full app scope for the cascade: group + domain
      appKey: `${groupKey}|${r.DomainName}`,
    })
  }
  return leaves
}

// ── scenarios: leaf -> raw decision ('keep' | 'revoke' | null) ──────────────
const SCENARIOS = {
  keep_all: () => 'keep',
  keep_access_revoke_rest: (l) => (isAccess(l.name) ? 'keep' : 'revoke'),
  revoke_all_access: (l) => (isAccess(l.name) ? 'revoke' : null),
  revoke_all_direct: (l) => (l.source === 'Direct Assignment' ? 'revoke' : null),
}

// Apply raw rule, then the chosen cascade (per person+group+app), then tally.
function runScenario(leaves, rule) {
  const raw = leaves.map(rule)

  // apps (person+group+domain) whose "Access" is revoked
  const cascadeApps = new Set()
  leaves.forEach((l, i) => {
    if (isAccess(l.name) && raw[i] === 'revoke') cascadeApps.add(l.appKey)
  })

  let kept = 0, revoked = 0, none = 0
  leaves.forEach((l, i) => {
    let d = raw[i]
    if (cascadeApps.has(l.appKey)) d = 'revoke'
    if (d === 'keep') kept++
    else if (d === 'revoke') revoked++
    else none++
  })
  return { kept, revoked, no_decision: none, total: leaves.length }
}

const csvPath = process.argv[2]
if (!csvPath) { console.error('usage: node reference_runner.mjs <csv>'); process.exit(2) }

const text = readFileSync(csvPath, 'latin1') // cp1252; latin1 covers bytes present
const leaves = buildLeaves(parseCSV(text))

const out = {}
for (const [name, rule] of Object.entries(SCENARIOS)) out[name] = runScenario(leaves, rule)
console.log(JSON.stringify(out, null, 2))
