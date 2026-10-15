/**
 * The single seam between the UI and the backend.
 *
 * Every component and the store call `api.*` — never fetch or the mock
 * directly. Phase C runs on the real backend (VITE_USE_MOCKS=false in
 * .env.local); flipping that flag back to "true" swaps in the mock with no
 * other change.
 *
 * Every call is a relative "/api/..." path, so the browser always talks to
 * the address the page came from: the Vite dev proxy in dev, nginx in prod.
 * Never add a backend hostname here — it would be baked into the build and
 * tie the image to one host.
 */
import type {
  UploadResponse, FilterRequest, FilterResponse,
  AuditTreeRequest, AuditTreeResponse,
  GenerateReportRequest, ReportResponse,
  ReviewDocumentRequest, ExportRequest,
} from '../types/api'
import * as mock from '../mocks/mockApi'

export interface AuditApi {
  upload(file: File): Promise<UploadResponse>
  filter(req: FilterRequest): Promise<FilterResponse>
  auditTree(req: AuditTreeRequest): Promise<AuditTreeResponse>
  report(req: GenerateReportRequest): Promise<ReportResponse>
  /** Printable HTML packet (backend returns text/html). */
  reviewDocument(req: ReviewDocumentRequest): Promise<string>
  /** CSV file download (backend returns the CSV bytes directly). */
  exportCsv(req: ExportRequest): Promise<Blob>
  /** Tell the backend to forget this upload's data now. Never throws. */
  endSession(): Promise<void>
}

// Mocks only when explicitly "true". A missing or mistyped value means the
// real backend — a build must never quietly ship fake data.
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

/**
 * A failed API call, carrying the backend's own `detail` string so the UI can
 * show FastAPI's message instead of a bare status code — and so callers can
 * branch on *which* failure it was rather than string-matching a Error.message.
 */
export class ApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(`${status}: ${detail}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

/**
 * True when the backend has no dataset in memory.
 *
 * The backend keeps the uploaded CSV in a module-level CSVService instance, so
 * restarting uvicorn (or an idle redeploy) wipes it mid-audit and every
 * subsequent call answers 400 "No data loaded. Please upload a CSV first."
 * That is a recoverable state — the user just needs to re-upload — so it must
 * not surface as a generic error. Matching on the 400 + phrase pair is
 * deliberate: NoDataLoadedError is the only 400 that carries it.
 */
export function isSessionLost(err: unknown): boolean {
  return err instanceof ApiError
    && err.status === 400
    && /no data loaded/i.test(err.detail)
}

// ── Mock implementation (Phase B; still available via VITE_USE_MOCKS=true) ──
const mockApi: AuditApi = {
  upload: mock.upload,
  filter: mock.filter,
  auditTree: mock.auditTree,
  report: mock.report,
  reviewDocument: mock.reviewDocument,
  exportCsv: mock.exportCsv,
  endSession: async () => {},
}

// ── Real implementation ─────────────────────────────────────────────────────

/**
 * This tab's backend session. Each upload gets a private dataset on the server
 * and an id for it; every later call sends the id back as X-Session-Id.
 *
 * Kept in memory only (not localStorage): a refresh or closed tab drops it,
 * and the server forgets the data after 60 idle minutes anyway. An expired id
 * answers "No data loaded", which isSessionLost() already turns into the
 * re-upload recovery flow.
 */
let sessionId: string | null = null

function sessionHeaders(): Record<string, string> {
  return sessionId ? { 'X-Session-Id': sessionId } : {}
}

/**
 * Pull the cleanest possible message out of a failed response.
 *
 * FastAPI shapes differ: HTTPException gives {detail: "..."}, request
 * validation gives {detail: [{loc, msg, ...}]}, and main.py's catch-all gives
 * {error, detail}. Anything non-JSON (proxy error, HTML error page) falls back
 * to the status text so a raw page never reaches the UI.
 */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body = await res.json()
    const d = body?.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) {
      return d.map((e) => (typeof e?.msg === 'string' ? e.msg : JSON.stringify(e))).join('; ')
    }
    if (typeof body?.error === 'string') return body.error
    if (d != null) return JSON.stringify(d)
  } catch { /* non-JSON error body */ }
  return res.statusText || `Request failed (${res.status})`
}

/** Throw a typed ApiError unless the response is OK. */
async function ensureOk(res: Response): Promise<Response> {
  if (!res.ok) throw new ApiError(res.status, await errorDetail(res))
  return res
}

async function asJson<T>(res: Response): Promise<T> {
  return (await ensureOk(res)).json() as Promise<T>
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sessionHeaders() },
    body: JSON.stringify(body),
  })
}

const realApi: AuditApi = {
  async upload(file) {
    // Raw multipart bytes: the file is cp1252 and the backend decodes it.
    // Never read/re-encode it client-side.
    const fd = new FormData()
    fd.append('file', file)
    // Sending the old id (if any) lets the server drop that dataset once the
    // new one has loaded successfully.
    const up = await asJson<UploadResponse>(
      await fetch('/api/upload', { method: 'POST', body: fd, headers: sessionHeaders() }),
    )
    sessionId = up.session_id
    return up
  },
  async filter(req) {
    return asJson<FilterResponse>(await postJson('/api/filter', req))
  },
  async auditTree(req) {
    return asJson<AuditTreeResponse>(await postJson('/api/audit-tree', req))
  },
  async report(req) {
    return asJson<ReportResponse>(await postJson('/api/report', req))
  },
  async reviewDocument(req) {
    // text/html, not JSON — but errors still arrive as JSON, so reuse ensureOk.
    return (await ensureOk(await postJson('/api/review-document', req))).text()
  },
  async exportCsv(req) {
    // FileResponse (a CSV attachment); same error handling as above.
    return (await ensureOk(await postJson('/api/export', req))).blob()
  },
  async endSession() {
    const id = sessionId
    sessionId = null
    if (!id) return
    // Best effort: if this fails, the server still drops it after 60 idle min.
    try {
      await fetch('/api/session', { method: 'DELETE', headers: { 'X-Session-Id': id } })
    } catch { /* ignore */ }
  },
}

export const api: AuditApi = USE_MOCKS ? mockApi : realApi
export const usingMocks = USE_MOCKS
