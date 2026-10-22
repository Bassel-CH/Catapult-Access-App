/** Saving files and opening HTML in a new tab, for the export, report and packet. */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function openHtmlInTab(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadHtml(html: string, filename: string): void {
  downloadBlob(new Blob([html], { type: 'text/html' }), filename)
}

/** "Patient Support" → "patient-support" for filenames. */
export function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'audit'
}
