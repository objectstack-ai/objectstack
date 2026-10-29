---
'@objectstack/spec': patch
'@objectstack/plugin-security': patch
'@objectstack/runtime': patch
'@objectstack/rest': patch
'@objectstack/client': patch
---

feat(security): a dismissed or revoked suggested audience binding can be re-opened, back to pending

Clause-②: yes (widening)
Metadata-protocol: none

Once an admin dismissed a pending audience-binding suggestion, or revoked an accepted one, the row stayed `dismissed` and nothing in the product could take that "no" back: `confirm` accepts only pending rows, and the reconciliation never moves a dismissed row. A new door re-opens it:

- **`POST /api/v1/security/suggested-bindings/:id/reopen`** moves a `dismissed` row back to `pending`, exactly as if it had never been answered (`deployment_decision` false, `resolved_by` / `resolved_at` cleared). It is served by both mounts of the family: the REST route and the dispatcher's `/security` domain.
- **Re-opening grants nothing.** A pending row is not an acceptance, so a revoked set stays out of the `everyone` anchor's definition until `POST …/:id/confirm` accepts it again, and that accept runs the ADR-0090 D7 high-risk gate like any other.
- **Refusals.** The same authority as the other doors (`manage_metadata`; under a walled posture, the platform operator; `403` otherwise), the same walled-host refusal naming `acceptedDefaultPermissionSets` (`409`), `404` for an unknown id, and `409 SUGGESTION_STATE` for a row that is not `dismissed` (the message names its status) or whose set its package no longer suggests. The last keeps the decision on record: a re-opened row with no declaration would be pruned by the next reconciliation.
- **Contract.** `ISecurityService` gains the OPTIONAL member `reopenAudienceBindingSuggestion(callerContext, id)`. A security service without it still satisfies the contract; both routes answer `501 NOT_IMPLEMENTED` naming the door, and every dismissal stands. plugin-security serves it and exports `reopenAudienceBindingSuggestion`.
- **SDK.** `client.security.suggestedBindings.reopen(id)`.
