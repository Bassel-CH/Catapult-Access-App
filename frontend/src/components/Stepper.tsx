/** The step bar in the header: IT setup, Manager audit, Report. */
import { useAudit } from '../state/AuditContext'

const STEPS = [
  { n: 1, label: 'IT setup' },
  { n: 2, label: 'Manager audit' },
  { n: 3, label: 'Report' },
] as const

export function Stepper() {
  const { state } = useAudit()
  return (
    <div className="flex gap-2 items-center text-[13px] text-muted flex-wrap">
      {STEPS.map(({ n, label }) => {
        const active = state.phase === n
        const done = n < state.phase
        return (
          <div
            key={n}
            className={[
              'flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border',
              active ? 'bg-brand-soft border-[#c9d7ff] text-brand-ink font-semibold' : 'border-line',
              done ? 'text-keep' : '',
            ].join(' ')}
          >
            <span
              className={[
                'w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold text-white',
                active ? 'bg-brand' : done ? 'bg-keep' : 'bg-line',
              ].join(' ')}
            >
              {done ? '✓' : n}
            </span>
            {label}
          </div>
        )
      })}
    </div>
  )
}
