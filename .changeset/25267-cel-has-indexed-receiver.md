---
'@objectstack/formula': minor
---

fix(formula): `has()` over a selection whose receiver is an index or a call result evaluates as a presence test, as the CEL spec defines it

Clause-②: yes (widening)
Metadata-protocol: added

The CEL spec defines `has(e.f)` for any expression `e`. The engine used to refuse every such argument whose selection chain was not rooted in a plain name — `has(data.environments[0].storage.usedMb)`, `has(record.items[0].name)`, `has(dyn(x).y)` — with `has() invalid argument`, at evaluation and at `compile` / `validateExpression` alike. A page or view `visibleWhen`, whose publish gate checks syntax but not types, published such a predicate and then failed open in the console.

- **What now works.** The call is a presence test on the last field: `true` when the receiver has the key, `false` when it does not, and a fault (`No such key`) when a step before the last one is absent, exactly like `has(record.a.b)`. `evaluate`, `compile`, `validateExpression`, `firstUndeclaredReference` and `inferCelType` all give that one answer.
- **What widens.** Object, flow, action, sharing-rule and hook predicates that `validateExpression` used to refuse for this argument now pass. They evaluate as written.
- **What is still refused.** An argument the spec itself refuses: a bare name (`has(status)`) or an index as the last step (`has(record.items[0])`). Test a key with `'key' in m`, or a list position with `size(list) > n`.
- **Nothing to migrate.** A predicate already written in the `'key' in e` form keeps working and answers the same.
