---
'@object-ui/console': patch
---

fix(console): the audit log's Object column and detail drawer show the object's label

Clause-②: no
Metadata-protocol: none

Setup › Audit Log printed each row's stored `sys_audit_log.object_name` (`crm_account`, `sys_flow_dispatch`) in the Object column, the detail drawer's title and its target-record line, while the same page's Object filter already labelled the served objects. In a Chinese console a row therefore read 更新 beside `crm_account`, and telling which business object changed meant knowing its API name.

All three now show the object's served label, read from the same served objects as the Object filter (the new `objectLabelOf` beside `objectFilterOptionsOf` in `AuditLogPage.tsx`, sharing one reading of each object). They show the label alone; the filter keeps its `Label (name)` choices. An object the metadata does not serve, or serves without a label, shows its stored name, as before. The filter and the list fetch are unchanged.
