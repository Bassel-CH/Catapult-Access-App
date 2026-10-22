/**
 * Central workflow state for the whole audit (all three phases), exposed via a
 * React context so any component can read state and dispatch actions without
 * prop-drilling. Async actions call the `api` seam and then dispatch; the
 * synchronous business rule (Access-cascade) lives in the reducer via helpers
 * from lib/cascade so it stays deterministic and testable.
 */
import {
  createContext, useCallback, useContext, useMemo, useReducer,
} from 'react'
import type { ReactNode } from 'react'
import type {
  UploadResponse, StaffRow, AuditPerson, ReportResponse,
  GenerateReportRequest,
} from '../types/api'
import { api, isSessionLost } from '../services/api'
import { applyBulk, applyDecision, type DecisionMap } from '../lib/cascade'
import { MONTHS } from '../lib/format'

export interface UserSummary {
  name: string
  email: string
  staffIds: string[] // export identifies people by id, not name — keep both
  positions: string[]
  permCount: number
}

/**
 * Work held back when the backend loses its in-memory dataset, so re-uploading
 * the same export restores the audit instead of restarting it.
 *
 * Safe because permission ids are a deterministic fingerprint of the row
 * (name|source|position|domain|permission|occurrence, md5'd on the server):
 * re-uploading the same file regenerates identical ids, and any id that is NOT
 * regenerated is simply absent from the new tree and ignored by /api/report.
 */
interface Recovery {
  filename: string
  rowCount: number
  selected: string[]
  decisions: DecisionMap
  highlights: Record<string, string>
}

export interface AuditState {
  phase: 1 | 2 | 3
  loading: boolean
  error: string | null
  /** error is specifically "backend lost the dataset" — recoverable by re-upload */
  sessionLost: boolean
  /** decisions parked by a session loss, waiting for the matching re-upload */
  recovery: Recovery | null
  /** set once when a re-upload restored parked decisions (for the banner) */
  recovered: boolean
  upload: UploadResponse | null
  users: UserSummary[]
  selected: string[] // StaffNames (the identity every endpoint but /export uses)
  treeCache: Record<string, AuditPerson> // name → reviewable tree
  highlights: Record<string, string> // permId → IT note
  decisions: DecisionMap // permId → keep/revoke (+note)
  dept: string
  month: number // 0–11
  year: number
  managerName: string
  report: ReportResponse | null
}

const now = new Date()

const initialState: AuditState = {
  phase: 1,
  loading: false,
  error: null,
  sessionLost: false,
  recovery: null,
  recovered: false,
  upload: null,
  users: [],
  selected: [],
  treeCache: {},
  highlights: {},
  decisions: {},
  dept: '',
  month: now.getMonth(),
  year: now.getFullYear(),
  managerName: '',
  report: null,
}

type Action =
  | { type: 'BEGIN' }
  | { type: 'LOADING'; value: boolean }
  | { type: 'ERROR'; message: string | null }
  | { type: 'SESSION_LOST' }
  | { type: 'LOADED'; upload: UploadResponse; users: UserSummary[]; treeCache: Record<string, AuditPerson> }
  | { type: 'TOGGLE_SELECT'; name: string }
  | { type: 'SELECT_MANY'; names: string[] }
  | { type: 'CLEAR_SELECT' }
  | { type: 'TOGGLE_HIGHLIGHT'; permId: string }
  | { type: 'HIGHLIGHT_NOTE'; permId: string; note: string }
  | { type: 'SET_DEPT'; value: string }
  | { type: 'SET_MANAGER'; value: string }
  | { type: 'SET_PERIOD'; month: number; year: number }
  | { type: 'DECIDE'; permId: string; value: 'keep' | 'revoke' }
  | { type: 'BULK'; permIds: string[]; value: 'keep' | 'revoke' }
  | { type: 'DECISION_NOTE'; permId: string; note: string }
  | { type: 'SET_REPORT'; report: ReportResponse }
  | { type: 'GO_PHASE'; phase: 1 | 2 | 3 }
  | { type: 'RESET' }

/** Selected people as an array of trees (input to the cascade helpers). */
function selectedPeople(state: AuditState): AuditPerson[] {
  return state.selected.map((n) => state.treeCache[n]).filter(Boolean)
}

function reducer(state: AuditState, action: Action): AuditState {
  switch (action.type) {
    case 'BEGIN':
      return { ...state, loading: true, error: null, recovered: false }
    case 'LOADING':
      return { ...state, loading: action.value }
    case 'ERROR':
      // Clear sessionLost so a *later* failure (e.g. re-uploading the wrong
      // file) isn't mislabelled "session expired". `recovery` survives, so the
      // parked decisions are still waiting for the right file.
      return { ...state, error: action.message, loading: false, sessionLost: false }
    case 'SESSION_LOST':
      // The backend forgot the dataset (uvicorn restarted). Send the user back
      // to the IT setup step to re-upload, but park their work and keep the audit
      // definition so nothing has to be retyped.
      return {
        ...state,
        phase: 1,
        loading: false,
        sessionLost: true,
        error:
          'The server no longer has the uploaded report in memory — it was most '
          + 'likely restarted. Re-upload the same CSV to pick up where you left off.',
        recovery: state.upload
          ? {
            filename: state.upload.filename,
            rowCount: state.upload.row_count,
            selected: state.selected,
            decisions: state.decisions,
            highlights: state.highlights,
          }
          : state.recovery,
        upload: null,
        users: [],
        treeCache: {},
        report: null,
      }
    case 'LOADED': {
      // Restore parked work only if this really is the same export: same
      // filename AND same surviving row count. Otherwise the prior decisions
      // belong to a different dataset and must be dropped.
      const r = state.recovery
      const sameFile = r
        && r.filename === action.upload.filename
        && r.rowCount === action.upload.row_count
      const known = new Set(action.users.map((u) => u.name))
      return {
        ...state,
        upload: action.upload,
        users: action.users,
        treeCache: action.treeCache,
        error: null,
        sessionLost: false,
        recovery: null,
        recovered: Boolean(sameFile),
        // A fresh dataset invalidates any prior selection/decisions.
        selected: sameFile ? r!.selected.filter((n) => known.has(n)) : [],
        highlights: sameFile ? r!.highlights : {},
        decisions: sameFile ? r!.decisions : {},
        report: null,
      }
    }
    case 'TOGGLE_SELECT': {
      const on = state.selected.includes(action.name)
      return {
        ...state,
        selected: on
          ? state.selected.filter((n) => n !== action.name)
          : [...state.selected, action.name],
      }
    }
    case 'SELECT_MANY': {
      const set = new Set([...state.selected, ...action.names])
      return { ...state, selected: [...set] }
    }
    case 'CLEAR_SELECT':
      return { ...state, selected: [] }
    case 'TOGGLE_HIGHLIGHT': {
      const next = { ...state.highlights }
      if (action.permId in next) delete next[action.permId]
      else next[action.permId] = ''
      return { ...state, highlights: next }
    }
    case 'HIGHLIGHT_NOTE':
      return { ...state, highlights: { ...state.highlights, [action.permId]: action.note } }
    case 'SET_DEPT':
      return { ...state, dept: action.value }
    case 'SET_MANAGER':
      return { ...state, managerName: action.value }
    case 'SET_PERIOD':
      return { ...state, month: action.month, year: action.year }
    case 'DECIDE':
      return {
        ...state,
        decisions: applyDecision(selectedPeople(state), state.decisions, action.permId, action.value),
      }
    case 'BULK':
      return { ...state, decisions: applyBulk(state.decisions, action.permIds, action.value) }
    case 'DECISION_NOTE':
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.permId]: { decision: state.decisions[action.permId]?.decision ?? null, note: action.note },
        },
      }
    case 'SET_REPORT':
      return { ...state, report: action.report }
    case 'GO_PHASE':
      return { ...state, phase: action.phase }
    case 'RESET':
      return { ...initialState, month: now.getMonth(), year: now.getFullYear() }
    default:
      return state
  }
}

/** Group flat rows into one entry per StaffName. */
function deriveUsers(rows: StaffRow[]): UserSummary[] {
  const map = new Map<string, UserSummary & { _ids: Set<string>; _pos: Set<string> }>()
  for (const r of rows) {
    let u = map.get(r.StaffName)
    if (!u) {
      u = {
        name: r.StaffName, email: r.StaffEmailAddress, staffIds: [], positions: [],
        permCount: 0, _ids: new Set(), _pos: new Set(),
      }
      map.set(r.StaffName, u)
    }
    u._ids.add(r.StaffId)
    u._pos.add(r.PositionName)
    u.permCount++
  }
  return [...map.values()]
    .map((u) => ({
      name: u.name, email: u.email, permCount: u.permCount,
      staffIds: [...u._ids], positions: [...u._pos].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

interface AuditContextValue {
  state: AuditState
  periodLabel: string
  uploadFile: (file: File) => Promise<void>
  toggleSelect: (name: string) => void
  selectMany: (names: string[]) => void
  clearSelect: () => void
  toggleHighlight: (permId: string) => void
  setHighlightNote: (permId: string, note: string) => void
  setDept: (v: string) => void
  setManager: (v: string) => void
  setPeriod: (month: number, year: number) => void
  startAudit: () => void
  backToSetup: () => void
  decide: (permId: string, value: 'keep' | 'revoke') => void
  bulk: (permIds: string[], value: 'keep' | 'revoke') => void
  setDecisionNote: (permId: string, note: string) => void
  finalize: () => Promise<void>
  reset: () => void
  /**
   * Run a one-off API call with the same loading/error/session-lost handling as
   * the built-in actions. Use it for anything that talks to the backend outside
   * this context (CSV export, review packet) so no call can fail silently.
   */
  guard: (fn: () => Promise<void>) => Promise<void>
}

const AuditContext = createContext<AuditContextValue | null>(null)

export function AuditProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  /**
   * Single place every API failure lands. A lost backend session is its own
   * outcome (recoverable, routes to the IT setup step); everything else becomes an error
   * message — the backend's `detail` when we have one, never a stack trace.
   */
  const fail = useCallback((e: unknown) => {
    if (isSessionLost(e)) {
      dispatch({ type: 'SESSION_LOST' })
      return
    }
    dispatch({ type: 'ERROR', message: e instanceof Error ? e.message : String(e) })
  }, [])

  const guard = useCallback(async (fn: () => Promise<void>) => {
    dispatch({ type: 'BEGIN' })
    try {
      await fn()
    } catch (e) {
      fail(e)
    } finally {
      dispatch({ type: 'LOADING', value: false })
    }
  }, [fail])

  const uploadFile = useCallback((file: File) => guard(async () => {
    const upload = await api.upload(file)
    // Load every row to build the staff list, then fetch the reviewable trees
    // once so highlighting works in the IT setup step.
    const { data } = await api.rows()
    const users = deriveUsers(data)
    const tree = await api.auditTree({ staff_names: users.map((u) => u.name) })
    const treeCache = Object.fromEntries(tree.people.map((p) => [p.staff_name, p]))
    dispatch({ type: 'LOADED', upload, users, treeCache })
  }), [guard])

  const periodLabel = useMemo(() => `${MONTHS[state.month]} ${state.year}`, [state.month, state.year])

  const finalize = useCallback(() => guard(async () => {
    const req: GenerateReportRequest = {
      staff_names: state.selected,
      department: state.dept,
      period_label: `${MONTHS[state.month]} ${state.year}`,
      manager_name: state.managerName,
      audit_label: `${MONTHS[state.month]} — ${state.dept}`,
      decisions: state.decisions,
      highlights: state.highlights,
    }
    const report = await api.report(req)
    dispatch({ type: 'SET_REPORT', report })
    dispatch({ type: 'GO_PHASE', phase: 3 })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }), [guard, state.selected, state.dept, state.month, state.year, state.managerName, state.decisions, state.highlights])

  const goPhase = useCallback((phase: 1 | 2 | 3) => {
    dispatch({ type: 'GO_PHASE', phase })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const value: AuditContextValue = useMemo(() => ({
    state,
    periodLabel,
    uploadFile,
    toggleSelect: (name) => dispatch({ type: 'TOGGLE_SELECT', name }),
    selectMany: (names) => dispatch({ type: 'SELECT_MANY', names }),
    clearSelect: () => dispatch({ type: 'CLEAR_SELECT' }),
    toggleHighlight: (permId) => dispatch({ type: 'TOGGLE_HIGHLIGHT', permId }),
    setHighlightNote: (permId, note) => dispatch({ type: 'HIGHLIGHT_NOTE', permId, note }),
    setDept: (v) => dispatch({ type: 'SET_DEPT', value: v }),
    setManager: (v) => dispatch({ type: 'SET_MANAGER', value: v }),
    setPeriod: (month, year) => dispatch({ type: 'SET_PERIOD', month, year }),
    startAudit: () => goPhase(2),
    backToSetup: () => goPhase(1),
    decide: (permId, val) => dispatch({ type: 'DECIDE', permId, value: val }),
    bulk: (permIds, val) => dispatch({ type: 'BULK', permIds, value: val }),
    setDecisionNote: (permId, note) => dispatch({ type: 'DECISION_NOTE', permId, note }),
    finalize,
    reset: () => {
      // "Start a new audit": wipe the server's copy too, not just this tab's.
      void api.endSession()
      dispatch({ type: 'RESET' })
    },
    guard,
  }), [state, periodLabel, uploadFile, finalize, goPhase, guard])

  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>
}

export function useAudit(): AuditContextValue {
  const ctx = useContext(AuditContext)
  if (!ctx) throw new Error('useAudit must be used inside <AuditProvider>')
  return ctx
}
