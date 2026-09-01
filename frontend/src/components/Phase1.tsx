/**
 * Phase 1 — IT setup: load the report, define the audit (department + period),
 * then pick the people to review and optionally highlight permissions of
 * interest. Highlights are keyed by the audit-tree permission ids, so they
 * carry straight into the manager screen.
 */
import { memo, useMemo, useState } from 'react' 
import type { AuditPerson } from '../types/api'
import { useAudit } from '../state/AuditContext'
import PermissionSearch from './PermissionSearch'
import { api, usingMocks } from '../services/api'
import { collectPermIds } from '../lib/cascade'
import { MONTHS } from '../lib/format'
import { downloadBlob, slug } from '../lib/download'
import { Button, Panel, PanelHead, Pill } from './ui'

function UploadPanel() {
  const { state, uploadFile } = useAudit()
  const up = state.upload
  return (
    <Panel>
      <PanelHead title="1 · Load the report" sub="Upload the monthly organization export, or load sample data to explore." />
      <div className="flex gap-2.5 items-center flex-wrap my-3.5">
        <label className="inline-flex items-center gap-2 rounded-lg font-semibold border border-line bg-white px-4 py-2 cursor-pointer hover:border-[#c4cad6]">
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void uploadFile(f)
            }}
          />
          Upload CSV
        </label>
        {/* Mock-only: this posts a zero-byte File, which the real backend
            correctly rejects as an empty CSV. Hidden when live. */}
        {usingMocks && (
          <Button variant="ghost" onClick={() => void uploadFile(new File([], 'sample-data.csv'))}>
            Load sample data
          </Button>
        )}
        <span className="text-muted text-[13px]">
          {state.loading ? 'Loading…'
            : up ? <><strong>{up.row_count}</strong> rows · <strong>{state.users.length}</strong> users loaded · {up.rows_dropped} junk rows dropped</>
            : 'No data loaded.'}
        </span>
      </div>
      {up && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(up.source_breakdown).map(([k, v]) => (
            <Pill key={k} tone={k === 'Direct Assignment' ? 'flag' : 'default'}>{k}: {v}</Pill>
          ))}
        </div>
      )}
      {state.error && (
        <div
          role="alert"
          className={`mt-3 rounded-lg border px-3.5 py-2.5 text-[13px] ${
            state.sessionLost
              ? 'border-[#f0cf9b] bg-flag-soft text-flag'
              : 'border-[#f1c4c0] bg-[#fdf4f3] text-revoke'
          }`}
        >
          <strong className="font-semibold">
            {state.sessionLost ? 'Session expired — re-upload to continue' : 'Something went wrong'}
          </strong>
          <div className="mt-0.5">{state.error}</div>
        </div>
      )}
      {state.recovery && (
        <div role="status" className="mt-2 rounded-lg border border-[#f0cf9b] bg-flag-soft px-3.5 py-2.5 text-[13px] text-flag">
          Holding {Object.keys(state.recovery.decisions).length} decision(s) and{' '}
          {state.recovery.selected.length} selected {state.recovery.selected.length === 1 ? 'person' : 'people'} from{' '}
          <strong>{state.recovery.filename}</strong> — upload that same file again and the audit
          picks up where it left off.
        </div>
      )}
      {state.recovered && (
        <div role="status" className="mt-3 rounded-lg border border-[#bcd0ff] bg-brand-soft px-3.5 py-2.5 text-[13px] text-brand-ink">
          <strong className="font-semibold">Audit restored.</strong>{' '}
          Your previous selection and decisions were re-applied to this upload.
        </div>
      )}
    </Panel>
  )
}

function DefineAuditPanel() {
  const { state, setDept, setManager, setPeriod } = useAudit()
  const thisYear = new Date().getFullYear()
  const years = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1]
  return (
    <Panel>
      <PanelHead title="2 · Define this audit" sub="Name the department under review and the month it covers." />
      <div className="flex gap-4 flex-wrap">
        <div className="flex-1 min-w-45">
          <label className="field-label" htmlFor="dept">Department under audit</label>
          <input id="dept" className="field-input" placeholder="e.g. Patient Support"
            value={state.dept} onChange={(e) => setDept(e.target.value)} />
        </div>
        <div className="flex-1 min-w-45">
          <label className="field-label" htmlFor="month">Audit month</label>
          <select id="month" className="field-input" value={state.month}
            onChange={(e) => setPeriod(Number(e.target.value), state.year)}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-45">
          <label className="field-label" htmlFor="year">Year</label>
          <select id="year" className="field-input" value={state.year}
            onChange={(e) => setPeriod(state.month, Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-45">
          <label className="field-label" htmlFor="mgr">Manager (optional)</label>
          <input id="mgr" className="field-input" placeholder="e.g. Jane Doe"
            value={state.managerName} onChange={(e) => setManager(e.target.value)} />
        </div>
      </div>
    </Panel>
  )
}

const HighlightTree = memo(function HighlightTree({ person }: { person: AuditPerson }) {
  const { state, toggleHighlight, setHighlightNote } = useAudit()
  if (!person.found) return <p className="text-muted text-[13px] px-2 py-1">Not found in the loaded data.</p>

  return (
    <div className="pl-2">
      {person.groups.map((g) => (
        <details key={g.label} open className="border-l-2 border-[#eef0f5] my-1 pl-2">
          <summary className="py-1.5">
            <span className={`font-semibold text-sm ${g.key === 'direct' ? 'text-flag' : 'text-brand-ink'}`}>{g.label}</span>
          </summary>
          <div className="pl-4">
            {g.apps.map((a) => (
              <details key={a.domain} className="border-l-2 border-[#eef0f5] my-1 pl-2">
                <summary className="py-1.5">
                  <span className="font-semibold text-sm">{a.domain}</span>
                  <span className="text-[11px] text-muted bg-[#eef1f6] rounded-full px-2 py-0.5 ml-2">{a.permissions.length}</span>
                </summary>
                <div>
                  {a.permissions.map((perm) => {
                    const hl = perm.id in state.highlights
                    return (
                      <div key={perm.id} className={`flex items-center gap-2.5 py-1.5 px-2 rounded-md flex-wrap ${hl ? 'bg-flag-soft shadow-[inset_3px_0_0_var(--color-flag)]' : ''}`}>
                        <div className="flex-1 min-w-42">
                          <span className="font-medium">{perm.name}</span>
                          <span className="block text-xs text-muted">{perm.source}</span>
                        </div>
                        <button
                          className={`text-xs border rounded-md px-2.5 py-1 font-semibold ${hl ? 'bg-flag-soft border-[#f0cf9b] text-flag' : 'bg-white border-line text-muted'}`}
                          onClick={() => toggleHighlight(perm.id)}
                        >
                          {hl ? '★ Highlighted' : '☆ Highlight'}
                        </button>
                        {hl && (
                          <input
                            className="basis-full mt-1 field-input"
                            placeholder="Note for the manager (optional)"
                            value={state.highlights[perm.id] ?? ''}
                            onChange={(e) => setHighlightNote(perm.id, e.target.value)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  )
})

const UserCard = memo(function UserCard({ name }: { name: string }) {
  const { state, toggleSelect } = useAudit()
  const user = state.users.find((u) => u.name === name)!
  const person = state.treeCache[name]
  const selected = state.selected.includes(name)
  const [open, setOpen] = useState(false)
  const hlCount = useMemo(() => {
    if (!person) return 0
    const ids = new Set(collectPermIds(person))
    return Object.keys(state.highlights).filter((id) => ids.has(id)).length
  }, [person, state.highlights])

  return (
    <details 
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={`border rounded-xl mb-2.5 bg-white overflow-hidden ${selected ? 'border-[#bcd0ff] bg-[#fbfcff]' : 'border-line'}`}
    >  
      <summary className="px-3.5 py-3 hover:bg-[#fafbfe]">
        <input
          type="checkbox"
          className="w-[18px] h-[18px] flex-none"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleSelect(name)}
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">{user.name}</div>
          <div className="text-xs text-muted">{user.email} · {user.permCount} permissions</div>
        </div>
        {hlCount > 0 && <Pill tone="flag">{hlCount} highlighted</Pill>}
      </summary>
      <div className="px-3 pb-3 pt-0.5">
        {open && (person
          ? <HighlightTree person={person} />
          : <p className="text-muted text-[13px]">No tree available.</p>)}
      </div>
    </details>
  )
}) 

function SelectUsersPanel() {
  const { state, selectMany, clearSelect } = useAudit()
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState('')

  const allPositions = useMemo(
    () => [...new Set(state.users.flatMap((u) => u.positions))].sort(),
    [state.users],
  )

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim()
    return state.users
      .filter((u) => {
        if (state.selected.includes(u.name)) return true // selected always visible
        if (posFilter && !u.positions.includes(posFilter)) return false
        if (q && !`${u.name} ${u.email} ${u.positions.join(' ')}`.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) =>
        (Number(state.selected.includes(b.name)) - Number(state.selected.includes(a.name))) ||
        a.name.localeCompare(b.name))
  }, [state.users, state.selected, search, posFilter])

  return (
    <>
      <p className="text-muted text-[13px] mt-0 mb-3.5">
        Selected people stay pinned to the top. Expand a user to flag permissions that need a closer look.
      </p>    
      <div className="flex gap-2.5 items-center flex-wrap mb-3.5">
        <input className="field-input max-w-70" placeholder="Search name, email, position…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="field-input max-w-52" value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
          <option value="">All positions</option>
          {allPositions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Button size="sm" onClick={() => selectMany(visible.map((u) => u.name))}>Select all shown</Button>
        <Button size="sm" onClick={clearSelect}>Clear</Button>
      </div>
      {state.users.length === 0
        ? <div className="bg-[#fbfbfd] border border-dashed border-line rounded-lg px-3.5 py-3 text-[13px] text-muted">Load data to see users.</div>
        : visible.length === 0
          ? <div className="bg-[#fbfbfd] border border-dashed border-line rounded-lg px-3.5 py-3 text-[13px] text-muted">No users match.</div>
          : visible.map((u) => <UserCard key={u.name} name={u.name} />)}
    </>
  )
}

export default function Phase1() {
  const { state, periodLabel, startAudit, guard } = useAudit()
  const canLock = state.selected.length > 0 && state.dept.trim().length > 0
  const [tab, setTab] = useState<'users' | 'search'>('users')

  const tabClass = (on: boolean) =>
    `text-[13px] font-semibold rounded-full px-3.5 py-1.5 border ${
      on ? 'bg-brand-soft border-[#bcd0ff] text-brand-ink' : 'bg-white border-line text-muted hover:border-[#c4cad6]'
    }`

  // Note: /api/export is the one endpoint keyed by StaffId, not StaffName —
  // hence the staffIds hop. Wrapped in guard() so a failure (or a lost backend
  // session) surfaces in the banner instead of an unhandled rejection.
  const exportCsv = () => guard(async () => {
    const ids = state.users.filter((u) => state.selected.includes(u.name)).flatMap((u) => u.staffIds)
    const blob = await api.exportCsv({
      staff_ids: ids,
      department: `${state.dept} - ${periodLabel}`,
      audit_date: null,
    })
    downloadBlob(blob, `audit-${slug(state.dept)}.csv`)
  })

  return (
    <section>
      <UploadPanel />
      <DefineAuditPanel />
      <Panel>
        <div className="flex items-center gap-2.5 flex-wrap mb-3">
          <span className="font-semibold">3 ·</span>
          <button className={tabClass(tab === 'users')} onClick={() => setTab('users')}>
            Select users &amp; highlight points of interest
          </button>
          <button className={tabClass(tab === 'search')} onClick={() => setTab('search')}>
            Permission search
          </button>
          <span className="ml-auto"><Pill tone="brand">{state.selected.length} selected</Pill></span>
        </div>
        {tab === 'users' ? <SelectUsersPanel /> : <PermissionSearch />}
      </Panel>
      <div className="sticky bottom-0 pt-3.5 mt-2">
        <Panel className="mb-0">
          <div className="flex justify-between items-center gap-3.5 flex-wrap">
            <div>
              <strong>Ready to hand off?</strong>
              <p className="text-muted text-[13px] mt-0.5 mb-0">
                Locking opens the manager audit for the {state.selected.length} selected {state.selected.length === 1 ? 'person' : 'people'}.
              </p>
            </div>
            <div className="flex gap-2.5">
              <Button onClick={() => void exportCsv()} disabled={state.selected.length === 0}>Export CSV</Button>
              <Button variant="primary" disabled={!canLock} onClick={startAudit}>
                Lock setup & start manager audit →
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </section>
  )
}
