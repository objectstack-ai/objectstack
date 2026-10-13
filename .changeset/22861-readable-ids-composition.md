---
'@objectstack/objectql': minor
'@objectstack/core': patch
---

feat(objectql): the engine composes a `ReadableIds` leaf at its executor boundary, on the final query immediately before the driver call, and refuses it by name wherever it cannot (ADR-0139 D2, D5)

Clause-②: no

- **Composed.** On `find`, `findOne`, `count` and `aggregate`, after the middleware chain and the `beforeFind` hooks, every `{ FIELD: { $in: ReadableIds.of(P) } }` in `where` is replaced by `ReadableIds.compose(leaf, scope)`, where `scope` is the registered security service's `getReadFilter(P, caller)`, marked `'policy'` (`undefined` composes with no row restriction). The comparand becomes `$in: []`, which matches no row, when:
  - `canReadObject(P, caller)` is false or throws (a service without `canReadObject` is asked `explain`, and only `allowed: true` admits);
  - `getReadFilter` answers `RLS_DENY_FILTER` (by identity) or throws;
  - no security service is registered, or the registered one cannot answer both halves;
  - the registry holds no object `P`.

  Each parent object is asked once per read, and nothing is kept across reads. A leaf that a middleware or a `beforeFind` hook writes is composed the same way.
- **Refused, `INTERNAL_ERROR` / 500, before any driver is asked:**
  - on `update` and `delete`: the caller's leaf at the comparand door, a middleware's at the executor's entry, before the prior-row reads;
  - in `having` and in an aggregation's own `filter`;
  - anywhere but a `$in` comparand, including a leaf the array form of `where` lowers into another position;
  - a composed leaf the engine did not compose, written by a middleware or a hook (the caller's own, as a `$in` comparand, stays the comparand door's `INVALID_FILTER` / 400);
  - ADR-0139 D5's three classes: a delegated (on-behalf-of) caller, a parent with an object-scoped read middleware, and a parent bound to another datasource than the object read.
- **New:** `ObjectQL.registerSecurityServiceSource(source)`. `ObjectQLPlugin` calls it in `init()` with a source that reads the kernel's `security` service when a leaf is composed, never at init.
- **Before:** the comparand door refused every `ReadableIds` leaf `INTERNAL_ERROR` / 500 ("this engine does not compose that leaf yet"), and a leaf that a middleware or a hook wrote reached the driver unrefused.
- **`@objectstack/core`:** `resolveFilterTokens` returns a `ReadableIds` leaf by reference. When the filter also held a placeholder, it used to rebuild the leaf as a plain `{ object }` and drop its brand.
- **Not yet:** no driver evaluates the composed leaf (ADR-0139 E3 and E4), and no code in the platform writes a `ReadableIds` leaf today.
