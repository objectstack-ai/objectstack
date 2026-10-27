---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): after an approver's own decision ends their read, the record page says so instead of "Record not found"

Clause-②: yes
Metadata-protocol: none

A pending approver with no standing access reads the record only while their approval step waits, and the server revokes that read when the step ends. The record page re-reads the record after every decision taken from its approval bar, so for that approver the re-read answered 404 and the page drew "Record not found" right under the "Approved" toast, for a record that exists.

What changes:

- When that re-read answers 404 right after this viewer's own decision on this record, the page draws "Decision recorded" with "Your approval step is complete, so your access to this record has ended." and a link to the approvals inbox (`/apps/APP/system/approvals`, in the app the page is open in).
- Any other 404 still draws "Record not found": a record that never existed, a record opened with no decision, and another record opened after the decision.
- An approver who keeps standing access still sees the record after deciding, as before.
- The read is not kept any longer than the step: this is copy, not access.
- `@object-ui/i18n` adds `empty.recordAccessEnded` and `empty.recordAccessEndedDescription` in all ten locales. The link reuses `notifications.openApprovalsInbox`.

What to do: nothing.
