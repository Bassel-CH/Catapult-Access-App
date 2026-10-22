/**
 * The report step: the backend's counts for the finished audit, and buttons to
 * open or download the report and open the review packet.
 */
import { useAudit } from '../state/AuditContext'
import { api } from '../services/api'
import { downloadHtml, openHtmlInTab, slug } from '../lib/download'
import { MONTHS } from '../lib/format'
import { Button, Panel } from './ui'

function SummaryCard({ n, label, color }: { n: number; label: string; color?: string }) {
  return (
    <div className="flex-1 min-w-30 bg-white border border-line rounded-xl p-3.5">
      <div className="text-2xl font-bold" style={color ? { color } : undefined}>{n}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}

export default function Report() {
  const { state, reset, guard } = useAudit()
  const report = state.report
  if (!report) return null
  const s = report.summary

  const openReviewPacket = () => guard(async () => {
    const html = await api.reviewDocument({
      staff_names: state.selected,
      audit_label: `${MONTHS[state.month]} — ${state.dept}`,
      manager_name: state.managerName,
      flagged: Object.keys(state.highlights),
    })
    openHtmlInTab(html)
  })

  return (
    <section>
      <Panel>
        <h2 className="text-[17px] font-semibold m-0 flex items-center gap-2">Report generated ✓</h2>
        <p className="text-muted text-[13px] mt-1 mb-4">
          Authoritative summary from <code>/api/report</code> (the Access-cascade rule is applied server-side).
        </p>
        <div className="flex gap-2.5 flex-wrap mb-4">
          <SummaryCard n={s.users_reviewed} label="Users reviewed" />
          <SummaryCard n={s.total_permissions} label="Permissions" />
          <SummaryCard n={s.kept} label="Kept" color="#127a4b" />
          <SummaryCard n={s.revoked} label="Revoked" color="#b3261e" />
          <SummaryCard n={s.no_decision} label="No decision" color="#6b7280" />
        </div>
        <div className="flex gap-2.5 flex-wrap">
          <Button variant="primary" onClick={() => openHtmlInTab(report.html)}>Open report</Button>
          <Button onClick={() => downloadHtml(report.html, `access-audit-${slug(state.dept)}.html`)}>Download .html</Button>
          <Button onClick={() => void openReviewPacket()}>Open review packet</Button>
          <Button variant="ghost" onClick={reset}>Start a new audit</Button>
        </div>
        {state.error && (
          <div role="alert" className="mt-3 rounded-lg border border-[#f1c4c0] bg-[#fdf4f3] px-3.5 py-2.5 text-[13px] text-revoke">
            <strong className="font-semibold">Something went wrong</strong>
            <div className="mt-0.5">{state.error}</div>
          </div>
        )}
      </Panel>
    </section>
  )
}
