---
"@objectstack/service-automation": patch
---

fix(automation): close the default-routable footgun on refuse-to-execute guards (#3863)

#3881 stopped a `fault` edge from swallowing a guard refusal, keyed on
`NodeExecutionResult.errorClass`. That field defaults to `'runtime'`, which was
right for compatibility — every executor written before the split keeps its
routing — but it leaves the footgun pointing the other way: **a new guard is
routable unless its author remembers to classify it**, and forgetting is silent.
Nothing in the type system catches it.

Three changes close that for the guards that exist and make the next one hard to
get wrong.

**`refuseNode(reason)`** — one call that returns a guard-class failure, so
"write a guard" and "mark it un-routable" become the same act. Its doc states
the test for using it: re-running unchanged can never succeed AND the fix is to
edit metadata. It also states the inverse, because over-marking is not the safe
direction — classifying a handleable condition as `guard` turns a recoverable
integration into a dead run.

**Five guards that were never marked** are now un-routable. All are missing
required config or a defective graph, none can succeed on a retry:

- `http` with no `url`
- `subflow` with no `config.flowName`, and `subflow` exceeding max nesting depth
  (a recursive graph nests exactly as deep next run)
- `map` with no `config.flowName`
- `connector_action` with no `connectorId` / `actionId`

The seven `crud-nodes` guards from #3881 move to the helper — same behaviour,
one spelling.

**A behavioural inventory test** drives every known guard through the engine
with a fault edge attached and asserts it is still fatal, matching on the
refusal text so a guard failing for a different reason cannot pass vacuously.
Verified to have teeth: un-marking one guard fails its row immediately. The
negative half is pinned too — a plain node failure and a thrown error must still
route, since that is what fault edges are for.

Deliberately **not** marked, and why: a degraded connector (#3017 says recovery
is automatic), a collection that did not resolve to an array, a collection over
the iteration cap, and a subflow that failed on its own. Those are conditions
the world caused, and an author must be able to handle them.

Considered and rejected: making `errorClass` required on the result type. It
would enforce classification at compile time, but it breaks every node executor
returning a failure — 281 call sites across the repo plus third-party
executors — for a type-only gain over the helper.
