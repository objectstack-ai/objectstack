---
"@objectstack/spec": minor
---

feat(spec): declare `FilterArray` as the input-only authoring sugar it already was (#5285)

`FilterArray` had a name and no definition. Three READMEs, `llms.txt`, four
skills, the query-adapter docs and this package's own react-blocks prop table
all taught authors to write it — `filters={['status', '=', stage]}` — while the
protocol never declared it anywhere. An author following the contract they were
handed had nothing to validate against, which is worst for the AI authors these
contracts are largely written for: the name looked resolvable and was not.

`packages/spec/src/data/filter.zod.ts` now declares it, next to the operator
vocabulary it is built from and the sink it lowers through:

- **`FilterArray`** (type) plus `FilterArrayComparison`, `FilterArrayGroup`,
  `FilterArrayList` — the three shapes the measured producers emit: a comparison
  `[field, operator, value]` (with the real two-element form for the null
  predicates, whose direction lives in the operator name), a group
  `['and' | 'or', ...conditions]`, and a bare list combined with implicit AND.
- **`FilterArraySchema`** — the Zod authoring gate.
- **`FilterArrayOperator`** — the canonical operator spellings, derived from
  `AST_OPERATOR_MAP` rather than restated, so it cannot drift from the lowering
  the way two hand-written lists did in #3948. A misspelled operator is now a
  type error where the shape is authored in TypeScript, instead of an unknown
  `$`-operator arriving at a driver.
- **`FILTER_ARRAY_LOGIC_KEYWORDS`** / `FilterArrayLogicKeyword` — `'and' | 'or'`.

**Input-only, and that is the whole point.** This is sugar accepted at
authoring entrances (React block props, the client `FilterBuilder`, the wire
`$filter` face). It is lowered to a `FilterCondition` at the single sink
`parseFilterAST` the moment it arrives, and only the lowered form travels any
further. **Nothing about the storage or wire contract changes**: a query's
`where` is a `FilterCondition` and stays one, deliberately excluding the array
dialect so no driver, transport or stored row ever has to understand two filter
languages. `filter-array-declaration.test.ts` pins that exclusion as a negative
test, so a future widening of the protocol face fails loudly and lands the
reader on the ruling that decided it.

Nothing to migrate: every filter that worked before works unchanged, and the
declaration adds the check that was missing. Per #5158's ruling C, this is step
one of two — the engine-side lowering that closes the second door is separate.
