---
"@objectstack/spec": minor
"@objectstack/service-analytics": minor
---

feat(analytics): correct analytics over federated objects (ADR-0062 Phase 3, D6)

Analytics over an external (federated) object now aggregates against the
**correct** remote table instead of silently querying the wrong one. The
`NativeSQLStrategy` hand-compiles `FROM "<object>"` and bare column references,
which bypass the driver's physical-table resolution (`external.remoteName` /
`remoteSchema` / `columnMap`). It now **declines** any query whose base or joined
object is federated, routing it to the `ObjectQLStrategy` — whose
`engine.aggregate()` goes through the driver's `getBuilder` and already honours
`remoteName`/`remoteSchema` (#2138/#2149). This "reuses the driver's resolution"
(D6) rather than re-implementing it.

Adds an optional `StrategyContext.isExternalObject(objectName)` hook (reported by
the analytics plugin from the object's `external` block). Purely additive — with
no hook, behavior is unchanged for managed objects.
