---
"@objectstack/spec": minor
---

fix(spec)!: a filter carrying an array in the equality slot is refused when it is saved, in the query face's own words (#19889)

**BREAKING** — an accept-set narrowing of published authoring schemas, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. Ruled on #19889 (record 5805248669, letter A). The hand-migration prescription is registered under protocol major 18 as `filter-equality-array-comparand-refused-at-save`.

## What changes

`FilterConditionSchema` now refuses an ARRAY in the equality slot at parse: the implicit form `{ field: [...] }` and the explicit form `{ field: { $eq: [...] } }`, the empty array included, at any depth under `$and` / `$or` / `$not`. `FieldOperatorsSchema.$eq` refuses an array comparand too, and so do its documentation copy `EqualityOperatorSchema.$eq` and the `NormalizedFilter` AST that validates against it.

The comparand-shape face (`assertListComparandShapes`) refuses both shapes on every query, from the equality-slot change earlier in this release. Before this change the schema accepted them, so a dataset or dashboard filter carrying one published clean and then failed every query that used it. Measured on `origin/main` `a0920b42dc`: `DatasetSchema.safeParse` with `filter: { stage: ['won', 'lost'] }` answered `success: true`, and so did a measure `filter` of `{ stage: { $eq: ['won', 'lost'] } }`.

The schema door prints the face's sentence: the field, the received list, and the two operators a list in that slot stood in for. Both doors import it from one builder. The face adds `at where.<field>`. The schema door leaves that out, because the issue's `path` already says where it is (`filter.stage`, `measures.0.filter.stage.$eq`).

Every schema that carries a `FilterCondition` refuses it on parse. That covers the dataset `filter` and measure `filter`, the dashboard widget `filter` and options-source `filter`, the report and joined-report-block `runtimeFilter`, the field `relatedListFilter` and rollup `summaryOperations.filter`, the solution-blueprint summary `filter`, the analytics query `where`, the dataset selection `runtimeFilter`, the query `where` and `having`, the data-engine aggregate call's `having`, the aggregation `filter`, and the query-filter `where`. So `defineStack`, `os validate` and a save through the metadata protocol (`422 INVALID_METADATA`) refuse such a document at the filter's path.

Two request doors parse these carriers, and they now answer before the analytics compiler does. The REST dataset selection (its `runtimeFilter`) and the analytics query body (its `where`) answer `VALIDATION_FAILED` / 400 with the sentence at the field. Before, the compiler answered `INVALID_FILTER` / 400.

## What does NOT change

- **Nothing stored is rewritten, and nothing is dropped.** The parse fails and strips nothing. The read path does not re-validate stored rows, so a stored document keeps loading, and its next save is refused. Such a filter has failed every query since the equality-slot change, so the refusal is a repair.
- **The reach is the face's, and no wider.** A field spec with no `$` key, such as the nested-relation condition `{ account: { region: ['a'] } }`, is not judged, because the face does not judge it either. The analytics `where` door does refuse that shape when a dataset or measure filter is charted.
- **The data-engine calls' `where` option still parses.** Its type is a union whose first arm is an open record. The face refuses the shape when the call runs.
- **`$ne` carrying an array is not judged.**
- The list operators keep their arrays, `$in: []` and `$nin: []` included. Every scalar, `null`, a `Date` and a `{ $field }` reference pass as before.
- **The published JSON Schema cannot state the check.** `z.toJSONSchema()` has no projection for it, so `data/FieldOperators`, `data/EqualityOperator` and `data/NormalizedFilter` still read `{}` at `$eq`. The three sites are declared in `dropped-refinements.baseline.json`.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ stage: ['won', 'lost'] }`, meaning "one of these values" | `{ stage: { $in: ['won', 'lost'] } }` |
| `{ tags: ['a'] }`, meaning "the stored list holds `a`" on a multi-value field | `{ tags: { $contains: 'a' } }` |
| `{ tags: ['a', 'b'] }`, meaning "the stored list holds `a` or `b`" | `{ $or: [{ tags: { $contains: 'a' } }, { tags: { $contains: 'b' } }] }` |
| `{ stage: ['won'] }`, meaning one value | `{ stage: 'won' }` |
| `{ stage: { $eq: [...] } }` | any of the rows above |

## Who is affected, measured

Nothing shipped in this repository carries the shape. A brace-matched scan of every filter-carrier literal (`filter`, `where`, `runtimeFilter`, `having`, `relatedListFilter`) in `packages/**`, `examples/**`, `apps/**`, `content/docs/**` and `skills/**` read 4709 literals across 7785 files and found 20 field entries whose value opens an array. Sixteen are test fixtures, and four are not filter carriers (a realtime subscription filter and a plugin-permission filter). A grep for `$eq` followed by an array found 24 lines: prose, MongoDB aggregation expressions, and one door-refusal conformance row. Deployed datasets, dashboards and reports were NOT measured. Validating each stack, or re-saving each document, finds every instance the surface above lists.

Clause-②: no (narrowing) — nothing is widened. No key is added, removed or renamed, no exported symbol moves, and the operator vocabulary is unchanged. One comparand shape in one slot, which every query door already refused, is now refused on save as well.

<!-- adr-0087: registered filter-equality-array-comparand-refused-at-save -->
