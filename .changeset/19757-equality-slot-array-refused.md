---
"@objectstack/spec": minor
---

fix(spec)!: the shared comparand-shape face refuses an ARRAY in the equality slot — `{ field: [...] }` and `{ field: { $eq: [...] } }` — for every driver at once (#19757)

**BREAKING** — an accept-set narrowing at the runtime filter doors, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. Ruled on #19757 (record 5793368540, letter 乙, 「217 同意」): an array in the implicit-equality slot is refused at the shared face, for every driver at once — no alias, no grace window. The hand-migration prescription is registered under protocol major 18 as `filter-equality-array-comparand-refused`.

## What changes

`parseFilterAST` lowers `['tags', 'equals', ['a']]` — and the same triple on `=`, `==` and `eq` — to the implicit form `{ tags: ['a'] }`. That shape, and its explicit spelling `{ tags: { $eq: ['a'] } }`, now get `INVALID_FILTER` / 400 from the shared comparand-shape face (`assertListComparandShapes` in `@objectstack/spec/data`). That face runs inside `parseFilterAST` and at the engine's lowering seam on both engine doors, so the refusal lands before any driver runs, at any depth under `$and` / `$or` / `$not`. The empty array is refused too. The message names the field, the path, and the two operators a list in that slot was standing in for: `{"$in": […]}` for "one of these values" (authoring spelling `in`), and `{"$contains": "…"}` for "the stored list holds a value" on a multi-value field (authoring spelling `contains`), with an `$or` of those for any-of.

How each backend answered the lowered `{ tags: ['a'] }` before this change. Each was run for this change beside a scalar and an `$in` control:

| backend | before | how it was measured |
|:--|:--|:--|
| `driver-sql` (SQLite) | **refused**, 400, at the top level. Nested under `$and` / `$or` / `$not` it answered **500 `DATABASE_ERROR`**: SQLite could not bind the list. | `SqlDriver.find` on better-sqlite3 |
| `driver-memory` | **refused**, 400, at every depth | `InMemoryDriver.find` |
| `@objectstack/formula` | **no row**, including a row storing exactly `['a']` | `matchesFilterCondition` |
| `driver-mongodb` | **answered**. `translateFilter` emits the array unchanged. MongoDB equality on an array operand selects a stored array **equal to** `['a']` **or holding** `['a']` as an element. | `translateFilter`, then mingo 7.2.4 as the named proxy for the server. Over `['a']`, `'a'`, `['a','b']`, `['b','a']`, `[['a'],'x']`, `[['a']]`, `'b'` and `[]`, it selected `['a']`, `[['a'],'x']` and `[['a']]`. |
| `service-analytics` filter normalizer | **answered as membership**. The FilterArray form `[['stage', '=', ['won', 'lost']]]` charted as `stage IN ('won', 'lost')`. | `normalizeAnalyticsFilterTree` |

⚠️ NOT MEASURED: a live `mongod`, MySQL, PostgreSQL, and a live Turso server. `driver-turso` and `driver-sqlite-wasm` are built on `driver-sql` and were not run separately.

After this change, every row above that goes through a platform door gets the 400. That covers `parseFilterAST`, the engine's lowering seam on both doors (every engine verb's `where` passes through it; measured on `find` and `count`), and the analytics normalizer's FilterArray form. The drivers themselves are untouched, so a caller that hands a raw `FilterCondition` straight to a driver, without `parseFilterAST`, still gets that driver's own answer.

## What does NOT change

- **`$ne` carrying an array is not judged.** The ruling names implicit and explicit equality. `$ne` measured the same split (refused by `driver-sql` and `driver-memory`, answered by `driver-mongodb`) and is left to its own ruling.
- The other scalar operators carrying an array (`$gt`, `$contains`, `$like`, …) are not judged here either.
- The list operators keep their arrays: `$in`, `$nin` and `$between`, including `$in: []` / `$nin: []`.
- Every scalar equality comparand is untouched. That includes `null`: `{ field: null }` and `{ field: { $eq: null } }` are the has-no-value predicate.
- A `{ $field }` reference on an equality spelling still lowers to `$eq` and passes.
- A field spec with no `$` key (`{ author: { tags: ['a'] } }`) is still not descended into.
- This change does not touch the schema doors. A separate change in this release does: `FilterConditionSchema` and `FieldOperatorsSchema.$eq` now refuse the same shape when a document is saved, with this refusal's sentence (the location is carried by the issue's path instead). Its changeset and the ADR-0087 entry `filter-equality-array-comparand-refused-at-save` describe it.
- `ViewFilterRule` already refused an array on every scalar view operator at authoring time.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ tags: ['a', 'b'] }` / `[['tags', 'equals', ['a', 'b']]]`, meaning "one of these values" | `{ tags: { $in: ['a', 'b'] } }` / `[['tags', 'in', ['a', 'b']]]` |
| `{ tags: ['a'] }`, meaning "the stored list holds `a`" on a multi-value field | `{ tags: { $contains: 'a' } }` / `[['tags', 'contains', 'a']]` |
| `{ tags: ['a', 'b'] }`, meaning "the stored list holds `a` or `b`" | `{ $or: [{ tags: { $contains: 'a' } }, { tags: { $contains: 'b' } }] }` |
| `{ tags: ['a'] }`, meaning one value | `{ tags: 'a' }` |
| `{ tags: { $eq: [...] } }` | any of the rows above |

On `driver-mongodb`, check what the query is supposed to return, and do not assume the old rows were right. The old answer was MongoDB array equality, and neither `$in` nor `$contains` gives the same rows. A dashboard or dataset filter written as the FilterArray sugar with an array on equality used to chart as membership. It is now refused, and `$in` is the spelling that charts the same rows.

## Who is affected, measured

Nothing in this repository's examples, seeds, docs or published skills authors the shape. The repo was grepped for the FilterArray triple on `=` / `==` / `equals` / `eq` carrying an array, for `$eq` carrying an array, and for filter / where objects whose field value is an array. The hits are tests and the engine-double conformance tables. The full suites of `@objectstack/spec`, `objectql`, `driver-memory`, `driver-sql`, `driver-mongodb`, `driver-turso`, `driver-sqlite-wasm`, `formula`, `service-analytics`, `metadata-protocol`, `metadata-core`, `plugin-sharing` and `lint` were run, and four things went red. Each was re-judged, not rewritten by rote:

- The comparand-shape suite pinned `{ tags: ['a','b'] }` and `$eq: ['a','b']` as shapes the face passes through. Both rows are inverted, and the shapes now live in the arm's refusal section.
- The field-reference lowering suite pinned `['stage', '=', ['a','b']]` lowering to the implicit form. What that row proved still holds, because an array is not promoted to `$eq`. The row now asserts the refusal, which names the implicit slot and not `$eq`.
- Two probe helpers passed a two-element array through every AST spelling to find its `$` operator. One is in this package's comparand-shape suite, the other in `driver-memory`'s vocabulary suite. Each assumed the array could never trip the face. The equality spellings now refuse it, so each helper reads that refusal as `undefined`, which is the answer the helper always gave those spellings.
- `@objectstack/metadata-core`'s engine-double dispatch tables carried three ARRAY `where.id` rows. The real engine now refuses that input at the face before its dispatch runs, so the rows are retired. Their own changeset explains why.

`FILTER_COMPARAND_TYPE_CASES` gains three `door-refusal` rows (implicit, `$eq`, and nested under `$or`). Every driver suite that consumes the table runs them through `parseFilterAST`.

Clause-②: no (narrowing) — nothing is widened. No key is added, removed or renamed, no exported symbol moves, and the operator vocabulary is unchanged. The runtime accept set narrows: one comparand shape in one slot, which the face now refuses the way `driver-sql` and `driver-memory` already did.

<!-- adr-0087: registered filter-equality-array-comparand-refused -->
