---
'@objectstack/spec': minor
---

Declare `continueRestoredRun` on the `IApprovalService` contract, so the approvals half of the operator repair pair is reachable through the published interface rather than only off the implementation class.

`IAutomationService.restoreConsumedSuspension` re-arms the pause a failed resume consumed and, by its own contract, does not replay the resume signal — the continuation must be re-issued. For an approval suspension nothing could re-issue it: every front door guards on a live request — `pending` for decide and send-back, `returned` for resubmit, and `pending` or the revise window for recall — and the stranding call leaves the row where none of them can issue the continuation it owes. The issuer landed as a class member on `plugin-approvals`; this declares it, so a caller programs against the contract instead of importing the implementation.

Additive and OPTIONAL, the way `cancelRun` / `restoreConsumedSuspension` are declared on `IAutomationService`: an existing implementation still conforms, and a service that does not declare the member has no operator door for it — a caller must probe for presence and refuse fail-closed rather than answer success for a verb it could not dispatch, because promising a repair verb that will refuse is worse than promising nothing. No REST or CLI route is declared or implied.
