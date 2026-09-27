---
"@objectstack/spec": minor
---

feat(spec): a stored record-form `filter` at the converged rule-array doors is converted to the rule array wherever the mapping is lossless — the ADR-0087 D2 conversion `page-component-filter-record-to-rule-array` (#17321, ruling B)

The one-filter-orthography convergence moved every page-component `filter` door onto the
`ViewFilterRule` array and refused the MongoDB-style record it used to take — but converted
nothing at rest. A page saved with the old form kept rendering, and the next person to open it
in the builder and press Save was refused. This release adds the mechanical half.

**What converts** — at `dataSource.filter` on any page component, at `properties.filter` on the
`object-grid`, `object-metric`, `object-kanban`, `object-calendar`, `object-map`, `object-gantt`,
`object-tree`, `object-timeline`, `element:number` and `element:record_picker` blocks, and at
`properties.defaultFilters` on `object-grid`:

| Stored | Becomes |
| --- | --- |
| `{ status: 'active' }` | `[{ field: 'status', operator: 'equals', value: 'active' }]` |
| `{ amount: { $gt: 100 } }` | `[{ field: 'amount', operator: 'greater_than', value: 100 }]` |
| `{ amount: { $gte: 1, $lte: 9 }, owner_id: 'u1' }` | three rules — they AND |
| `[['owner_id', '=', '{current_user_id}']]` | `[{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }]` |
| `{}` | `[]` |

Values are carried verbatim, value placeholders and date macros included. The operator comes
from the two tables the doors already use — a declared FilterCondition operator (`$gt`, `$nin`,
`$notContains`, …) folded through `normalizeFilterOperator`, and an AST infix spelling (`=`,
`!=`, `>=`, …) lowered through `parseFilterAST` — and every produced rule must parse at the
door, so a converted page re-saves cleanly.

**Where it runs.** On every stored-row read (`applyConversionsToStoredItem` replays it), so
the metadata API already serves such a page in the rule-array form; `os migrate meta --stored --apply`
persists it; `os migrate meta --from 17` lists the edits for author sources. It is retired from
the authoring load path, so `defineStack` / `os validate` still refuse an author who writes the
record form and teach the rule array — no accept-set change.

**What is left exactly as stored.** A filter carrying `$and` / `$or` / `$not` is never
flattened: the rule array only ANDs, and flattening `$or` or `$not` changes which rows the page
selects. So is any filter with a part that has no lossless rule spelling — a `null` value (the
renderer skips that key today, where a rule would test IS NULL), `$null` / `$exists`, an AST
`like` / `ilike`, an array or object comparand in equality position, an AST `and` / `or` group.
Conversion is all-or-nothing per filter: converting the mappable keys and dropping the rest
would widen the filter. And every filter — the binding's included — of a component whose rows
are **inline** (`data: { provider: 'value', … }`, a `data` array, or `staticData`) is left as
stored: the `object-map`, `object-tree`, `object-calendar` and `object-gantt` renderers match
that filter against their own rows in an in-memory data source that reads the record form but
excludes every row for a rule array, so a rewrite there would empty the block. The same filter
on a block that queries an object converts. Such a page keeps loading and rendering unchanged and is refused at its
`filter` door on its next save — and for a combinator record that refusal no longer renders the
combinator as a field (`{ field: '$or', … }`); it names the combinator and says why no rule
spells it. `os migrate meta --stored` does not list these rows yet: a row the conversion leaves
as stored reports there as already on protocol.
