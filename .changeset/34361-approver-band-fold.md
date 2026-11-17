---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): a record under approval shows the approver one folded band: a status line, the two decisions as buttons, and one menu for the rest

Clause-②: yes (widening — new @object-ui/i18n en keys only; no metadata/schema accept set)
Metadata-protocol: none

An approver who opens a record under approval used to see every declared decision action as its own button above the page body (Approve, Reject, Reassign, Send back, Request info, Reply, and Recall for an approver who also submitted), beside the record's own action row in the header. The band is now folded for any viewer the server says can act (`viewer.can_act === true`) once more than two of its actions are shown:

- a status line names the task, the step's number on the served route and its label, and the submitter ("You submitted this" for an approver who also submitted);
- the actions whose declared `variant` is `primary` or `danger` (today Approve and Reject) stay buttons; on a phone they share one row at equal width;
- every other action, including one declared with no variant, goes into one neutral "More approval actions" menu. Reply stays in that menu, so it is reachable on every layout.

The business record page and the approval request page draw the same band. Each folded action keeps its own `visible`, `disabled` and permission gates and its own dialog, and sends the same request. Menu actions still count as drawn for `onDrawnActionsChange`. The record's header actions do not move.

Unchanged: the submitter who holds no slot, the override-only administrator (who keeps the existing admin-override fold), a backend that sends no `viewer` block, and any host that does not pass the new `foldDecisions` prop to `DeclaredActionsBar`.

New `@object-ui/i18n` keys, in every pack: `approvalsInbox.awaitingYourDecision`, `approvalsInbox.stepNumber`, `approvalsInbox.submittedByName`, `approvalsInbox.moreDecisionActions`.
