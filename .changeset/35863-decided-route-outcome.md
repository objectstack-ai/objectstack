---
'@objectstack/spec': patch
'@objectstack/plugin-approvals': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(approvals): a decided request's step line says where the record's approval went next: on to a later step, or ended

Clause-②: yes
Metadata-protocol: none

The single approval request read (`GET /api/v1/approvals/requests/ID`) serves one more fact on a decided request's own route: `flow_route.outcome`, beside `ahead: 'decided'`. Before, a decided route stopped at the request's own step, so an approver reopening a request they had decided could not tell whether the record's approval went on to a later step or ended.

- `outcome.step` is the run's latest request when it is a later one than this request (a request of the same flow run opened after it, on any node, a later round of the same node included; a pending one wins over a decided one). It is absent when no later request was opened.
- `outcome.status` is that latest request's status, or this request's own when `step` is absent. `pending` with a `step` means the approval went on to that step and waits on its decision.
- `outcome.ended` says whether the flow run has stopped for good, read off the run's own status with the same terminal set the dead-run sweep uses.

`outcome` is absent when nothing past the request is known: no later request was opened and the run has not ended, the run cannot be read, or several later requests are pending at once (parallel steps). A pending request's route never carries it. The `ApprovalRequestRow.flow_route` contract type in `@objectstack/spec/contracts` gains the optional member, and `routeOutcome` in `@objectstack/plugin-approvals` is the rule.

The approval request page (`@object-ui/app-shell`) draws one line under the decided step: "Went on to STEP, waiting for a decision", "Went on to STEP: DECISION", "Went on to STEP, then ended: DECISION", or "The approval ended here". No line is drawn when no outcome is served. `@object-ui/i18n` carries the four new `approvalsInbox` rows in every built-in locale, and the console's request type (`@object-ui/console`) mirrors the new member.

Nothing to migrate: a caller that does not read `outcome` is unaffected.
