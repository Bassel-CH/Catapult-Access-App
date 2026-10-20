/**
 * Turning a failed backend response into an error the UI can show.
 *
 * Kept free of imports so it can be tested on its own, against real responses.
 */

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
 * Pull the cleanest possible message out of a failed response.
 *
 * FastAPI shapes differ: HTTPException gives {detail: "..."}, request
 * validation gives {detail: [{loc, msg, ...}]}, and main.py's catch-all gives
 * {error, detail}. Anything non-JSON (proxy error, HTML error page) falls back
 * to the status text so a raw page never reaches the UI.
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
  // A 413 that isn't the backend's own JSON came from nginx, which refuses
  // uploads past its size limit before the backend sees them. No number here:
  // the limits live in nginx and the backend config, and this would go stale.
  if (res.status === 413) {
    return 'This file is too large to upload. The monthly export is normally '
      + 'well under 1 MB — check this is the right file.'
  }
  return res.statusText || `Request failed (${res.status})`
}
