/**
 * The API's request and response shapes, mirroring
 * backend/app/models/schemas.py. Change both together.
 */
export type PermissionSource = 'Position-Based' | 'Direct Assignment'

/** One row of the uploaded CSV, after the backend drops junk rows. */
export interface StaffRow {
  StaffId: string
  StaffName: string
  StaffEmailAddress: string
  DomainName: string
  PermissionName: string
  PositionName: string
  PermissionSource: PermissionSource
}

// ── POST /api/upload ────────────────────────────────────────────────────────
export interface UploadResponse {
  success: boolean
  /** Private id for this upload's data; sent back as X-Session-Id. */
  session_id: string
  filename: string
  row_count: number
  rows_dropped: number
  /** e.g. { "Position-Based": 4163, "Direct Assignment": 798 } */
  source_breakdown: Record<string, number>
}

// ── GET /api/rows ──────────────────────────────────────────────────────────
export interface RowsResponse {
  success: boolean
  /** Every row of the upload; keys are the CSV columns. */
  data: StaffRow[]
}

// ── POST /api/audit-tree ───────────────────────────────────────────────────
export interface AuditPermission {
  /** Stable fingerprint; Keep/Revoke decisions are keyed by this id. */
  id: string
  name: string
  domain: string
  source: string
  position: string
}

export interface AuditApp {
  domain: string
  permissions: AuditPermission[]
}

export interface AuditGroup {
  /** 'direct' | 'position' */
  key: string
  label: string
  position: string | null
  /** 'Direct Assignment' | 'Position-Based' */
  source: string
  apps: AuditApp[]
}

export interface AuditPerson {
  staff_name: string
  found: boolean
  email: string
  groups: AuditGroup[]
  direct_count: number
  inherited_count: number
  permission_count: number
}

export interface AuditTreeRequest {
  staff_names: string[]
}

export interface AuditTreeResponse {
  success: boolean
  people: AuditPerson[]
}

// ── POST /api/report ────────────────────────────────────────────────────────
export interface AuditDecision {
  /** 'keep', 'revoke', or null for undecided. */
  decision: 'keep' | 'revoke' | null
  note?: string
}

export interface GenerateReportRequest {
  staff_names: string[]
  department?: string
  period_label?: string
  manager_name?: string
  audit_label?: string
  /** Keyed by AuditPermission.id. */
  decisions?: Record<string, AuditDecision>
  /** Keyed by AuditPermission.id → IT note. */
  highlights?: Record<string, string>
}

export interface ReportSummary {
  users_reviewed: number
  total_permissions: number
  kept: number
  revoked: number
  no_decision: number
}

export interface ReportResponse {
  success: boolean
  summary: ReportSummary
  /** Authoritative rendered HTML report. */
  html: string
}

// ── POST /api/review-document (returns text/html) ─────────────────────────────
export interface ReviewDocumentRequest {
  staff_names: string[]
  audit_label?: string
  manager_name?: string
  /** Permission ids to highlight. */
  flagged?: string[]
}

// ── POST /api/export (returns a CSV file download) ────────────────────────────
export interface ExportRequest {
  /** By StaffId, unlike every other endpoint, which uses StaffName. */
  staff_ids: string[]
  department: string
  audit_date?: string | null
}
