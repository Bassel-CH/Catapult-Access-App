/**
 * Phase 2 — Manager audit: expand each person into groups → apps →
 * permissions and Keep/Revoke each one. Bulk actions roll decisions down a
 * subtree; the Access-cascade rule (in lib/cascade + the reducer) auto-revokes
 * and locks an app's other permissions when its Access is revoked.
 */
import { useMemo, useState } from 'react'
import type { AuditApp, AuditGroup, AuditPermission, AuditPerson } from '../types/api'
import { useAudit } from '../state/AuditContext'
import {
  collectPermIds, computeLocked, countDecided, isAccess, scopeState,
} from '../lib/cascade'
import { Button, Panel, PanelHead, Pill } from './ui'

function BulkButtons({ permIds }: { permIds: string[] }) {
  const { state, bulk } = useAudit()
  const stateNow = scopeState(permIds, state.decisions)
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); fn() }
  const cls = (on: boolean, tone: 'keep' | 'revoke') =>
    `text-[11px] px-2 py-0.5 border rounded-md font-semibold ${
      on ? (tone === 'keep' ? 'bg-keep border-keep text-white' : 'bg-revoke border-revoke text-white')
         : 'bg-white border-line text-muted'}`
  return (
    <span className="ml-auto flex gap-1.5">
      <button className={cls(stateNow === 'keep', 'keep')} onClick={stop(() => bulk(permIds, 'keep'))}>Keep all</button>
      <button className={cls(stateNow === 'revoke', 'revoke')} onClick={stop(() => bulk(permIds, 'revoke'))}>Revoke all</button>
    </span>
  )
}

function Rollup({ permIds }: { permIds: string[] }) {
  const { state } = useAudit()
  const decided = countDecided(permIds, state.decisions)
  const done = permIds.length > 0 && decided === permIds.length
  return (
    <span className={`text-[11px] rounded-full px-2 py-0.5 ${done ? 'bg-keep-soft text-keep' : 'bg-[#eef1f6] text-muted'}`}>
      {decided}/{permIds.length}
    </span>
  )
}

function Leaf({ perm, locked }: { perm: AuditPermission; locked: boolean }) {
  const { state, decide, setDecisionNote } = useAudit()
  const dv = state.decisions[perm.id]
  const d = dv?.decision ?? null
  const hl = perm.id in state.highlights
  const disabled = locked && !isAccess(perm.name)

  const segBtn = (val: 'keep' | 'revoke', label: string) => {
    const on = d === val
    const onCls = val === 'keep' ? 'bg-keep text-white' : 'bg-revoke text-white'
    return (
      <button
        disabled={disabled}
        className={`px-3.5 py-1.5 text-[13px] font-semibold ${on ? onCls : 'bg-white text-muted'} disabled:opacity-45`}
        onClick={() => decide(perm.id, val)}
      >
        {label}
      </button>
    )
  }

  return (
    <div className={`flex items-center gap-2.5 py-1.5 px-2 rounded-md flex-wrap ${hl ? 'bg-flag-soft' : ''} ${disabled ? 'opacity-70' : ''}`}>
      <div className="flex-1 min-w-42">
        <span className="font-medium">
          {perm.name}
          {hl && <span className="ml-1.5"><Pill tone="flag">★ IT highlight</Pill></span>}
          {disabled && <span className="ml-1.5 text-[11px] font-semibold text-revoke">· locked</span>}
        </span>
        <span className="block text-xs text-muted">{perm.source}{perm.position ? ` · ${perm.position}` : ''}</span>
        {hl && state.highlights[perm.id] && <div className="text-xs text-flag mt-0.5">IT: {state.highlights[perm.id]}</div>}
      </div>
      <div className="inline-flex border border-line rounded-lg overflow-hidden flex-none divide-x divide-line">
        {segBtn('keep', 'Keep')}
        {segBtn('revoke', 'Revoke')}
      </div>
      <input
        className="basis-full mt-1 field-input"
        placeholder="Note (optional)"
        value={dv?.note ?? ''}
        onChange={(e) => setDecisionNote(perm.id, e.target.value)}
      />
    </div>
  )
}

function AppNode({ app, locked, initialOpen }: { app: AuditApp; locked: Set<string>; initialOpen: boolean }) {
  const ids = app.permissions.map((p) => p.id)
  return (
    <details open={initialOpen} className="border-l-2 border-[#eef0f5] my-1 pl-2">
      <summary className="py-1.5">
        <span className="font-semibold text-sm">{app.domain}</span>
        <span className="text-[11px] text-muted bg-[#eef1f6] rounded-full px-2 py-0.5 ml-2">{app.permissions.length}</span>
        <span className="ml-2"><Rollup permIds={ids} /></span>
        <BulkButtons permIds={ids} />
      </summary>
      <div className="pl-2">
        {app.permissions.map((perm) => <Leaf key={perm.id} perm={perm} locked={locked.has(perm.id)} />)}
      </div>
    </details>
  )
}

function GroupNode({ group, locked, initialOpen }: { group: AuditGroup; locked: Set<string>; initialOpen: boolean }) {
  const ids = collectPermIds(group)
  return (
    <details open={initialOpen} className="border-l-2 border-[#eef0f5] my-1 pl-2">
      <summary className="py-1.5">
        <span className={`font-semibold text-sm ${group.key === 'direct' ? 'text-flag' : 'text-brand-ink'}`}>{group.label}</span>
        <span className="ml-2"><Rollup permIds={ids} /></span>
        <BulkButtons permIds={ids} />
      </summary>
      <div className="pl-2">
        {group.apps.map((a) => <AppNode key={a.domain} app={a} locked={locked} initialOpen={initialOpen} />)}
      </div>
    </details>
  )
}

function PersonCard({ person, locked, initialOpen }: { person: AuditPerson; locked: Set<string>; initialOpen: boolean }) {
  const ids = collectPermIds(person)
  const anyHl = useAudit().state.highlights
  const hasHl = person.groups.some((g) => g.apps.some((a) => a.permissions.some((p) => p.id in anyHl)))
  return (
    <details open={initialOpen} className={`border rounded-xl mb-2.5 bg-white overflow-hidden ${hasHl ? 'border-[#f0cf9b]' : 'border-line'}`}>
      <summary className="px-3.5 py-3 hover:bg-[#fafbfe]">
        <div className="flex-1 min-w-0">
          <div className="font-semibold">
            {person.staff_name}
            {hasHl && <span className="ml-1.5"><Pill tone="flag">★ has highlights</Pill></span>}
          </div>
          <div className="text-xs text-muted">{person.email} · {person.permission_count} permissions</div>
        </div>
        <BulkButtons permIds={ids} />
        <span className="ml-2"><Rollup permIds={ids} /></span>
      </summary>
      <div className="px-3 pb-3 pt-0.5">
        {person.groups.map((g) => <GroupNode key={g.label} group={g} locked={locked} initialOpen={initialOpen} />)}
      </div>
    </details>
  )
}

export default function Phase2() {
  const { state, periodLabel, backToSetup, finalize } = useAudit()
  // Bump `key` to remount the tree so every <details> re-applies its open
  // state (native <details> is uncontrolled once mounted).
  const [openSignal, setOpenSignal] = useState({ open: true, key: 0 })

  const people = useMemo(
    () => state.selected.map((n) => state.treeCache[n]).filter(Boolean),
    [state.selected, state.treeCache],
  )
  const locked = useMemo(() => computeLocked(people, state.decisions), [people, state.decisions])

  const allIds = useMemo(() => people.flatMap((p) => collectPermIds(p)), [people])
  const decided = countDecided(allIds, state.decisions)
  const total = allIds.length
  const pct = total ? Math.round((decided / total) * 100) : 0

  return (
    <section>
      <div className="flex gap-4 flex-wrap items-center bg-brand-soft border border-[#c9d7ff] rounded-xl px-4 py-3.5 mb-4">
        {[['Department', state.dept], ['Period', periodLabel], ['Users', String(people.length)]].map(([k, v]) => (
          <div key={k}>
            <div className="text-[11px] text-brand-ink/80 font-semibold uppercase tracking-wide">{k}</div>
            <div className="font-semibold">{v}</div>
          </div>
        ))}
        <div>
          <div className="text-[11px] text-brand-ink/80 font-semibold uppercase tracking-wide">Status</div>
          <div className="font-semibold"><Pill tone="brand">Setup locked</Pill></div>
        </div>
      </div>

      <Panel>
        <PanelHead
          title="Manager review"
          sub="Expand each person into positions, apps, then permissions. Keep or Revoke each one."
          right={
            <div className="text-right min-w-42">
              <div className="text-[13px] text-muted"><span className="tabular-nums">{decided}</span> / <span className="tabular-nums">{total}</span> decided</div>
              <div className="h-2 bg-[#eef1f6] rounded-full overflow-hidden mt-1.5 w-42">
                <i className="block h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          }
        />
        <div className="flex gap-2.5 my-3.5">
          <Button size="sm" onClick={() => setOpenSignal((s) => ({ open: true, key: s.key + 1 }))}>Expand all</Button>
          <Button size="sm" onClick={() => setOpenSignal((s) => ({ open: false, key: s.key + 1 }))}>Collapse all</Button>
        </div>
        <div key={openSignal.key}>
          {people.map((p) => <PersonCard key={p.staff_name} person={p} locked={locked} initialOpen={openSignal.open} />)}
        </div>
      </Panel>

      <div className="sticky bottom-0 pt-3.5 mt-2">
        <Panel className="mb-0">
          <div className="flex justify-between items-center gap-3.5 flex-wrap">
            <div>
              <strong>Finalize the audit</strong>
              <p className="text-muted text-[13px] mt-0.5 mb-0">
                Generates a read-only report.{' '}
                {decided < total && <span className="text-flag">{total - decided} permission(s) still undecided — they'll be marked "No decision".</span>}
              </p>
            </div>
            <div className="flex gap-2.5">
              <Button variant="ghost" onClick={backToSetup}>← Back to setup</Button>
              <Button variant="primary" disabled={state.loading} onClick={() => void finalize()}>
                {state.loading ? 'Generating…' : 'Finalize & generate report'}
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </section>
  )
}
