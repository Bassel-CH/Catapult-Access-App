/**
 * One staff member in the list. Their highlight tree only renders while the
 * card is open, so typing doesn't re-render ~190 trees.
 */
import { memo, useMemo, useState } from 'react'
import { useAudit } from '../../state/AuditContext'
import { collectPermIds } from '../../lib/cascade'
import { Pill } from '../ui'
import HighlightTree from './HighlightTree'

const StaffCard = memo(function StaffCard({ name }: { name: string }) {
  const { state, toggleSelect } = useAudit()
  const member = state.users.find((u) => u.name === name)!
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
          <div className="font-semibold">{member.name}</div>
          <div className="text-xs text-muted">{member.email} · {member.permCount} permissions</div>
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

export default StaffCard
