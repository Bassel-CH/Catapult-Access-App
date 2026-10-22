import { useMemo, useState } from 'react'
import { useAudit } from '../../state/AuditContext'
import { Button } from '../ui'
import StaffCard from './StaffCard'

function SelectStaffPanel() {
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
        Selected staff stay pinned to the top. Expand a staff member to highlight permissions that need a closer look.
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
        ? <div className="bg-[#fbfbfd] border border-dashed border-line rounded-lg px-3.5 py-3 text-[13px] text-muted">Load data to see staff.</div>
        : visible.length === 0
          ? <div className="bg-[#fbfbfd] border border-dashed border-line rounded-lg px-3.5 py-3 text-[13px] text-muted">No staff match.</div>
          : visible.map((u) => <StaffCard key={u.name} name={u.name} />)}
    </>
  )
}

export default SelectStaffPanel
