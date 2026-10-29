---
'@object-ui/core': minor
---

fix(core): a bare-string predicate is read as CEL, the way the spec defines it and the server reads it

Clause-②: no (narrowing)
Metadata-protocol: narrowed

`@objectstack/spec` defines a bare string in a predicate slot as shorthand for `{ dialect: 'cel', source }`, and the server evaluates it on CEL. The console read the shorthand on its legacy JavaScript expression grammar instead, so a predicate using CEL-only syntax faulted there: a navigation entry with `visible: "'org_owner' in current_user.positions"` was hidden from everyone (the navigation gate withholds an entry whose predicate faults), and a page block with `visibleWhen: "size(page.items) > 0"` never rendered, while the same source written as an envelope worked.

- `ExpressionEvaluator.evaluateCondition` evaluates a bare string on the canonical `@objectstack/formula` CEL engine, the same route a `{ dialect: 'cel' }` envelope takes, with the same fault policy (`onFault`, `throwOnError`).
- `toPredicateInput` normalizes a bare string into `{ dialect: 'cel', source }`, as the spec's input schema does, instead of wrapping it as a `${…}` template.
- `evalRowPredicate` (list conditional formatting and row-action predicates) keeps only a `${…}` template on the legacy engine; any other bare string is evaluated on CEL. A string with legacy-only syntax still prints the one-time warning that prescribes the CEL spelling.
- Unchanged: a `${…}` template still evaluates on the legacy engine, and so does the `source` of an envelope whose dialect is not `cel`.

**BREAKING**: a bare-string predicate is read on CEL only, as the spec defines it: a predicate that relied on syntax only the legacy JavaScript grammar reads (for example `===`, `.includes(…)`, `.length`, or a read of a `data.*` key the bound scope does not hold) now faults instead of evaluating, and each surface applies its existing fault policy (a navigation entry or a `visible` / `visibleWhen` gate is withheld, a `disabled` gate disables). The server already reads the shorthand as CEL and rejects those spellings, so the console was the only reader that accepted them; measured in this repository, 0 authored predicates outside tests used them. A predicate that must keep the legacy reading can be spelled as a `${…}` template, which is unchanged.

<!-- adr-0087: not-required (no-migration-prescription) the narrowed spellings were never valid under the protocol: the spec defines a bare string as CEL and the server already evaluated it on CEL and rejected them, so no stored metadata the server accepted changes meaning and there is nothing for objectstack migrate meta to rewrite -->
