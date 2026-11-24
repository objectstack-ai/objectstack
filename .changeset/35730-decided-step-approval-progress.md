---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): a decided approval step shows its step and decision in "Approval progress" instead of an empty card

Clause-②: no
Metadata-protocol: none

On an approval request's page, a request decided at the first step of its flow, or decided in a one-step flow, showed an "Approval progress" card with nothing in it: the step line drew only from two steps up, a single-approver step has no tally, and nobody is pending any more. The step line now draws a decided request's route even when it is a single step, and marks the request's own step with its decision (Approved, Rejected, Returned for revision, Recalled or Cancelled) instead of drawing a rejected, returned, recalled or cancelled step as the step in progress. A pending request still needs two steps for a line, as before. A progress card with nothing to draw (no line, no tally, nobody pending) is no longer drawn at all.

New locale key: `approvalsInbox.statusCancelled` in every ui language pack. Inside `@object-ui/app-shell`, `ApprovalStepLine` gains an optional `decided` prop and its module exports a new `stepLineDraws` helper; neither is exported from the package entry, so the package's public exports are unchanged. No metadata changes.
