/**
 * The IT setup step: upload the export, define the audit, pick the staff to
 * review and highlight permissions, then export or hand off to the manager.
 */
import { useState } from 'react'
import { useAudit } from '../../state/AuditContext'
import { api } from '../../services/api'
import { downloadBlob, slug } from '../../lib/download'
import { Button, Panel, Pill } from '../ui'
import DefineAuditPanel from './DefineAuditPanel'
import PermissionSearch from './PermissionSearch'
import SelectStaffPanel from './SelectStaffPanel'
import UploadPanel from './UploadPanel'

export default function ItSetup() {
  const { state, periodLabel, startAudit, guard } = useAudit()
  const canLock = state.selected.length > 0 && state.dept.trim().length > 0
  const [tab, setTab] = useState<'staff' | 'search'>('staff')

  const tabClass = (on: boolean) =>
    `text-[13px] font-semibold rounded-full px-3.5 py-1.5 border ${
      on ? 'bg-brand-soft border-[#bcd0ff] text-brand-ink' : 'bg-white border-line text-muted hover:border-[#c4cad6]'
    }`

  // The export selects by StaffId, unlike every other endpoint.
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
          <button className={tabClass(tab === 'staff')} onClick={() => setTab('staff')}>
            Select staff &amp; highlight points of interest
          </button>
          <button className={tabClass(tab === 'search')} onClick={() => setTab('search')}>
            Permission search
          </button>
          <span className="ml-auto"><Pill tone="brand">{state.selected.length} selected</Pill></span>
        </div>
        {tab === 'staff' ? <SelectStaffPanel /> : <PermissionSearch />}
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
