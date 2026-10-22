import { useAudit } from './state/AuditContext'
import { Stepper } from './components/Stepper'
import ItSetup from './components/ItSetup'
import ManagerAudit from './components/ManagerAudit'
import Report from './components/Report'

export default function App() {
  const { state } = useAudit()
  return (
    <div className="max-w-[1040px] mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold m-0">Catapult Applications Audit</h1>
          <p className="text-muted text-[13px] m-0">Rotating monthly permission review — IT setup, then manager sign-off.</p>
        </div>
        <Stepper />
      </div>

      {state.phase === 1 && <ItSetup />}
      {state.phase === 2 && <ManagerAudit />}
      {state.phase === 3 && <Report />}

      <p className="text-xs text-muted text-center mt-8">
        Decisions live only in this tab until the report is generated.
      </p>
    </div>
  )
}
