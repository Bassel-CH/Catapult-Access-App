/** Panel 2: department, month, year and manager. */
import { useAudit } from '../../state/AuditContext'
import { MONTHS } from '../../lib/format'
import { Panel, PanelHead } from '../ui'

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

export default DefineAuditPanel
