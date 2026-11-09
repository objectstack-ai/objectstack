---
'@objectstack/rest': patch
---

fix(rest): the approvals request list's refusal of a non-string `status` says what the parameter takes, instead of quoting `[object Object]`

Clause-②: no — the same requests are refused with the same status and envelope; only the message for a non-string `status` changes
Metadata-protocol: none

`GET /api/v1/approvals/requests?status[$ne]=pending` (a `status` the query parser turns into an object) was refused with `"[object Object]"` quoted as if it were the value sent. It is now refused with `The "status" query parameter must be one status, or several separated by commas, given as plain text. Allowed values: pending, approved, rejected, recalled, returned, cancelled.` Still `400 VALIDATION_ERROR` in the nested envelope, and the approval service is still not asked. The approvals docs page now lists all six request statuses (`cancelled` was missing).
