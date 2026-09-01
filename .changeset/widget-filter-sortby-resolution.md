---
'@objectstack/lint': minor
---

Resolve a dashboard widget's OWN `filter` keys and `options.sortBy` at validate/build

A dashboard widget could filter by a column that does not exist, and order by a name
it never selected, and `objectstack validate` exited 0 with "Validation passed";
`build` — the publish gate — wrote the dashboard into `dist/objectstack.json`. The
widget then rendered **empty**.

The surrounding surface was already covered, which is what made the two misses so
narrow: `widget-dataset-unknown`, `widget-dimension-unknown`, `widget-measure-unknown`,
`filter-token-unknown` and `dashboard-filter-field-unknown` all failed both gates on the
same dashboard. On the very same node, the filter TOKEN was checked and the filter
COLUMN was not — `filter-token-unknown` fires path-precise at
`…widgets[4].filter.due_date.$lte`, so the traversal already walked the filter tree and
already knew the widget's dataset. Only the key resolution was missing. And
`options.sortBy` was declared-≠-enforced in the plainest way available: the spec states
the contract in its own prose — *"must be one this widget actually selects"* — and
nothing enforced it.

Why this class of miss is expensive rather than untidy, in the reporter's words: the
dashboard it was measured on leads with a "not moving" tile — open work untouched more
than 14 days — and *"an empty tile is indistinguishable from a healthy team: a missing
number reads as zero, and zero is the answer the manager is hoping for."* The failure is
silent in the direction the reader wants to believe.

Three gating rule ids, all at the site that already emits `widget-dataset-unknown` /
`dashboard-filter-field-unknown`, and all failing **`validate` and `build`** (pinned
end-to-end, not inferred from the registry entry):

- `widget-filter-field-unknown` — a key of the widget's own `filter` resolves to no
  column on the bound dataset's object graph. Reported path-precise at
  `dashboards[i].widgets[j].filter.<key>`, matching `filter-token-unknown`'s precision in
  that same subtree.
- `widget-filter-field-not-included` — the key resolves, but its relationship prefix is
  not declared in the dataset's `include`, so ADR-0021 compiles no join and the column is
  out of the query's reach.
- `widget-sortby-unselected` — `options.sortBy` names neither a `dimensions[]` nor a
  `values[]` entry of the widget. A name the dataset declares but the widget did not
  select gets its own message, because the fix is a selection rather than a spelling.

**A dotted path through a declared `include` is RESOLVED, not skipped.** A widget's
`filter` is ANDed into the dataset query as `runtimeFilter`, and that compiled query
carries only the joins `include` declared — so the same two clauses the dataset rule
applies one level down (existence, then joinability) apply here. The runtime is not a
backstop for the second: the dataset compiler's `assertDeclared` runs over `dimensions`
and `measures` only, never over `runtimeFilter`.

Built on the seams that shipped with the dataset-level sibling rather than a second
implementation: `walkFilterFieldKeys` (all three authored filter shapes) and
`indexObjectGraph` / `resolveFieldPath`. Two helpers that were local to that rule —
`joinablePrefixes` and `describeFieldPathVerdict` — moved into the shared seam and are
now exported, because both are answers this position asks identically and copying either
would have been the second implementation the seam exists to prevent.

Minor rather than patch: this narrows the accept set. Metadata that built yesterday and
names a column or an order that does not exist now fails the build — which is the point.
The three skips every field-existence rule in this package takes are unchanged, so an
object the stack does not define, an ADR-0015 `external` object with no readable field
map, and a registry-injected system column are never reported.
