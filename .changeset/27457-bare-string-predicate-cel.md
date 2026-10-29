---
'@object-ui/core': patch
---

fix(core): a bare-string predicate is read as CEL, the way the spec defines it and the server reads it

Clause-②: no
Metadata-protocol: none

`@objectstack/spec` defines a bare string in a predicate slot as shorthand for `{ dialect: 'cel', source }`, and the server evaluates it on CEL. The console read the shorthand on its legacy JavaScript expression grammar instead, so a predicate using CEL-only syntax faulted there: a navigation entry with `visible: "'org_owner' in current_user.positions"` was hidden from everyone (the navigation gate withholds an entry whose predicate faults), and a page block with `visibleWhen: "size(page.items) > 0"` never rendered, while the same source written as an envelope worked.

- `ExpressionEvaluator.evaluateCondition` evaluates a bare string on the canonical `@objectstack/formula` CEL engine, the same route a `{ dialect: 'cel' }` envelope takes, with the same fault policy (`onFault`, `throwOnError`).
- `toPredicateInput` normalizes a bare string into `{ dialect: 'cel', source }`, as the spec's input schema does, instead of wrapping it as a `${…}` template.
- `evalRowPredicate` (list conditional formatting and row-action predicates) keeps only a `${…}` template on the legacy engine; any other bare string is evaluated on CEL. A string with legacy-only syntax still prints the one-time warning that prescribes the CEL spelling.
- Unchanged: a `${…}` template still evaluates on the legacy engine, and so does the `source` of an envelope whose dialect is not `cel`.

What to do: a bare-string predicate that relies on JavaScript-only syntax (`===`, `!==`, `?.`, `??`, `.includes(…)`, `.length`) now faults instead of evaluating, and each surface applies its existing fault policy. Rewrite it in CEL: `==` for `===`, `!=` for `!==`, `x in list` or `.contains(…)` for `.includes(…)`, `size(x)` for `.length`.
