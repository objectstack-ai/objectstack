---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: the analytics `where` door runs every arm of the shared comparand-shape face on the object spelling, not only the equality arm (#20010)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered filter-between-blank-endpoint-refused) this change adds no new transition. It brings the analytics object-form `where`, its dataset and measure filters, and the draft-data preview under refusals the shared comparand-shape face already makes at every other door. The one arm whose transition is on the ledger is the blank `$between` endpoint (named). The null list member, the null `$between` endpoint and the null ordering comparand were ruled at the face with no ledger entry (their changesets declared no-migration-prescription: which explicit spelling matches the author's intent is an authoring decision no migration entry can perform). The non-list `$in` / `$nin` / `$between` refusal is the face's original rule. The `{ $field }` and one-bound `$between` endpoints were already refused on this door and change wording only. The table below is the author-facing remedy for each arm, not a mechanical rewrite. -->

**BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. A caller `where`, a dataset `filter` or a measure `filter` that carries one of the shapes below compiled before this change, at any depth under `$and` / `$or` / `$not` or inside a nested relation. It is now refused with `INVALID_FILTER` / 400, carrying the shared face's own message, path and prescription. It ships as `minor` under the launch-window convention for accept-set narrowings.

| you wrote | what it did before | write instead |
|:--|:--|:--|
| `{ stage: { $in: ['won', null] } }`, meaning "one of these, or empty" | `stage IN ('won', NULL)`: the empty rows were never matched | `{ $or: [{ stage: { $in: ['won'] } }, { stage: { $null: true } }] }` |
| `{ stage: { $nin: ['won', null] } }`, meaning "has a value, and not one of these" | `stage IS NULL OR stage NOT IN ('won', NULL)`: only the empty rows | `{ $and: [{ stage: { $nin: ['won'] } }, { stage: { $null: false } }] }` |
| `{ amount: { $gt: null } }` (or `$gte` / `$lt` / `$lte`) | `amount > NULL`: no row, while for `$lt` / `$lte` the draft preview charted every non-empty row | `{ amount: { $eq: null } }` for "has no value", `{ amount: { $ne: null } }` for "has a value" |
| `{ amount: { $between: [null, 100] } }` | `amount >= NULL AND amount <= 100`: no row | `{ amount: { $lte: 100 } }` for a one-sided range; `$or` with `{ amount: { $null: true } }` to include the empty rows |
| `{ amount: { $between: ['', 100] } }` | `amount >= '' AND amount <= 100`: the blank compared as a value, and the ObjectQL engine path accepted it | the bound you meant, or `{ amount: { $lte: 100 } }` for a one-sided range |
| `{ stage: { $in: 'won' } }` or `{ stage: { $nin: 'won' } }` | laundered into a one-member list | `{ stage: 'won' }` / `{ stage: { $ne: 'won' } }`, or `{ stage: { $in: ['won'] } }` |

The shared comparand-shape face in `@objectstack/spec` (`assertListComparandShapes`) is the one place that decides whether `$in` / `$nin` / `$between` received a list at all, for every driver. Three rulings put the null and blank positions on that same door: a null list member and a null `$between` endpoint (2026-08-31), a null ordering comparand (2026-09-01), and a blank `$between` endpoint (2026-09-20). The analytics `where` door met that face only for the `FilterArray` spelling (`['stage', 'in', ['won', null]]`), which was already refused. PR #20008 carried the face's equality arm to the object spelling. Every other arm now follows it: each field entry of the object-form `where` is handed to the face after the equality pass, so both spellings of one condition get the same refusal, byte for byte. This holds on the native SQL execute path, the `/analytics/sql` echo and the ObjectQL engine path. The draft-data preview runs the same gate, so a drafted chart refuses what the published chart refuses. Before, the preview charted rows for several of these shapes: `{ amount: { $lt: null } }` charted every non-empty row.

Three shapes this door already refused now carry the face's wording instead of this package's own, the same wording the `FilterArray` spelling gets: a `$between` that is not a two-element list, a `$between` endpoint that is a `{ $field }` reference, and an `undefined` `$between` endpoint. Their verdict, code and status are unchanged.

Who is affected: nothing in this repository's examples, seeds, docs or package sources authors any of the shapes. This was measured by a text scan over 4013 non-test files with positive controls. Stored datasets, dashboard widget filters and report runtime filters in a deployment were NOT measured. The authoring schema still admits the shapes, so such a document still publishes, and it is refused when it is charted.

Not changed: `$ne` with a list is not judged by the face yet, so it compiles as before. `$in: []` / `$nin: []`, falsy list members (`0`, `''`, `false`), every non-null ordering comparand, a `{ $field }` in an ordering slot, and `null` in the equality slot (the has-no-value predicate) all compile as before. The comparand-TYPE face is not run on this door. An `undefined` comparand outside a `$between` endpoint keeps this package's own refusal.
