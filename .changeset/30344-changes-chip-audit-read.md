---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
---

fix(app-shell,plugin-detail): the record page offers its 变更 (Field changes) chip, and the activity panel its Field Changes option, only to a reader whose audit-log read answers

Clause-②: no
Metadata-protocol: none

On an object with `enable.trackHistory`, the record page's 动态 (Activity) tab offered the chips 全部 / 活动 / 讨论 / 变更 whenever `sys_audit_log` was registered, whatever this reader was allowed to read. A member the server refuses the audit read to (403) got a 变更 chip that always showed nothing, which reads as "nobody changed this record". The page now offers 变更 only once this reader's `sys_audit_log` read has answered. A refused or failed read offers no 变更 chip, exactly as history off does, and the chip joins the others when the read answers. Nothing else waits on the read: the page payload still asks the field changes as before, and the stream's count already counts a refused audit read as no field change.

The activity panel's filter dropdown follows the same rule: it offers Field Changes (`changes_only`) only when the stream would offer its 变更 chip. A host that says nothing keeps every option, as before. A `changes_only` filter that is no longer offered reads as All Activity.
