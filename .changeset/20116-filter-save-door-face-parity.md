---
"@objectstack/spec": minor
---

fix(spec)!: a filter carrying a comparand the query faces refuse is refused when it is saved (#20116)

**BREAKING** — an accept-set narrowing of published authoring schemas, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. The save door narrows to exactly what the query faces already refuse. The hand-migration prescription is registered under protocol major 18 as `filter-query-face-comparands-refused-at-save`.

## What changes

`FilterConditionSchema` now refuses, at parse, every comparand slot the query faces refuse:

- a `$null` or `$exists` flag that is not a boolean — `"false"`, `"x"`, `null`, `1`;
- a `null` comparand of `$gt` / `$gte` / `$lt` / `$lte`;
- an `$in` or `$nin` comparand that is not a list, or a list holding `null`;
- a `$between` comparand that is not a two-element list, or whose endpoint is `null`, blank (`""`) or a `{ $field }` reference;
- an array under `$ne`.

It judges the field entries of a condition and of every `$and` / `$or` / `$not` member. The shared comparand-shape face (`assertListComparandShapes`) is called read-only as the judge for each slot, so the save door refuses exactly what that face refuses on every query. The two boolean flags, which that face does not judge, are refused on the predicate every flag face uses (`driver-sql`, `driver-memory`, `driver-mongodb`, the read-scope compiler and the analytics `where` door): the comparand is not a boolean.

Measured on `origin/main` `af32cf9a` before the change: a dataset `filter`, a dataset measure `filter`, a dashboard widget `filter` and a report `runtimeFilter` each parsed with `success: true` for one instance of every shape above. The comparand-shape face refused each one but the flags with `INVALID_FILTER` / 400, and the analytics `where` door refused all of them. So such a document published clean and then failed every chart built on it.

Every schema that carries a `FilterCondition` refuses on parse. That covers the dataset `filter` and measure `filter`, the dashboard widget `filter` and options-source `filter`, the report and joined-report-block `runtimeFilter`, the field `relatedListFilter` and rollup `summaryOperations.filter`, the solution-blueprint summary `filter`, the analytics query `where`, the dataset selection `runtimeFilter`, the query `where` and `having`, the data-engine aggregate call's `having`, the aggregation `filter`, and the query-filter `where`. So `defineStack`, `os validate` and a save through the metadata protocol (`422 INVALID_METADATA`) refuse such a document at the slot's path, for example `filter.stage.$null` or `measures.0.filter.amount.$between.0`.

The words are the query face's. For an array under `$ne`, a non-list `$in` / `$nin` and a malformed `$between`, the refusal is the face's sentence without its location clause (`at where.<field>.<op>`), because the issue's path carries the location. For a `null` ordering comparand, a `null` list member or endpoint, and a blank or `{ $field }` endpoint, it is the sentence the enforced operator slot (`FieldOperatorsSchema`) already prints for the same comparand. A non-boolean flag gets the query faces' sentence: `Operator "$null" on field "stage" requires a boolean comparand (true or false).`, then the received value and the prescription.

This also changes the `$ne` note of the equality-slot change earlier in this release: an array under `$ne` is now refused on save too, in the sentence `FieldOperatorsSchema.$ne` and the face print.

## What does NOT change

- **Nothing stored is rewritten, and nothing is dropped.** The parse fails and strips nothing. The read path does not re-validate stored rows, so a stored document keeps loading, and its next save is refused. Such a filter has failed every query since the runtime refusal of its shape, so the refusal is a repair.
- **The reach is the face's, and no wider.** A field spec with no `$` key, such as the nested-relation condition `{ account: { region: { $in: ["a", null] } } }`, is not judged, because neither the face nor the drivers' flag checks descend one. The analytics `where` door does refuse that shape when an analytics carrier is charted.
- **What the face passes still passes:** `$eq: null` and `$ne: null` (the null predicate), a `{ $field }` reference as the whole comparand of a scalar comparison, `$in: []` and `$nin: []`, a whitespace-only `$between` endpoint, and falsy endpoints such as `[0, 0]`.
- **The data-engine calls' `where` option still parses.** Its type is a union whose first arm is an open record. The face refuses the shape when the call runs.
- **No key, export or JSON Schema changes.** The published JSON Schema cannot state a refinement, and `FilterCondition`'s already could not state the equality-slot one.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ stage: { $null: "true" } }`, `{ stage: { $null: 1 } }` | `{ stage: { $null: true } }` ("has no value") |
| `{ stage: { $exists: "false" } }`, `{ stage: { $null: null } }` | the boolean you meant: `$exists: false` is "has no value", `$null: false` is "has a value" |
| `{ amount: { $gt: null } }` | `{ amount: { $eq: null } }` ("has no value") or `{ amount: { $ne: null } }` ("has a value") |
| `{ stage: { $in: "won" } }` | `{ stage: { $in: ["won"] } }` or `{ stage: "won" }` |
| `{ stage: { $in: ["won", null] } }` | `{ $or: [{ stage: { $in: ["won"] } }, { stage: { $null: true } }] }` |
| `{ amount: { $between: [null, 5] } }`, `{ amount: { $between: ["", 5] } }` | `{ amount: { $lte: 5 } }`, or the bound you meant |
| `{ amount: { $between: [{ $field: "floor" }, 5] } }` | `{ amount: { $gte: { $field: "floor" }, $lte: 5 } }` |
| `{ amount: { $between: 5 } }`, `{ amount: { $between: [1] } }` | `{ amount: { $between: [1, 5] } }` |
| `{ stage: { $ne: ["won", "lost"] } }` | `{ stage: { $nin: ["won", "lost"] } }` |

## Who is affected, measured

A literal-comparand scan of every member shape, with a lit control per shape, over `examples/**` and the non-test `packages/**` of this repository at `af32cf9a`, the console repository at its pinned commit `f8a9d0fb05`, and the cloud repository's `main` at `48d70663ab`, found authored filters carrying one in one place. The console's filter-condition widget writes "is empty" as `{ field: { $in: [null, ""] } }` and "is not empty" as `{ field: { $nin: [null, ""] } }`. That widget edits a field's `relatedListFilter` and a rollup's `summaryOperations.filter` in the Studio field designer, and a sharing rule's criteria. Both shapes carry a `null` list member, which the face has refused on every query since the 2026-08-31 ruling, so a filter saved that way has been failing its related list or rollup since then. After this change, the Studio save is refused instead, with the `$or` / `$null` prescription. Every other hit is prose, a type table or a test fixture. Deployed datasets, dashboards and reports were NOT measured. Validating each stack, or re-saving each document, finds every instance the surface above lists.

Clause-②: no (narrowing) — nothing is widened. No key is added, removed or renamed, no exported symbol moves, and the operator vocabulary is unchanged. Comparand shapes that every query face already refused are now refused on save as well.

<!-- adr-0087: registered filter-query-face-comparands-refused-at-save -->
