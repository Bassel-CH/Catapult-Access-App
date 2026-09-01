/**
 * Permission search — find everyone holding a named permission, and show HOW
 * they hold it: directly assigned, or inherited from a specific position.
 *
 * Reads treeCache (already populated at upload) so results carry real
 * permission ids, which is what highlighting is keyed by. Selection writes to
 * the same state.selected the user list reads, so picking someone here shows
 * up as picked there.
 *
 * Renders bare (no Panel) — Phase1 owns the panel and the tab strip.
 */
import { useMemo, useState } from 'react'
import { useAudit } from '../state/AuditContext'
import { Pill } from './ui'

type SourceFilter = 'all' | 'direct' | 'position'

interface Match {
  permId: string
  personName: string
  email: string
  permName: string
  domain: string
  isDirect: boolean
  /** Position name for inherited grants; null when directly assigned. */
  position: string | null
}

export default function PermissionSearch() {
  const { state, toggleHighlight, toggleSelect } = useAudit()
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  const matches = useMemo<Match[]>(() => {
    const q = query.toLowerCase().trim()
    if (q.length < 2) return []

    const out: Match[] = []
    for (const person of Object.values(state.treeCache)) {
      if (!person.found) continue
      for (const group of person.groups) {
        const isDirect = group.key === 'direct'
        if (sourceFilter === 'direct' && !isDirect) continue
        if (sourceFilter === 'position' && isDirect) continue

        for (const app of group.apps) {
          for (const perm of app.permissions) {
            if (!perm.name.toLowerCase().includes(q)) continue
            out.push({
              permId: perm.id,
              personName: person.staff_name,
              email: person.email,
              permName: perm.name,
              domain: app.domain,
              isDirect,
              position: isDirect ? null : group.position,
            })
          }
        }
      }
    }
    return out.sort((a, b) =>
      a.permName.localeCompare(b.permName)
      || a.personName.localeCompare(b.personName))
  }, [state.treeCache, query, sourceFilter])

  const directCount = matches.filter((m) => m.isDirect).length

  return (
    <>
      <p className="text-muted text-[13px] mt-0 mb-3.5">
        Find who holds a permission and whether it's directly assigned or inherited from a
        position. Tick someone to add them to the audit, then switch tabs to review their tree.
      </p>

      <div className="flex gap-2.5 items-center flex-wrap mb-3.5">
        <input
          className="field-input max-w-70"
          placeholder="Permission name, e.g. Open Charts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="field-input max-w-52"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
        >
          <option value="all">All sources</option>
          <option value="direct">Direct assignment only</option>
          <option value="position">Position-based only</option>
        </select>
        {matches.length > 0 && (
          <span className="text-muted text-[13px]">
            <strong>{matches.length}</strong> {matches.length === 1 ? 'match' : 'matches'} ·{' '}
            <strong>{directCount}</strong> direct · <strong>{matches.length - directCount}</strong> inherited
          </span>
        )}
      </div>

      {query.trim().length < 2
        ? <div className="bg-[#fbfbfd] border border-dashed border-line rounded-lg px-3.5 py-3 text-[13px] text-muted">
            Type at least two characters to search.
          </div>
        : matches.length === 0
          ? <div className="bg-[#fbfbfd] border border-dashed border-line rounded-lg px-3.5 py-3 text-[13px] text-muted">
              No permissions match “{query}”.
            </div>
          : (
            <div className="border border-line rounded-xl overflow-hidden">
              {matches.map((m) => {
                const hl = m.permId in state.highlights
                const picked = state.selected.includes(m.personName)
                return (
                  <div
                    key={m.permId}
                    className={`flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[#eef0f5] last:border-b-0 flex-wrap ${hl ? 'bg-flag-soft' : picked ? 'bg-[#fbfcff]' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="w-[18px] h-[18px] flex-none"
                      checked={picked}
                      onChange={() => toggleSelect(m.personName)}
                      aria-label={`Select ${m.personName} for this audit`}
                    />
                    <div className="flex-1 min-w-52">
                      <div className="font-semibold text-sm">{m.personName}</div>
                      <div className="text-xs text-muted">{m.email}</div>
                    </div>
                    <div className="flex-1 min-w-42">
                      <div className="font-medium text-sm">{m.permName}</div>
                      <div className="text-xs text-muted">{m.domain}</div>
                    </div>
                    <Pill tone={m.isDirect ? 'flag' : 'default'}>
                      {m.isDirect ? 'Direct Assignment' : m.position}
                    </Pill>
                    <button
                      className={`text-xs border rounded-md px-2.5 py-1 font-semibold ${hl ? 'bg-flag-soft border-[#f0cf9b] text-flag' : 'bg-white border-line text-muted'}`}
                      onClick={() => toggleHighlight(m.permId)}
                    >
                      {hl ? '★ Highlighted' : '☆ Highlight'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
    </>
  )
}