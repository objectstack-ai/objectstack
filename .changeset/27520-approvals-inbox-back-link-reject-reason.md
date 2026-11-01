---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): the approvals inbox keeps a way back from a record, takes an optional reason on Reject, and marks requests you submitted

Clause-②: yes (widening: `@object-ui/i18n` gains the `approvalsInbox.submittedByYou` key in all ten locales; no accept set moves)
Metadata-protocol: none

- **Back to the inbox.** A row's record link still opens the record in the inbox's own app. When that app's navigation does not list the record's object (the Account app lists the inbox), the record page had no way back. The link now hands the record page the same origin a list row does, so the page draws "‹ Approvals Inbox" above the record.
- **Reason on Reject.** The Reject confirmation, for one row and for a bulk selection, offers an optional comment. What the approver types is sent as the reject call's `comment`, which the approvals service already records on the request's timeline. Left empty, the reject is sent as before.
- **"You submitted this".** A request the viewer submitted shows "You submitted this" beside the requester, read from the server's `viewer.is_submitter`. It informs the decision and gates nothing; who may decide a request is unchanged. The Submitted by me tab does not repeat it on every row.
