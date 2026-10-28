---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): a read of `sys_approval_request` through the generic data door serves the flow and step labels in the reader's language

Clause-②: no
Metadata-protocol: none

Setup's approval request list, the request's record page, a lookup's title and the export read `sys_approval_request` through the generic data door, which served the stored `process_label` / `current_step_label` to every reader. A zh-CN user saw "Large Deal Approval" / "Sales Manager Review" there while the approvals inbox showed the same rows translated.

- **The same lookup as the approvals door.** The data door now overlays `process_label` and `current_step_label` with the app's language pack entries (`flows.FLOW.label`, `flows.FLOW.approvals.NODE.label`) for the reader's locale (`Accept-Language`, else the workspace `localization` settings), by the same lookup `GET /api/v1/approvals/requests` applies, so both doors serve the same text for the same row.
- **Stored text on a miss.** A label the pack does not carry, a locale no pack holds, a read with no locale and a system read are served the stored text, as before.
- **Same columns.** A read that selects a label without `process_name` / `current_step` is still served only the columns it selected; no column is added (`step_label` and `object_label` stay approvals-door fields).
- **Storage is untouched.** The overlay happens on the rows a read hands back; the stored labels stay the authored text as the request opened with it. Filtering, sorting and grouping on `process_label` / `current_step_label` still compare the stored text.
