import { memo } from 'react'
import type { AuditPerson } from '../../types/api'
import { useAudit } from '../../state/AuditContext'

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

export default HighlightTree
