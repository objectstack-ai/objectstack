---
"@objectstack/objectql": minor
---

fix(objectql): `ObjectQL.delete`'s by-id cascade is one unit of work (#7413)

`delete()`'s by-id branch ran `cascadeDeleteRelations` and then `driver.delete`
with **no transaction around either**, and the cascade re-enters
`this.delete()` / `this.update()` per dependent row — so every child committed
as it executed. A refusal partway (the engine's own `restrict` branch, a child's
permission check, a later child's `beforeDelete` hook) left an arbitrary
**prefix** of the children deleted while the caller received 409/403 and
reasonably concluded nothing had happened. Children are visited in
`getAllObjects()` order, so *which* rows were gone was arbitrary from the
caller's point of view, and a partial delete has no natural undo.

This is #4620's principle — *`atomic` honoured for real, or refused* — applied to
the path that never got it. The by-id delete and its whole cascade now run
inside one `engine.transaction()`: a refusal anywhere rolls back every child
delete and every `set_null` FK clear, so a 409 honestly means nothing changed.
The recursion **joins** that transaction rather than nesting under it (ADR-0067
D2 / #5696), so a multi-level cascade opens exactly one driver transaction on
one connection instead of one per record.

**Behaviour change**, and the reason for the `minor`: a by-id delete that
refuses mid-cascade used to leave earlier children deleted and now leaves
nothing deleted. Callers that (knowingly or not) depended on the partial effect
— e.g. treating a 409 as "some children were cleaned up" — see the prefix
restored instead.

Two deliberate limits, both chosen from a driver census rather than from taste:

- **No `require: true`.** `transaction()` can fail closed on a driver without
  `beginTransaction` (#5696 point 1), and this call does not use it. `delete()`
  never asked for atomicity, so it must not *start refusing* on a runtime that
  cannot roll back; `require: true` here would turn an ordinary delete into a
  `TransactionUnsupportedError` on every non-conforming driver — ~50 in-tree
  test doubles and any embedder's partial driver — while buying nothing on real
  ones, because `beginTransaction` is a **required** member of `IDataDriver` and
  all five in-tree drivers (memory, sql, sqlite-wasm, turso, mongodb) implement
  it. The declared degrade (ADR-0119 D1) stands, and since #4619 it warns once
  per driver. **The cost of that choice, stated plainly:** on a driver that
  cannot roll back, the partial-cascade window remains exactly as before, now
  reported as a `warn` line rather than a refusal.
- **A cross-datasource cascade keeps its old, non-atomic answer.** A transaction
  covers one driver's connection (ADR-0119 D1 — no two-phase commit), so when
  the cascade reaches an object routed off the default datasource, wrapping it
  would not make it atomic; it would make it *fail*, because
  `enforceTransactionOrigin` refuses a business write inside a transaction that
  does not cover it (#5351 / #5696 point 2). Such a delete works today, and a
  hard refusal is strictly worse than the non-atomic answer it has always had,
  so it runs unwrapped and says so once per object.

A delete with nothing referencing the object opens no transaction and emits no
warning — that path is unchanged, and is pinned as the control.
