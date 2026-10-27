---
'@object-ui/app-shell': patch
---

fix(app-shell): a record locked by an approval is shown locked to a reader outside that approval

Clause-②: no
Metadata-protocol: none

A member who can read a record but is not on its approval (not an approver, not the submitter, no override) was offered inline edit while a `lockRecord: true` approval held the record, and the save was then refused with `409 RECORD_LOCKED`. The approvals list serves a request only to its participants, so the record page read that member's empty list as "no approval is running".

When the list finds no pending request, the record page now also reads the record's own lock, `client.approvals.getRecordLock(object, recordId)`, which the server answers to every caller who can read the record with `{ locked }` and nothing else. A locked answer shows the record locked: Edit is disabled, inline edit is not offered, and the "Locked for approval" band is drawn without a recall button, because a reader who cannot see the request did not submit it. The reader still sees nothing of the request itself (approvers, comments, attachments).

Unchanged: a pending request the viewer can see still decides with its own node's `lockRecord`, and a composition without the approvals service (the lock read answers `501`) still opens an answered empty record editable.
