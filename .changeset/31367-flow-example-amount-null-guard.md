---
'@objectstack/spec': patch
---

docs(spec): the `FlowSchema` example guards its nullable `amount` comparisons

Clause-②: no
Metadata-protocol: none

The `FlowSchema` doc-comment example branched on `record.amount < 500` and `record.amount >= 500` with no null test. Bound to an object whose `amount` is optional, as an author copying it would bind it, the publish-time null-guard rule refuses both edges: on a record-triggered flow a null `amount` aborts the condition and the run fails. The example now binds its start node to `order` (`record-after-update`), so the rule judges it as written; the auto-approve edge reads `record.amount != null && record.amount < 500`, and the review edge is the default edge (`isDefault: true`), so every other order, one with no amount included, goes to review.

The spec change is doc-comment text only: no schema shape changes, and no accept set moves.
