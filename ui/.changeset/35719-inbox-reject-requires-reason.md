---
"@object-ui/console": patch
"@object-ui/i18n": patch
---

Clause-②: no (narrowing)
Metadata-protocol: none

fix(console): rejecting from the approvals inbox requires a reason (objectstack#35719)

The approvals inbox's row Reject confirmation, its bulk Reject confirmation and the `r` key (which opens the row confirmation) keep Reject disabled until the reason box holds a non-blank reason; the box is no longer labelled optional, in all eleven locale packs (`approvalsInbox.comment`). The approvals route now refuses a reject without a reason, so before this an empty box answered an error per request. Approve is unchanged and takes no reason.
