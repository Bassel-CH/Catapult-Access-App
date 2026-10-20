# Catapult Applications Audit

## Glossary

Use these words, in code, comments, commit messages and on screen. Existing
code that uses the other words doesn't need a sweep; switch it to these when
you're changing it anyway.

| Say | Meaning | Not |
|---|---|---|
| **Catapult Applications Audit** | The app's name. | "Audit Filter", "Department Access Audit", "Catapult Access App" |
| **staff member** / **staff** | Someone whose permissions are being audited: the people in the CSV, identified by `StaffName`. In code, `AuditPerson` / `person` / `people` mean one staff member's audit tree. | "user" |
| **user** | Someone using this app: IT doing the setup, or a manager doing the review. | Staff being audited |
| **app** | One application a permission belongs to: the CSV's `DomainName`. | "domain", except when naming the CSV column |
| **highlight** | IT marking a permission for the manager's attention, with an optional note. The review-packet request calls this `flagged`; it's the same thing. | "flag" |
| **decision** | A manager's Keep or Revoke on one permission, or none yet. | |
| **session** | One upload's private data, held in memory (`UploadedDataset`) until "Start a new audit" or 60 idle minutes. | |

Known places still using the old words, to change when touched: the IT setup
screen says "users" for staff ("Select users", "No users match"); the
review-packet request field `flagged`.
