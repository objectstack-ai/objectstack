---
'@objectstack/spec': patch
---

docs(spec): the `FlowSchema` example guards its nullable `amount` comparisons

Clause-②: no
Metadata-protocol: none

The `FlowSchema` doc-comment example branched on `record.amount < 500` and `record.amount >= 500` with no null test. Bound to an object whose `amount` is optional, as an author copying it would bind it, the publish-time null-guard rule refuses both edges: on a record-triggered flow a null `amount` aborts the condition and the run fails. The edges now read `record.amount != null && record.amount < 500` and `record.amount == null || record.amount >= 500`, so an order with no amount goes to review instead of failing the run or being auto-approved.

The spec change is doc-comment text only: no schema shape changes, and no accept set moves.
