---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): a partly failed bulk approve or reject in the Approval Center says why each row failed

Clause-②: no
Metadata-protocol: none

A bulk approve or reject that partly fails used to show "3 succeeded, 2 failed: Quote A, Quote B": at most three record titles, and no reason. Each failed row now keeps its refusal's text, read the way the single-row Approve reads it: the server's `userMessage` (already in the decider's language) when the refusal carries one, else the page's line for the refusal (not allowed, already decided, no longer exists), else a generic "Action failed".

The error toast reads "N succeeded, M failed" and lists the first three failed rows, one per line, each as "title: reason". When more rows fail, the toast stays until dismissed and carries a "Show all (M)" action, which opens a dialog listing every failed row with its reason.

`@object-ui/i18n`: the `approvalsInbox` namespace replaces `bulkPartial` with `bulkPartialSummary`, `bulkFailureLine`, `bulkFailuresShowAll`, `bulkFailuresTitle`, `bulkFailuresBody` and `close`, in every locale pack.
