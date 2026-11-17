---
'@objectstack/plugin-approvals': minor
'@object-ui/app-shell': minor
'@object-ui/i18n': minor
---

feat(approvals): the approval request page shows the whole business record, not a six-field summary

Clause-②: yes (widening — new @object-ui/i18n locale keys only; no metadata or schema accept set)
Metadata-protocol: none

An approver used to see the request's amount and at most six fields under "As submitted", and had to open the business record to read the rest. The request page (`sys_approval_request_detail`) now draws the request whole, with no tabs: the header, the highlights, then the decision panel (`record:approval_decision`), last.

- **On top:** the deciding comment on a decided request, and the request's declared decision actions, unchanged.
- **Left, "As submitted":** every field of the request's snapshot the reader may read, in the sections and order of the target object's default record page, each through the record page's own cell. Field-level security is unchanged: the service's per-reader redaction and the client's field verdicts both apply. The panel reads the target record once (`findOne`, no params). A field whose current value differs from the submitted one is marked "Changed" with its current value. If the record cannot be read, nothing is marked and the card says so. Below the card are the record's child tables (owned `master_detail` children and `relatedList: 'primary'` tables). They are read-only and show CURRENT rows, with a note saying so, because the snapshot keeps the record's own row only.
- **Right rail, in this order:** approval progress (the step line, the decision tally, and who the request waits on), the record's attachment fields, and the request's activity (its `sys_approval_action` thread, newest first). The activity is read only when the reader's verdict allows reading that object. In the console the approvals route answers that read for every party to the request.

Nothing is editable on the page, and the snapshot's storage is unchanged. The record approvals panel and the request page now share one action-timeline component. New `approvalsInbox.*` keys in all eleven `@object-ui/i18n` packs: `snapshotChanged`, `snapshotCurrentValue`, `snapshotOpenRecord`, `snapshotCurrentUnreadable`, `snapshotChildCurrent`, `progressTitle`, `attachmentsTitle`.
