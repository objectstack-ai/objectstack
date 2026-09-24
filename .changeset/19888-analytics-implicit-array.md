---
"@objectstack/service-analytics": minor
---

fix(service-analytics)!: the analytics `where` door refuses a list in the equality slot instead of reading it as `IN` (#19888)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered filter-equality-array-comparand-refused) the transition from a list in the equality slot to the operator it stood in for was registered by #19757 for the FilterCondition equality slot at the runtime filter doors; this change adds no new transition, it brings the analytics object-form `where` and the draft-data preview under the one already on the ledger, and the entry's own prescription and acceptance criteria apply verbatim -->

**BREAKING**: this narrows what the analytics faces of `@objectstack/service-analytics` accept. A caller `where`, a dataset `filter` or a measure `filter` that carries a list in the equality slot, `{ field: [...] }` (the empty list included) or `{ field: { $eq: [...] } }`, at any depth under `$and` / `$or` / `$not` or inside a nested relation, compiled before this change. It is now refused with `INVALID_FILTER` / 400. It ships as `minor` under the launch-window convention for accept-set narrowings. The remedy is `$in`:

| you wrote | write instead |
|:--|:--|
| `{ stage: ['won', 'lost'] }` or `{ stage: { $eq: ['won', 'lost'] } }`, meaning "one of these values" | `{ stage: { $in: ['won', 'lost'] } }` |
| `{ stage: ['won'] }`, meaning one value | `{ stage: 'won' }` |
| `{ stage: [] }` | `{ stage: { $in: [] } }`, which matches no row, as the bare list did |

`$in` charts the rows the implicit list charted before. The refusal also names `{ "$contains": "…" }` for "the stored list holds a value" on a multi-value field.

Ruling 乙 of #19757 refuses a list in the equality slot at the shared comparand-shape face in `@objectstack/spec`, for every driver at once. The analytics `where` door met that face only for the `FilterArray` spelling (`['stage', '=', ['won', 'lost']]`), which was already refused. The object spelling was compiled by the analytics filter normalizer, which read one condition four ways:

- `{ stage: ['won', 'lost'] }` compiled to `stage IN (...)`. On the ObjectQL path the engine received `{ stage: { $in: [...] } }`, so the engine's own shared-face check never saw the list.
- `{ stage: { $eq: ['won', 'lost'] } }` compiled to `stage = 'won'`, and `'lost'` was dropped without a word.
- `{ stage: { $eq: [] } }` compiled to no predicate at all, so the chart was drawn over every row.
- `{ stage: [] }` compiled to the FALSE constant.

Each list is now handed to the shared face's equality arm before any node is built. Both spellings of one condition therefore get the same refusal, with the same wording, path and `$in` prescription. The draft-data preview runs the same gate, so a drafted chart refuses what the published chart refuses. Before, it compared each row against the list's string form.

Who is affected: nothing in this repository's examples, seeds or docs authors the shape (measured over `examples/**`, `packages/**` and the fenced code in the docs). Stored datasets, dashboard widget filters, report runtime filters and measure filters in a deployment were NOT measured. In this release the authoring schema refuses the shape too, when such a document is saved (a separate change in `@objectstack/spec`, ADR-0087 entry `filter-equality-array-comparand-refused-at-save`). One position is judged only here: a list inside a nested relation, which this door flattens to a dotted member. A document carrying that still publishes, and it is refused when it is charted. The refusal names the field and the path. `$ne` with a list is not part of the ruling and is not judged here. The list operators (`$in`, `$nin`, `$between`) keep their lists, and every scalar, `null` included, compiles as before.
