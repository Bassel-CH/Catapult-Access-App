import { useAudit } from './state/AuditContext'
import { usingMocks } from './services/api'
import { Stepper } from './components/Stepper'
import Phase1 from './components/Phase1'
import Phase2 from './components/Phase2'
import Phase3 from './components/Phase3'

export default function App() {
  const { state } = useAudit()
  return (
    <div className="max-w-[1040px] mx-auto px-5 pt-6 pb-24">
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div>
          <h1 className="text-[22px] font-semibold m-0">Department Access Audit</h1>
          <p className="text-muted text-[13px] m-0">Rotating monthly permission review — IT setup, then manager sign-off.</p>
        </div>
        <Stepper />
      </div>

      {state.phase === 1 && <Phase1 />}
      {state.phase === 2 && <Phase2 />}
      {state.phase === 3 && <Phase3 />}

      <p className="text-xs text-muted text-center mt-8">
        {usingMocks ? 'Running on mock data' : 'Connected to the live API'} · decisions live only in this tab until the report is generated.
      </p>
    </div>
  )
}
