---
"@objectstack/plugin-security": minor
---

feat(security): RLS predicates that won't compile are surfaced, not silently dropped (ADR-0056 D4)

The RLS compiler previously dropped any `using`/`check` it could not parse (e.g. `==`,
`AND`/`OR`, ranges) in silence — if it was the only policy, the object lost protection
with no signal (the class of bug that left a showcase owner predicate inert for two PRs).
Now the compiler WARNS (via the security plugin's logger) when an **unsupported-shape**
predicate is dropped, distinguishing it from the intentional "context variable absent"
fail-closed skip. Also exports `isSupportedRlsExpression(expr)` so an authoring-time gate
(`objectstack compile`) can reject a predicate the runtime would never enforce. No change
to compiled filters for valid predicates; fail-closed semantics preserved.
