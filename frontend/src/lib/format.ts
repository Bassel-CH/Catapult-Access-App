/** Small pure helpers with no React or API dependencies. */

/**
 * Deterministic string → short hex hash (djb2).
 *
 * The backend fingerprints each permission with md5; we don't need to match
 * its exact value in the mock, only to be *stable* for the same input within a
 * session, so a Keep/Revoke decision keeps mapping to the same permission.
 */
export function hashId(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** Distinct, sorted, non-empty values of one column across rows. */
export function uniqueSorted<T>(rows: T[], key: keyof T): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    const v = r[key]
    if (v != null && v !== '') set.add(String(v))
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}
