import { useAudit, type AuditState } from '../../state/AuditContext'
import { Panel, PanelHead, Pill } from '../ui'

/**
 * A new upload resets the audit (selection, highlights, decisions). Ask first
 * whenever that would throw work away — except when re-uploading the same file
 * to recover a lost session, which is what restores that work.
 */
function confirmReplace(state: AuditState, file: File): boolean {
  const r = state.recovery
  if (r) {
    if (file.name === r.filename) return true
    return window.confirm(
      `The held audit belongs to "${r.filename}", but you picked "${file.name}".\n\n`
      + 'Uploading a different file discards the held selection and decisions. Continue?',
    )
  }
  const people = state.selected.length
  const highlights = Object.keys(state.highlights).length
  const decisions = Object.values(state.decisions).filter((d) => d.decision || d.note).length
  if (!people && !highlights && !decisions) return true
  return window.confirm(
    'Uploading a file starts a new audit and clears the current one:\n\n'
    + `  • ${people} selected ${people === 1 ? 'person' : 'people'}\n`
    + `  • ${highlights} highlight(s)\n`
    + `  • ${decisions} decision(s)\n\n`
    + 'Continue?',
  )
}

function UploadPanel() {
  const { state, uploadFile } = useAudit()
  const up = state.upload
  const pick = (file: File) => {
    if (confirmReplace(state, file)) void uploadFile(file)
  }
  return (
    <Panel>
      <PanelHead title="1 · Load the report" sub="Upload the monthly organization export." />
      <div className="flex gap-2.5 items-center flex-wrap my-3.5">
        <label className="inline-flex items-center gap-2 rounded-lg font-semibold border border-line bg-white px-4 py-2 cursor-pointer hover:border-[#c4cad6]">
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              // Clear the picker so choosing the same file again still fires
              // onChange (browsers only fire it when the value changes).
              e.target.value = ''
              if (f) pick(f)
            }}
          />
          Upload CSV
        </label>
        <span className="text-muted text-[13px]">
          {state.loading ? 'Loading…'
            : up ? <><strong>{up.row_count}</strong> rows · <strong>{state.users.length}</strong> staff loaded · {up.rows_dropped} junk rows dropped</>
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

export default UploadPanel
