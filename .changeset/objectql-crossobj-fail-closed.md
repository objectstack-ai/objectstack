---
"@objectstack/service-analytics": patch
---

fix(analytics): fail closed on cross-object aggregation the ObjectQL path cannot join (#3654)

`engine.aggregate()` has no join — it never expands a lookup and the SQL driver's
aggregate emits no `JOIN`. So a dotted dimension/measure like `account.region`
reaching `ObjectQLStrategy` (the fallback NativeSQL declines: date-granularity
bucketing, in-memory driver, federated objects) failed SILENTLY: the in-memory
path bucketed every row under one `(null)` group and summed the whole table into
it (a plausible number that is actually a mislabelled full-table total), and the
native path errored on the unresolved column.

`ObjectQLStrategy` now rejects any cross-object reference outright, with a clear
message, before the query reaches the engine. This generalizes the #3597 guard
(which only rejected when the joined object carried a read scope, and skipped the
check entirely when no read-scope provider was configured — so the silent
`(null)` bucket still shipped on unsecured/in-memory setups) into an
unconditional one, and subsumes it: a rejected query never loads the joined
object, so there is nothing left unscoped.

Cross-object datasets are unaffected on `NativeSQLStrategy`, which hand-compiles
the LEFT JOINs (and scopes each). This only changes the fallback path, turning a
silent wrong answer into a loud, actionable error. Full lookup-traversal support
in the aggregate path is left as follow-up (see #3654).
