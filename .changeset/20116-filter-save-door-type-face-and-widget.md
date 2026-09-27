---
"@objectstack/spec": minor
---

fix(spec)!: a filter carrying a comparand the comparand-type face refuses is refused when it is saved, and a dashboard widget filter judges its nested relations (#20116)

**BREAKING** — an accept-set narrowing of published authoring schemas, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. The save door narrows to exactly what the query faces already refuse; this is stage 2 of the change whose first stage registered `filter-query-face-comparands-refused-at-save`. The hand-migration prescription is registered under protocol major 18 as `filter-comparand-types-and-widget-nested-slots-refused-at-save`.

## What changes

**The comparand-type face, asked on save.** `FilterConditionSchema` now refuses, at parse, every comparand the comparand-type face (`normalizeFilterComparandTypes`, the accepted set `string | number | bigint | boolean | null | Date`) refuses on every query:

- a plain object where a single value belongs — `{ stage: { $eq: { a: 1 } } }`, and a `{ $field: … }` whose name is not a string;
- a `Map`, a class instance, a function or a Symbol;
- `undefined`, as `{ owner: undefined }` or under an operator;
- a bigint beyond ±2^53;

as the comparand itself, as an implicit-equality comparand, or as an `$in` / `$nin` / `$between` list member (`{ stage: { $in: [{ a: 1 }] } }`). The face is called read-only as the judge, after the comparand-shape face, so the save door refuses exactly what it refuses and passes what it passes. A field value that is not a PLAIN object (a `Map`, a class instance) is the comparand the face calls it, never an empty nested relation.

**A dashboard widget filter is an analytics carrier.** `DashboardWidgetSchema.filter` now declares the same filter as `DatasetSchema.filter` and `DatasetMeasureSchema.filter`, because the dataset executor ANDs it into the same analytics query. So the widget judges the slots INSIDE a nested-relation condition the way the analytics `where` door does: `{ acct: { stage: { $in: ["won", null] } } }`, `{ acct: { region: ["a"] } }` and `{ acct: { region: { $eq: ["a"] } } }` are refused on save at `widgets.<n>.filter.acct.…`, as on the two dataset carriers. That declaration moved, verbatim, into its own module shared by the three carriers; the dataset carriers' published JSON Schema is byte-identical.

Measured on `origin/main` `17bd3187` before the change: `FilterConditionSchema`, a dataset `filter`, a dataset measure `filter`, a dashboard widget `filter`, a report `runtimeFilter` and a joined report block `runtimeFilter` each parsed with `success: true` for `{ stage: { $eq: { a: 1 } } }`, `{ stage: { $in: [{ a: 1 }] } }` and a `Map` comparand, at the top level and inside a nested relation. The comparand-type face and the analytics `where` door refused each with `INVALID_FILTER` / 400. A dashboard widget `filter` also parsed with `success: true` for the three nested-relation shapes above, which the analytics door refuses when the widget is charted.

**One slot, one issue.** A slot raises the first refusal the query doors give, in their order: the comparand-shape face, then the comparand-type face, then the `$null` / `$exists` flag rule. So `{ stage: { $null: { a: 1 } } }` reads as the type face's refusal, as it does on chart. Where a face refuses a slot, the schema door's own `$icontains` and date-preset arms stay silent on it, so no slot carries two issues.

**The words are the type face's**, less its location clause (`at where.<field>.<op>`), because the issue's path carries the location: for example `Filter comparand is a plain object ({"a":1}), which no driver can compare. A comparison value must be a string, number, bigint, boolean, null or Date. Refusing rather than guessing: …` at `filter.stage.$eq`, and at `filter.stage.$in.1` for a list member.

`defineStack`, `os validate` and a save through the metadata protocol (`422 INVALID_METADATA`) refuse such a document at the slot's path.

## What does NOT change

- **Nothing stored is rewritten, and nothing is dropped.** The parse fails and strips nothing. The read path does not re-validate stored rows, so a stored document keeps loading, and its next save is refused.
- **What the face passes still passes:** a `Date`, a `{ $field: "column" }` reference, a `{placeholder}` string the engine resolves at request time (`{current_user_id}`, `{today}`), and a bigint within ±2^53. The face narrows such a bigint to its number on a query; the save door keeps it as written.
- **The shared reach is unchanged.** On every carrier but the three analytics ones, a field spec with no `$` key (a nested-relation condition) is not judged, because no face descends one.
- **A report's `runtimeFilter` and a joined report block's `runtimeFilter` still save a refused shape INSIDE a nested relation.** They are charted through the same door; adopting the analytics-carrier filter there is one line per slot and is not in this change.
- **The data-engine calls' `where` option still parses.** Its type is a union whose first arm is an open record. The face refuses the shape when the call runs.
- **No key, export or JSON Schema body changes.** The published JSON Schema cannot state a refinement; the new widget rule is recorded as a dropped refinement at `ui/DashboardWidget` `filter` and `ui/Dashboard` `widgets.element.filter`.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ stage: { $eq: { a: 1 } } }` | the one value you meant: `{ stage: { $eq: "won" } }` |
| `{ stage: { $in: [{ a: 1 }] } }` | a list of values: `{ stage: { $in: ["won", "lost"] } }` |
| `{ amount: { $gt: { $field: 5 } } }` | a column name: `{ amount: { $gt: { $field: "budget" } } }` |
| `{ owner: undefined }`, `{ owner: { $eq: undefined } }` | `{ owner: { $eq: null } }` ("has no value"), `{ owner: { $ne: null } }` ("has a value"), or omit the key |
| `{ tags: new Map(…) }`, a class instance | the value itself, as a string, number, boolean, `null` or `Date` |
| `{ qty: { $gt: 2n ** 60n } }` | a bound within ±2^53, or the value compared as a string |
| a widget `filter: { acct: { stage: { $in: ["won", null] } } }` | `{ $or: [{ acct: { stage: { $in: ["won"] } } }, { acct: { stage: { $null: true } } }] }` |
| a widget `filter: { acct: { region: ["a", "b"] } }` | `{ acct: { region: { $in: ["a", "b"] } } }` |

### FROM → TO at the HTTP doors

Same status, different code: the refusal now comes from the route's schema door, located on the member, instead of from the analytics filter normalizer.

| request | before | after |
|:--|:--|:--|
| `POST /analytics/dataset/query` with `selection.runtimeFilter: { stage: { $eq: { a: 1 } } }` | `400 INVALID_FILTER` from the analytics normalizer, in the comparand-type face's sentence | `400 VALIDATION_FAILED`, `details.fields[]` entry `selection.runtimeFilter.stage.$eq` with the sentence `Filter comparand is a plain object ({"a":1}), which no driver can compare. …` |
| the same route with `selection.runtimeFilter: { stage: { $in: ["won", { a: 1 }] } }` | `400 INVALID_FILTER` | `400 VALIDATION_FAILED` at `selection.runtimeFilter.stage.$in.1` |
| `POST /analytics/query` (`AnalyticsQueryRequestSchema`) with either shape in `where` | `400 INVALID_FILTER` | refused by the request schema at `where.stage.$eq` / `where.stage.$in.1`, answered `400 VALIDATION_FAILED` |

A client that branches on `INVALID_FILTER` for these shapes reads `VALIDATION_FAILED` instead. Both are 400 and both name the field. The other refused values cannot arrive over HTTP: JSON has no `Map`, `undefined` or bigint.

## Who is affected, measured

A literal scan of every shape, with a lit control per shape, over `examples/**` and the non-test `packages/**` of this repository, the console repository at its pinned commit `f8a9d0fb05` and the cloud repository's `main` at `96eb092fbf`, found no authored filter carrying a plain object where a value belongs, a `Map` or class instance, `undefined` or a bigint beyond 2^53 — every hit was prose, a driver's operator switch, or a conformance table — and no filter whose first entry is a nested relation holding a list or an operator map. A runtime walk of every filter in the example stacks (`app-crm`, `app-todo`, `app-multi-package`, and `app-showcase`'s metadata modules) compared the old and new doors on each and found none refused by the new one alone. Deployed datasets, dashboards and reports were NOT measured. Validating each stack, or re-saving each document, finds every instance the surface above lists.

Clause-②: no (narrowing) — nothing is widened. No key is added, removed or renamed, no exported symbol moves, and the operator vocabulary is unchanged. Comparand values that every query face already refused are now refused on save as well, and a dashboard widget filter judges the nested-relation slots the analytics door already refused on chart.

<!-- adr-0087: registered filter-comparand-types-and-widget-nested-slots-refused-at-save -->
