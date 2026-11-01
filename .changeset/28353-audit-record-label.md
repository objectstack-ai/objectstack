---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): the audit log's and activity's `record_id` field is labelled "Record", not "Record ID"

Clause-②: no
Metadata-protocol: none

The column shows the target record's name and icon, so the header "Record ID" told an administrator reading the audit log (the `recent`, `writes_only`, `record_views` and `all_events` list views) or an activity's Details tab to look for an id that is not there. The label now reads "Record", and 记录 (zh-CN), レコード (ja-JP) and Registro (es-ES), the words the approval objects already use for their own `record_id`. Only the label moves: the field name `record_id`, its queries, its seeds and its pointer pair with `object_name` are unchanged.
