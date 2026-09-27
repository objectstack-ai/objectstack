---
"@objectstack/spec": minor
---

fix(spec)!: an ARRAY under `$ne` is refused at the shared comparand-shape face and at `FieldOperatorsSchema.$ne`, with one remedy text naming `$nin` (#19886)

**BREAKING** — an accept-set narrowing at the runtime filter doors and at one published operator slot, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. Ruled on #19886 (record 5805254639, ruling A, class 1): "The shared comparand-shape face refuses an array under `$ne` for every driver, and `FieldOperatorsSchema.$ne` refuses it at parse — one remedy text, naming the declared list-negation operator by its spec spelling". No alias, no grace window. The hand-migration prescription is registered under protocol major 18 as `filter-ne-array-comparand-refused`.

## What changes

`$ne` already declared its comparand as "a literal, or a { $field } reference to another column of the same table". An array is neither. Two doors now say so.

**The shared comparand-shape face** (`assertListComparandShapes` in `@objectstack/spec/data`) refuses `{ field: { $ne: [...] } }` with `INVALID_FILTER` / 400. It refuses it at any depth under `$and` / `$or` / `$not`, and it refuses the empty array too. `parseFilterAST` lowers `['tags', 'ne', ['a']]` to that shape, and so do `!=`, `<>`, `neq`, `not_equals` and `notequals`. The face runs inside `parseFilterAST` and at the engine's lowering seam, so the refusal lands before any driver runs. The message is:

```text
Operator "$ne" on field "tags" requires a single comparable value, but received an array (["a"]) at where.tags.$ne. For "none of these values" use {"$nin": […]} (authoring: nin, not_in, notin). The filter was NOT applied, and an unapplied filter would have returned the UNFILTERED result set.
```

Its first sentence is `driver-memory`'s own wording for this condition. It names one remedy: `$nin`, the list-negation operator `FieldOperatorsSchema` declares ("Not in list"), with its authoring spellings.

**The operator slot** `FieldOperatorsSchema.$ne` refuses an array on parse. So do its documentation copy `EqualityOperatorSchema.$ne` and the `NormalizedFilter` AST that validates against it. They print the same sentence without ` on field "…"` and ` at <path>`, because a slot cannot see either. The issue's own `path` carries the location instead (`$ne`, `$and.0.stage.$ne`).

How each door answered `{ tags: { $ne: ['a'] } }` on `origin/main` `9e7824a4`, just before this change:

| door | before | after |
|:--|:--|:--|
| the shared face, `parseFilterAST`, the engine's lowering seam | **passed** it to the driver, at every depth | `INVALID_FILTER` / 400, before any driver runs |
| `FieldOperatorsSchema`, `EqualityOperatorSchema`, the `NormalizedFilter` AST | **parsed it green** | refused on parse at `$ne` |
| the analytics `where` door (`normalizeAnalyticsFilterTree`) | **compiled it**: `{ stage: { $ne: ['won', 'lost'] } }` became `stage` not-set OR `stage` not-equals `['won', 'lost']`, and both analytics strategies render a not-equals member from its first value, so `'lost'` was dropped and its rows were counted | `INVALID_FILTER` / 400 with the face's sentence |
| `driver-sql`, `driver-memory` | refused, 400, in their own words | unchanged; the face now answers first |
| `driver-mongodb`, the formula evaluator | refused, since earlier stages of this card, in their own words | unchanged; the face now answers first |

The analytics row's compiled tree was measured with the face's `$ne` arm removed, which is `main`'s face. Its rendering from the first value was read at source (`values[0]` in the native SQL strategy, `v0` in the ObjectQL strategy) and was not executed. A live `mongod`, MySQL, PostgreSQL and a live Turso server were NOT measured.

So on the SQL family and `driver-memory` the verdict does not move (400 before and after). What moves is the text and the moment: the refusal now arrives at the face with the `$nin` remedy, before any driver runs. On the analytics `where` door the verdict does move: a query that used to answer with a silently widened row set is now refused.

## What does NOT change

- **A stored filter carrier still saves the shape.** `FilterConditionSchema`, which every stored filter parses through (a dataset filter and measure filter, a dashboard widget filter, a report `runtimeFilter`, a rollup filter and the rest), does not parse a field's operator map through `FieldOperatorsSchema`. Its own walk judges `$eq` and does not judge `$ne`. The ruling names the face and the operator slot, not that walk. So `DatasetSchema` with `filter: { stage: { $ne: ['won', 'lost'] } }` still parses green, and every query that uses it is refused at the face.
- `$ne: null` is the has-a-value predicate and is untouched. Every scalar, a `Date` and a `{ $field }` reference are untouched too. `['amount', '!=', { $field: 'budget' }]` still lowers to `{ amount: { $ne: { $field: 'budget' } } }` and passes.
- The list operators keep their arrays: `$in`, `$nin` and `$between`, including `$in: []` and `$nin: []`.
- A field spec with no `$` key (`{ author: { tags: { $ne: ['a'] } } }`) is still not descended into.
- The ordering operators carrying an array, a nested array inside `$in`, and a `{ $field }` referent to a multi-valued field are not judged here. They are the same class and are scoped separately on the card.
- The drivers are untouched. A caller that hands a raw `FilterCondition` straight to a driver, without `parseFilterAST`, still gets that driver's own refusal.
- `ViewFilterRule` already refused an array on `not_equals` at authoring time.
- The published JSON Schema cannot state the check. `z.toJSONSchema()` has no projection for it, so `data/FieldOperators`, `data/EqualityOperator` and `data/NormalizedFilter` still read `{}` at `$ne`. The three sites are declared in `dropped-refinements.baseline.json`.
- No key is added, removed or renamed, no exported symbol moves, and the operator vocabulary is unchanged.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ stage: { $ne: ['won', 'lost'] } }`, meaning "none of these values" | `{ stage: { $nin: ['won', 'lost'] } }` |
| `[['stage', 'not_equals', ['won', 'lost']]]` (or `ne`, `!=`, `<>`, `neq`, `notequals`) | `[['stage', 'not_in', ['won', 'lost']]]` (or `nin`, `notin`) |
| `{ stage: { $ne: ['won'] } }`, meaning one value | `{ stage: { $ne: 'won' } }` |

On `driver-mongodb`, check what the query is supposed to return and do not assume the old rows were right. Before this card, MongoDB read `$ne` against an array as "not equal to that array and not holding it as an element", and `$nin` does not reproduce that. On the analytics `where` door, the old answer dropped every member after the first, so a chart built on it counted rows its filter named.

## Who is affected, measured

Nothing shipped authors the shape. Each count below was read against the named tree, with a control:

- **This repository**, `origin/main` `9e7824a4`. `$ne` followed by an array literal in `packages/**`, `examples/**`, `apps/**`, `scripts/**`, `content/**` and `skills/**` has 20 hits. All of them are tests, refusal code, comments or migration prose. The control, `$in` followed by an array literal in `packages/**` and `examples/**`, has 901 hits. The FilterArray triple on `ne`, `!=`, `<>`, `neq`, `not_equals` or `notequals` carrying an array has 0 hits. A CEL `!=` against a list literal in `packages/platform-objects/**`, `examples/**` and `packages/qa/**` (tests excluded) has 0 hits. `$ne` fed by a variable in non-test source has 11 sites, and none of them builds a list. Each passes a list's first member, a stored-form value, a named constant, a `{ $field }` reference, or a caller's comparand passed through: the better-auth adapter's `ne`, and the CEL lowering, which refuses a list under `!=` before it emits.
- **objectui** at the `.objectui-sha` pin `f8a9d0fb05`: 2 hits, both in its own refusal test. The dataset filter builder gives `notEquals` a scalar arity, and the rollup summary editor gives only `in` / `notIn` a list. The control, `$in` with an array, has 46 hits.
- **cloud** `main` `48d7066`: 0 hits. The control has 33 hits.

Deployed stacks were NOT measured. Every query that carries the shape is refused with `INVALID_FILTER` / 400 naming the field, the path and `$nin`, so a test suite that exercises the query finds each one. A clean re-save of a stored carrier does not find them, because the carrier schema still accepts the shape. Exercise stored filters, or grep them.

Clause-②: no (narrowing) — nothing is widened. One comparand shape in one slot, which `$ne`'s published description already excluded, is refused at the face and at the operator slot.

<!-- adr-0087: registered filter-ne-array-comparand-refused -->
