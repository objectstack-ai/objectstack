---
---

test(dogfood): reclassify flow `runAs` as enforced in the authz conformance ledger (#1888)

The `authz-conformance.matrix.ts` ledger still filed `flow-run-as` under
"Removed — by ADR-0049 (roadmap M2)", but #1888 implemented runAs for flow data
nodes (create/update/delete/query execute under the run's effective identity —
`system` bypasses RLS, `user` enforces it as the trigger user). Moved the entry
to the enforced section with its runtime site (`service-automation` engine →
`runtime-identity` → `crud-nodes`) and its dogfood proof
(`flow-runas.dogfood.test.ts`). Test-only ledger correctness; releases nothing.
