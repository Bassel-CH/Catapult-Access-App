/**
 * Turning a failed backend response into an error the UI can show. Free of
 * imports, so it can be tested on its own.
 */

/**
 * A failed API call. `message` is what to show; `status` and `detail` let code
 * tell failures apart without matching on the message.
 */
export class ApiError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

/**
 * The clearest message in a failed response. FastAPI errors come as
 * {detail: "..."}, {detail: [{msg, ...}]} for validation, or {error, detail}
 * from main.py's catch-all. A non-JSON body (an nginx page) never reaches the
 * UI as-is.
 */
export async function errorDetail(res: Response): Promise<string> {
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
  // A non-JSON 413 is nginx's size limit. No number in the message: it would
  // go stale when the limits change.
  if (res.status === 413) {
    return 'This file is too large to upload. The monthly export is normally '
      + 'well under 1 MB — check this is the right file.'
  }
  return res.statusText || `Request failed (${res.status})`
}
