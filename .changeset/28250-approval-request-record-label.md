---
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-audit': patch
---

fix: a `record_id` field the console draws as the record it points at is labelled "Record", not "Record ID"

Clause-②: no
Metadata-protocol: none

The console draws a `record_id` that declares `referenceVia: 'object_name'` as the target record (its object's icon and name, the id only as the tooltip), so the header "Record ID" told the reader to look for an id that is not there. Three objects carry such a field where the console draws it that way, and each now reads "Record", with the zh-CN (记录), ja-JP (レコード) and es-ES (Registro) packs following, matching the approval action's own `record_id` label:

- `sys_approval_request` (`@objectstack/plugin-approvals`): Setup › Approval Requests, all four list views, the request's highlights strip and its Details tab.
- `sys_audit_log` (`@objectstack/plugin-audit`): the audit log list views and the record's Details tab.
- `sys_activity` (`@objectstack/plugin-audit`): the activity's Details tab.

Only the label moves: the field names, their help text, queries, seeds and pointer pairs are unchanged. `sys_mail_association.record_id` keeps "Record ID": the only place its record page shows it is the highlights strip, which draws the stored id as text.
