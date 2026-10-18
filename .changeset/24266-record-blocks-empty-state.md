---
"@objectstack/spec": minor
---

feat(spec): the bound record blocks `record:details`, `record:highlights` and `record:quick_actions` accept an authored `emptyState`, drawn only when the block's `dataSource` binding answers no row

Clause-②: yes (widening)

- **The key.** `RecordDetailsProps`, `RecordHighlightsProps` and `RecordQuickActionsProps` each gain an optional `emptyState`: the list view's own `EmptyStateSchema` by reference (`{ title, message, icon, link }`), the same shape `object-grid.emptyState` takes. Until now all three rows refused the key, so a page whose binding can legitimately answer no row (for example an environment block on an organisation with no production environment) could only show the block's own placeholder: "record not found", nothing, or an empty action bar.
- **When it is drawn.** Only when the block carries a node-level `dataSource` binding and that read answers no row. A block with no binding reads the record page's record and never draws it, a loading read draws the loading state, and a failed read draws its error. On `record:quick_actions`, a bound record whose bar resolves no action keeps the existing empty placeholder.
- **Planned, not yet rendered.** No renderer reads the key yet; each describe opens with `[PLANNED — not yet rendered]`, and the renderer half is objectstack-ai/objectui#12932, which ships once a spec release carrying the key is installable. Until then an authored `emptyState` validates and is not drawn.
- **No other row moves.** Every other `ComponentPropsMap` row still refuses `emptyState` (`record:related_list`, whose `parentDataSource` has its own declared answer for no row, included), so `os validate` keeps reporting it there as `component-props-unknown-key`. Nothing narrows.
