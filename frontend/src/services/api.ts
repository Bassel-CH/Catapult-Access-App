/**
 * Every call to the backend. Components and the state go through `api`, never
 * fetch directly.
 *
 * Paths are relative ("/api/..."): the page's own address, which the Vite proxy
 * or nginx forwards. A backend hostname here would be baked into the build and
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
 * True when the backend no longer has this tab's session (a restart, or 60 idle
 * minutes). Recoverable by re-uploading, so it isn't shown as a plain error.
 *
 * Matches the 400 "No data loaded" sent only by current_session() in
 * backend/app/api/routes.py; keep the two in step.
 */
export function isSessionLost(err: unknown): boolean {
  return err instanceof ApiError
    && err.status === 400
    && /no data loaded/i.test(err.detail)
}


/**
 * This tab's session id, sent as X-Session-Id. In memory only, not
 * localStorage: a refresh or closed tab drops it.
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
    // The file's bytes as they are: the backend works out the encoding.
    const fd = new FormData()
    fd.append('file', file)
    // The old id lets the server drop the old session once this one loads.
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
    // HTML on success; errors still arrive as JSON.
    return (await ensureOk(await postJson('/api/review-document', req))).text()
  },
  async exportCsv(req) {
    return (await ensureOk(await postJson('/api/export', req))).blob()
  },
  async endSession() {
    const id = sessionId
    sessionId = null
    if (!id) return
    // Best effort: the server drops it after 60 idle minutes anyway.
    try {
      await fetch('/api/session', { method: 'DELETE', headers: { 'X-Session-Id': id } })
    } catch { /* ignore */ }
  },
}
