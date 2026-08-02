---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": minor
---

feat(spec,metadata-protocol): `IObjectQLEngine.transaction` joins the slot contract, and `batchData`'s `atomic` flag becomes real — rollback or refusal, never silent best-effort (ADR-0118 D1/D4, #4612)

**D1 — the contract fix.** `ObjectQL.transaction()` — ADR-0034's ambient
transaction, shipped since v8.0.0 — was reachable from plugin space only
through `as unknown as` casts: the metadata protocol's atomic publish and its
`transactionalBatch` discovery probe, and the sys-metadata repository's
`withTxn`, each declared a private structural slice of an engine none of them
import. It is now declared on `IObjectQLEngine`, required per that contract's
own rule, with its caveats written into the TSDoc as part of the declared
meaning rather than left to be discovered: it covers the **default driver
only**, and when that driver has no `beginTransaction` the callback runs with
no transaction and no rollback. `MetadataHostEngine` and the sys-metadata
repository's engine surface now type their optional member as
`IObjectQLEngine['transaction']`, so a narrow host surface can no longer drift
from the real signature. Runtime `typeof === 'function'` probes stay — that is
test-double defence the type system does not replace.

**D4 — the honesty fix.** `batchData`'s `options.atomic` promised "rollback
entire batch on any failure (transaction mode)" and delivered a `break`
statement. Every write before the failure stayed committed, and — the part that
did the real damage — the response reported those rows `success: true` under
the one flag whose job is to guarantee they were undone.

Now an explicitly atomic batch runs inside ONE `engine.transaction()`: the
first failure rolls back every prior write, and the response says so
(`succeeded: 0`, with rows marked `ROLLED_BACK:` / the causal error /
`NOT_ATTEMPTED:`, and no row reporting success). On a runtime that cannot roll
back — no `transaction()`, or a default driver without `beginTransaction` — an
atomic request is **refused** with `501 NOT_IMPLEMENTED` rather than silently
degrading, matching the cross-object `/batch` route. `atomic` takes precedence
over `continueOnError`, whose own description already scoped it to
`atomic=false`. In atomic mode the upsert path no longer falls back to an
insert when its update throws: inside an aborted transaction that fallback can
only fail with a secondary error that buries the real cause.

**Aligned declaration.** `BatchOptionsSchema.atomic` declared `.default(true)`
while no enforcement site delivered atomicity — and the REST route forwards the
original request body rather than the parsed output, so the declared default
never reached the loop at all. The default is now `false`: the declaration is
aligned down to what every site already does, rather than up to what none of
them did. Honouring the old `true` would have silently flipped the failure
semantics of every existing batch caller and hard-failed ordinary batches on
any driver that cannot transact. Callers who were explicitly sending
`atomic: true` now get what they always asked for; callers sending nothing keep
today's behaviour exactly.

If you were passing `atomic: true` and relying on partial results surviving a
failure, that was the bug — switch to `atomic: false` (or omit it) for
best-effort semantics.

ADR-0118 also rules on two items landing separately: D2 specifies a
framework-owned migration-journal runner for multi-step migrations too large
for one transaction, and D3 retires the declared-but-unimplemented
`IDataEngine.batch?`.
