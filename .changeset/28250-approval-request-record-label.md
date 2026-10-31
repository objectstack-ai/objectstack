---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): the approval request's `record_id` field is labelled "Record", not "Record ID"

Clause-②: no
Metadata-protocol: none

The column shows the target record's name and icon, so the header "Record ID" told an administrator reading Setup › Approval Requests to look for an id that is not there. The new label reads "Record" in every approvals list view, the request's highlights strip and its Details tab, and in the zh-CN (记录), ja-JP (レコード) and es-ES (Registro) packs, matching the approval action's own `record_id` label. Only the label moves: the field name `record_id`, its queries, its seeds and its pointer pair with `object_name` are unchanged.
