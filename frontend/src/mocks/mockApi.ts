/**
 * Mock backend. Implements the same contract as the FastAPI app, entirely in
 * the browser, so the whole three-phase UI works with no server running.
 *
 * Like the real backend, it holds ONE dataset in memory: `upload` loads it,
 * and every later call operates on that loaded dataset (there is no session id
 * in the contract — a single in-memory dataset per process). We reproduce that
 * so the wiring later is a like-for-like swap.
 */
import type {
  UploadResponse, FilterRequest, FilterResponse,
  AuditTreeRequest, AuditTreeResponse, AuditPerson, AuditGroup, AuditApp,
  AuditPermission, GenerateReportRequest, ReportResponse, ReportSummary,
  ReviewDocumentRequest, ExportRequest, StaffRow,
} from '../types/api'
import { buildFixtureRows } from './fixtures'
import { hashId, uniqueSorted } from '../lib/format'

// The single in-memory dataset — the mock equivalent of the server holding the
// uploaded DataFrame.
let dataset: StaffRow[] = []

const COLUMNS = [
  'StaffId', 'StaffName', 'StaffEmailAddress', 'DomainName',
  'PermissionName', 'PositionName', 'PermissionSource',
]

const delay = (ms = 300) => new Promise<void>((r) => setTimeout(r, ms))
const isAccess = (name: string) => name.trim().toLowerCase() === 'access'
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// ── /api/upload ────────────────────────────────────────────────────────────
export async function upload(file: File): Promise<UploadResponse> {
  await delay()
  // A mock: we ignore the uploaded bytes and load the synthetic dataset. (The
  // real backend parses the CSV; here the fixtures ARE the "parsed" result.)
  dataset = buildFixtureRows()

  const source_breakdown: Record<string, number> = {}
  for (const r of dataset) {
    source_breakdown[r.PermissionSource] = (source_breakdown[r.PermissionSource] ?? 0) + 1
  }

  return {
    success: true,
    session_id: 'mock-session',
    filename: file?.name ?? 'sample-data.csv',
    row_count: dataset.length,
    rows_dropped: 2, // pretend we dropped a divider row + the "(N rows affected)" footer
    columns: COLUMNS,
    preview: dataset.slice(0, 10),
    unique_values: {
      staff_names: uniqueSorted(dataset, 'StaffName'),
      permissions: uniqueSorted(dataset, 'PermissionName'),
      domains: uniqueSorted(dataset, 'DomainName'),
      positions: uniqueSorted(dataset, 'PositionName'),
    },
    source_breakdown,
  }
}

// ── /api/filter ─────────────────────────────────────────────────────────────
export async function filter(req: FilterRequest): Promise<FilterResponse> {
  await delay(150)
  let data = dataset.slice()
  const inSet = (val: string, list?: string[] | null) => !list?.length || list.includes(val)

  data = data.filter((r) =>
    inSet(r.StaffName, req.staff_names) &&
    inSet(r.PermissionName, req.permissions) &&
    inSet(r.DomainName, req.domains) &&
    inSet(r.PositionName, req.positions) &&
    inSet(r.PermissionSource, req.permission_sources))

  if (req.search_text) {
    const q = req.search_text.toLowerCase()
    data = data.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q)))
  }

  return {
    success: true,
    data,
    total_rows: dataset.length,
    filtered_rows: data.length,
  }
}

// ── /api/audit-tree ─────────────────────────────────────────────────────────
function buildGroup(
  name: string, source: 'Direct Assignment' | 'Position-Based',
  label: string, position: string | null, rows: StaffRow[],
): AuditGroup {
  const domains = uniqueSorted(rows, 'DomainName')
  const apps: AuditApp[] = domains.map((domain) => {
    const perms = rows.filter((r) => r.DomainName === domain).map((r) => r.PermissionName).sort()
    const seen: Record<string, number> = {}
    const permissions: AuditPermission[] = perms.map((perm) => {
      const occ = seen[perm] ?? 0
      seen[perm] = occ + 1
      return {
        id: hashId([name, source, position ?? '', domain, perm, occ].join('|')),
        name: perm, domain, source, position: position ?? '',
      }
    })
    return { domain, permissions }
  })
  return {
    key: source === 'Direct Assignment' ? 'direct' : 'position',
    label, position, source, apps,
  }
}

function buildTreeFor(name: string): AuditPerson {
  const rows = dataset.filter((r) => r.StaffName === name)
  if (!rows.length) {
    return {
      staff_name: name, found: false, email: '', groups: [],
      direct_count: 0, inherited_count: 0, permission_count: 0,
    }
  }
  const direct = rows.filter((r) => r.PermissionSource === 'Direct Assignment')
  const inherited = rows.filter((r) => r.PermissionSource === 'Position-Based')
  const groups: AuditGroup[] = []
  // Direct assignments first — the reviewable set.
  if (direct.length) groups.push(buildGroup(name, 'Direct Assignment', 'Direct assignment', null, direct))
  // Then one group per position, for reference.
  for (const pos of uniqueSorted(inherited, 'PositionName')) {
    groups.push(buildGroup(name, 'Position-Based', pos, pos, inherited.filter((r) => r.PositionName === pos)))
  }
  return {
    staff_name: name, found: true, email: rows[0].StaffEmailAddress, groups,
    direct_count: direct.length, inherited_count: inherited.length, permission_count: rows.length,
  }
}

export async function auditTree(req: AuditTreeRequest): Promise<AuditTreeResponse> {
  await delay(200)
  return { success: true, people: req.staff_names.map(buildTreeFor) }
}

// ── /api/report ─────────────────────────────────────────────────────────────
/** Effective decision after the Access-cascade rule is applied (authoritative). */
function effectiveDecisions(people: AuditPerson[], req: GenerateReportRequest) {
  const decisions = req.decisions ?? {}
  const eff = new Map<string, 'keep' | 'revoke' | null>()
  for (const person of people) {
    for (const group of person.groups) {
      for (const app of group.apps) {
        const access = app.permissions.find((p) => isAccess(p.name))
        const accessRevoked = access ? decisions[access.id]?.decision === 'revoke' : false
        for (const perm of app.permissions) {
          const base = decisions[perm.id]?.decision ?? null
          eff.set(perm.id, accessRevoked && !isAccess(perm.name) ? 'revoke' : base)
        }
      }
    }
  }
  return eff
}

export async function report(req: GenerateReportRequest): Promise<ReportResponse> {
  await delay(400)
  const people = req.staff_names.map(buildTreeFor)
  const eff = effectiveDecisions(people, req)
  const decisions = req.decisions ?? {}
  const highlights = req.highlights ?? {}

  let kept = 0, revoked = 0, none = 0, total = 0
  for (const v of eff.values()) {
    total++
    if (v === 'keep') kept++
    else if (v === 'revoke') revoked++
    else none++
  }
  const summary: ReportSummary = {
    users_reviewed: people.length,
    total_permissions: total,
    kept, revoked, no_decision: none,
  }

  const html = renderReportHtml(people, eff, decisions, highlights, req, summary)
  return { success: true, summary, html }
}

// ── /api/review-document (printable packet) ─────────────────────────────────
export async function reviewDocument(req: ReviewDocumentRequest): Promise<string> {
  await delay(300)
  const people = req.staff_names.map(buildTreeFor)
  const flagged = new Set(req.flagged ?? [])
  return renderReviewHtml(people, flagged, req)
}

// ── /api/export (CSV file download) ─────────────────────────────────────────
export async function exportCsv(req: ExportRequest): Promise<Blob> {
  await delay(200)
  const rows = dataset.filter((r) => req.staff_ids.includes(r.StaffId))
  const auditDate = req.audit_date ?? new Date().toISOString().slice(0, 10)
  const header = [...COLUMNS, 'Department', 'AuditDate']
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([
      r.StaffId, r.StaffName, r.StaffEmailAddress, r.DomainName,
      r.PermissionName, r.PositionName, r.PermissionSource,
      req.department, auditDate,
    ].map((v) => cell(String(v))).join(','))
  }
  return new Blob([lines.join('\n')], { type: 'text/csv' })
}

// ── HTML renderers (standalone documents, like the backend's) ───────────────
function pageShell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
body{margin:0;background:#f4f5f7;color:#1f2430;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.5}
.w{max-width:940px;margin:0 auto;padding:28px 20px 70px}h1{font-size:22px;margin:0 0 4px}.sub{color:#6b7280;font-size:13px;margin:0}
.ro{display:inline-block;background:#eef1f6;color:#41485a;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;margin-top:8px}
.ban{display:flex;gap:22px;flex-wrap:wrap;background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:16px;margin:16px 0}
.ban .k{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.03em;font-weight:600}.ban .v{font-weight:600;font-size:15px}
.sum{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px}.sc{flex:1;min-width:120px;background:#fff;border:1px solid #e3e6ec;border-radius:12px;padding:14px}
.sc .n{font-size:24px;font-weight:700}.sc .l{font-size:12px;color:#6b7280}
details{border:1px solid #e3e6ec;border-radius:10px;background:#fff;margin:8px 0}
details.grp,details.app{margin:6px 0;border-color:#eef0f5}
summary{cursor:pointer;padding:11px 14px;display:flex;justify-content:space-between;gap:12px;align-items:center;list-style:none}
summary::-webkit-details-marker{display:none}summary::before{content:"\\25B6";color:#9aa1af;font-size:11px;margin-right:8px;transition:.15s}
details[open]>summary::before{transform:rotate(90deg)}
details.uc>summary{font-weight:600}.uc.fl{border-color:#f0cf9b}
.s-name{flex:1}.mut{color:#6b7280;font-weight:400}.s-l{flex:1;font-weight:600}.grp>summary .s-l{color:#1b3aa8}
.leaf{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:9px 14px 9px 40px;border-top:1px solid #f2f3f7}
.leaf.hl{background:#fdf1e0}.leaf.rev .ln{text-decoration:line-through;color:#6b7280}
.ln{font-weight:500}.src{display:block;font-size:12px;color:#6b7280}.itn{font-size:12px;color:#b45309;margin-top:2px}
.b{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
.b.keep{background:#e5f4ec;color:#127a4b}.b.revoke{background:#fbeaea;color:#b3261e}.b.none{background:#eef1f6;color:#6b7280}.b.fl{background:#fdf1e0;color:#b45309}
.foot{font-size:12px;color:#6b7280;text-align:center;margin-top:26px}
.tb button{font:inherit;font-size:13px;font-weight:600;background:#fff;border:1px solid #e3e6ec;border-radius:8px;padding:6px 12px;cursor:pointer;margin-right:8px}
</style></head><body><div class="w">${body}</div></body></html>`
}

function renderReportHtml(
  people: AuditPerson[], eff: Map<string, 'keep' | 'revoke' | null>,
  decisions: Record<string, { note?: string }>,
  highlights: Record<string, string>,
  req: GenerateReportRequest, summary: ReportSummary,
): string {
  const body = people.map((p) => {
    const groups = p.groups.map((g) => {
      const apps = g.apps.map((a) => {
        const leaves = a.permissions.map((perm) => {
          const d = eff.get(perm.id) ?? null
          const hl = highlights[perm.id] !== undefined
          const note = decisions[perm.id]?.note
          const badge = d === 'keep' ? '<span class="b keep">Keep</span>'
            : d === 'revoke' ? '<span class="b revoke">Revoke</span>'
            : '<span class="b none">No decision</span>'
          return `<div class="leaf${d === 'revoke' ? ' rev' : ''}${hl ? ' hl' : ''}">
<div><span class="ln">${esc(perm.name)}${hl ? ' <span class="b fl">★</span>' : ''}</span>
<span class="src">${esc(perm.source)}${perm.position ? ' · ' + esc(perm.position) : ''}</span>
${hl && highlights[perm.id] ? `<div class="itn">IT: ${esc(highlights[perm.id])}</div>` : ''}
${note ? `<div class="itn">Note: ${esc(note)}</div>` : ''}</div>${badge}</div>`
        }).join('')
        return `<details class="app" open><summary><span class="s-l">${esc(a.domain)}</span></summary>${leaves}</details>`
      }).join('')
      return `<details class="grp" open><summary><span class="s-l">${esc(g.label)}</span></summary>${apps}</details>`
    }).join('')
    return `<details class="uc" open><summary><span class="s-name">${esc(p.staff_name)} <span class="mut">· ${esc(p.email)}</span></span></summary>${groups}</details>`
  }).join('')

  return pageShell(`Catapult Applications Audit — ${req.department ?? ''}`, `
<h1>Catapult Applications Audit — ${esc(req.department ?? '')}</h1>
<p class="sub">Manager review${req.manager_name ? ' · ' + esc(req.manager_name) : ''} · generated ${esc(new Date().toLocaleString())}</p>
<span class="ro">Read-only report</span>
<div class="ban">
<div><div class="k">Department</div><div class="v">${esc(req.department ?? '')}</div></div>
<div><div class="k">Period</div><div class="v">${esc(req.period_label ?? '')}</div></div>
<div><div class="k">Users reviewed</div><div class="v">${summary.users_reviewed}</div></div>
<div><div class="k">Permissions</div><div class="v">${summary.total_permissions}</div></div></div>
<div class="sum">
<div class="sc"><div class="n" style="color:#127a4b">${summary.kept}</div><div class="l">Kept</div></div>
<div class="sc"><div class="n" style="color:#b3261e">${summary.revoked}</div><div class="l">Revoked</div></div>
<div class="sc"><div class="n" style="color:#6b7280">${summary.no_decision}</div><div class="l">No decision</div></div></div>
${body}
<p class="foot">Generated by the mock backend (Phase B). Wire to /api/report for the authoritative document.</p>`)
}

function renderReviewHtml(
  people: AuditPerson[], flagged: Set<string>, req: ReviewDocumentRequest,
): string {
  const body = people.map((p) => {
    const groups = p.groups.map((g) => {
      const apps = g.apps.map((a) => {
        const leaves = a.permissions.map((perm) => {
          const hl = flagged.has(perm.id)
          return `<div class="leaf${hl ? ' hl' : ''}"><div><span class="ln">${esc(perm.name)}${hl ? ' <span class="b fl">★</span>' : ''}</span><span class="src">${esc(perm.source)}</span></div></div>`
        }).join('')
        return `<details class="app" open><summary><span class="s-l">${esc(a.domain)}</span></summary>${leaves}</details>`
      }).join('')
      return `<details class="grp" open><summary><span class="s-l">${esc(g.label)}</span></summary>${apps}</details>`
    }).join('')
    return `<details class="uc" open><summary><span class="s-name">${esc(p.staff_name)} <span class="mut">· ${esc(p.email)}</span></span></summary>${groups}</details>`
  }).join('')

  return pageShell(`Access Review — ${req.audit_label ?? ''}`, `
<h1>Access Review Packet</h1>
<p class="sub">${esc(req.audit_label ?? '')}${req.manager_name ? ' · for ' + esc(req.manager_name) : ''}</p>
<span class="ro">Reference — direct assignments shown first</span>
${body}
<p class="foot">Printable packet (mock). Open in a browser and Save as PDF.</p>`)
}
