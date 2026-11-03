---
'@object-ui/console': patch
---

fix(console): the audit log's Action column and detail drawer show the declared action label

Clause-②: no
Metadata-protocol: none

Setup › Audit Log printed each row's stored `sys_audit_log.action` value (`update`, `create`) in the Action column's badge and in the detail drawer's title badge, while the same page's Action filter already offered the declared option labels. In a Chinese console the column therefore read in lowercase English beside a filter reading 更新 / 创建.

Both badges now take the label of the row's action from the filter's own choices (`actionFilterOptionsOf`, through the new `actionLabelOf` in `auditLogActions.ts`), so the badge and the filter name an action alike. An action no option declares shows its stored value, as before. The badge tones, the filter and the list fetch are unchanged.
