---
"@objectstack/plugin-approvals": patch
"@objectstack/spec": patch
---

feat(approvals): enrich inbox rows with `payload_labels` (snapshot field labels)

The approvals inbox summary title-cased raw snapshot machine keys
(`assessment_status` → "Assessment Status") because the API sent no field
labels. `ApprovalService.enrichRows` now attaches `payload_labels` (snapshot
field key → the target object's field label), symmetric with the existing
`payload_display` (which resolves the values), and `ApprovalRequestRow` gains
the field. For a single-locale project the schema label is already the
localized string, so a client can render the human field name (e.g. "考核状态")
instead of a prettified English key.
