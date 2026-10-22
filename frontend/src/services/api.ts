/**
 * The single seam between the UI and the backend.
 *
 * Every component and the store call `api.*`, never fetch directly.
 *
 * Every call is a relative "/api/..." path, so the browser always talks to
 * the address the page came from: the Vite dev proxy in dev, nginx in prod.
 * Never add a backend hostname here — it would be baked into the build and
 * tie the image to one host.
 */
import type {
  UploadResponse, RowsResponse,
  AuditTreeRequest, AuditTreeResponse,
  GenerateReportRequest, ReportResponse,
  ReviewDocumentRequest, ExportRequest,
} from '../types/api'
import { ApiError, errorDetail } from '../lib/apiErrors'

export { ApiError }

export interface AuditApi {
  upload(file: File): Promise<UploadResponse>
  rows(): Promise<RowsResponse>
  auditTree(req: AuditTreeRequest): Promise<AuditTreeResponse>
  report(req: GenerateReportRequest): Promise<ReportResponse>
  /** Printable HTML packet (backend returns text/html). */
  reviewDocument(req: ReviewDocumentRequest): Promise<string>
  /** CSV file download (backend returns the CSV bytes directly). */
  exportCsv(req: ExportRequest): Promise<Blob>
  /** Tell the backend to forget this upload's data now. Never throws. */
  endSession(): Promise<void>
}

/**
 * True when the backend has no dataset in memory for this tab.
 *
 * The backend keeps each upload only in memory, so a restart or 60 idle
 * minutes wipes it mid-audit and every later call answers 400
 * "No data loaded. Please upload a CSV first."
 * That is a recoverable state — the user just needs to re-upload — so it must
 * not surface as a generic error. Matching on the 400 + phrase pair is
 * deliberate: the session lookup in backend/app/api/routes.py is the only
 * thing that sends it.
 */
export function isSessionLost(err: unknown): boolean {
  return err instanceof ApiError
    && err.status === 400
    && /no data loaded/i.test(err.detail)
}


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

export const api: AuditApi = {
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
  async rows() {
    return asJson<RowsResponse>(await fetch('/api/rows', { headers: sessionHeaders() }))
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
