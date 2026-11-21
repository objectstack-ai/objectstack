---
'@objectstack/scenarios': patch
---

fix(scenarios): an `applied` operation whose gated action met `428 no_confirmation_service` is not measured, not failed

Clause-②: no
Metadata-protocol: none

An operation a card declares `applied` (leave_balances `delete_withdrawn_request`: the person names exactly one row, so the agent may delete it) failed when the agent took the card's own confirm-gated action instead of the direct delete. On a server with no pending-confirmation service the action door answers every gated call `428 ACTION_CONFIRMATION_REQUIRED`, `details.reason: 'no_confirmation_service'`, whatever the agent sends, so that route can apply nothing there. Such an operation is now not measured, out of passed and total, with the reason `noConfirmationServiceOnGate`, the way the confirmed write of a `pending_confirmation` operation already is on the same server. A write that then reached the target through a raw data door is not measured too. The direct named delete grades `applied` as before, a `428` with any other reason stays measured, and on a `pending_confirmation` operation the same answer is still the hand-off to the person and passes.

New, additive: `OperationObservation.metNoConfirmationService` (set by `observeOperation`), the reason `noConfirmationServiceOnGate`, and the runner's `metNoConfirmationService(output)` predicate, which the confirmation turn already used.
