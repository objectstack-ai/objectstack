---
'@objectstack/plugin-approvals': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

feat(plugin-approvals): a record's activity shows its approval steps, to the users who can read its approvals

Clause-②: no
Metadata-protocol: none

A record under approval used to show no approval in its activity: nothing wrote an activity entry for an approval step, so the activity stream's one-line approval entry was reachable only from items a host supplied by hand.

- **One activity entry per approval step.** plugin-approvals now appends one `sys_activity` entry for each step it records in its decision log, about the record the request governs: submitted, approved (`Approved · Manager review`, the step's label after the dot), rejected (`Rejected · Manager review`), sent back for revision (`Sent back for revision · Manager review`), resubmitted, recalled, and cancelled (the record was deleted). Other actions (a reminder, a reassignment, a thread comment, …) write none, and an object that sets `enable.activities: false` gets none, as the CRUD mirror writes none for it. The entry carries no decision comment. It follows ADR-0052 §5, so no published vocabulary changes: `type` is the built-in `system`, the domain kind is `metadata.kind: 'approval'` (with the step's action, its label and the flow and step names beside it), and `source_object` / `source_id` name the request. A deployment without plugin-audit has no `sys_activity` and gets no entries.
- **Each entry reads in the reader's language.** The stored `summary` is the English line from plugin-approvals' own catalog (`approvalActivity*` messages, shipped in all eleven of its locales). A read that carries a locale is served the line re-composed in that locale, and the step's label is read from the app's language pack (`flows.<flow>.approvals.<node_id>.label`) the way the approvals tab reads it, else the stored label: a zh-CN reader sees `已批准 · 经理审批`. A system read, or a read with no locale, gets the stored English line. A failed append never fails the approval step; it is logged once at `error`.
- **Only the users who can read the record's approvals read those entries.** A read of `sys_activity` keeps an approval entry only when the approvals service would serve the caller its request: a participant (submitter, current or past approver), the override actor, or a reader of the record where the object opts into `enable.approvalsVisibleToReaders`. Every other entry is served as before, and plugin-audit's rule that the record must be readable still applies. The record page's activity count and its rows agree.
- **The stream draws each entry as the approval line, and 「看审批」 opens the approvals.** The console reads an activity row with `type: 'system'`, `metadata.kind: 'approval'` and a `sys_approval_request` source as the `approval` feed kind (`APPROVAL_ACTIVITY_FEED_TYPE`, exported from `@object-ui/plugin-detail`), so `approval` now counts as produced. The record page supplies the new `RecordViewApprovalsContext`, and the approval line's 「看审批」 opens the record's 审批 tab, the same place the approval tag in the header opens; with no approvals the reader is served, the line has no link. The entry keeps `sys_activity`'s own lifecycle (reaped after 14 days); the 审批 tab keeps the full history.
