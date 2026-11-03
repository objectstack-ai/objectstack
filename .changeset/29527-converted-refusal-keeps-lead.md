---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(objectql, runtime): a converted stale-roll-up refusal that a sandboxed hook body lets leave keeps its lead and its `cause`, and one that escapes a transaction whose rollback threw no longer claims a rollback

Clause-②: no
Metadata-protocol: none

- A sandboxed hook body whose `ctx.api` write was refused because a nested write's roll-up could not be recomputed (a delete whose cascade stopped, a transaction that rolled back) used to hand that refusal out of the QuickJS runner as a `SandboxError`. The hook-dispatch seam did not recognise it, so the outer write's caller read the hook's own write ("The delete of …") and the original `ERR_SUMMARY_RECOMPUTE` refusal was gone from `cause`. The runner now hands the engine's own refusal back out when the body let it leave unchanged, as it already did for the duplicate-record refusal, so the seam leads with the write the hook is bound to (every hook event, the read events included) and `cause` keeps the original refusal. A body that catches it and throws its own error, or rewrites it first, is relayed as before.
- `ObjectQL.transaction` whose rollback threw now hedges an already-converted refusal too: it leads with "The transaction did not complete, and its rollback failed too", instead of keeping the cascade's or hook's "under a transaction that rolls back nothing was written".
- Status and code are unchanged at every door: `500 INTERNAL_ERROR`.
- `@objectstack/objectql` exports `isUnlandedWriteRefusal(e)`, the predicate the runner asks of a host call's rejection.
