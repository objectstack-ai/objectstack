---
"@objectstack/spec": minor
"@objectstack/driver-sql": patch
"@objectstack/driver-memory": patch
---

fix(spec,drivers): the view filter vocabulary and the AST vocabulary now agree (#3948)

`VIEW_FILTER_OPERATORS` (`ui/view.zod.ts`) is what an author may declare on a
`ViewFilterRule`. `VALID_AST_OPERATORS` (`data/filter.zod.ts`) gates
`isFilterAST()`, which decides whether a filter is parsed into a query at all.
They disagreed on **8 of 19** members: `equals`, `not_equals`, `greater_than`,
`less_than`, `greater_than_or_equal`, `less_than_or_equal`, `before`, `after`.

An author could declare any of them, `ViewFilterRuleSchema` validated them,
`defineStack` accepted them — and then `isFilterAST()` refused the filter, the
protocol passed the array through unconverted, and the driver could not apply it.
Six of the eight were reachable only in theory because ObjectUI's adapter alias
table happened to translate them; the safety of the query path was resting on a
hand-written table in another repository being complete, and for `before`/`after`
it wasn't.

**`AST_OPERATOR_MAP` is now the single source of truth.** `VALID_AST_OPERATORS`
is derived from its keys rather than restated, so an operator can no longer be
accepted by the gate without also having a lowering — the two were separate
hand-written lists that happened to agree, with nothing enforcing it. The map
gained the eight canonical view spellings plus the squashed/short forms stored
metadata carries (`notequals`, `greaterthanorequal`, `eq`, `gt`, …).

**New export `canonicalAstOperator(op)`** folds every accepted spelling of one
comparison onto a single infix form. Both drivers now call it instead of growing
private alias lists, which is what let them accept different vocabularies.
`like`/`ilike` are deliberately not folded onto `contains`: driver-sql passes them
to SQL verbatim, so folding would silently wrap the value in `%…%`.

Widening only — no spelling was removed, so no stored filter stops validating.
A filter that previously produced an error (after #4029) or was silently dropped
(before it) now compiles. `filter-view-operator-parity.test.ts` asserts every
`VIEW_FILTER_OPERATORS` member and every `VIEW_FILTER_OPERATOR_ALIASES` key has a
lowering that is a real `$`-operator rather than the `$${op}` fallback, so the
next operator the view layer gains fails a test instead of a query.
