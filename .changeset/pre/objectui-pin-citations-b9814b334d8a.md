---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `b9814b334d8a`. Four descriptions this pin makes true change with it.

Clause-②: no

The four descriptions, each now read by the console at this pin:

- `EmptyStateSchema.link`, the one link an empty state carries, no longer opens with `[PLANNED — not yet rendered]`. The console draws it in a list's empty state (the `grid` and `gallery` visualizations) and in an `object-grid` block's empty state, and follows it through its action runner (objectui#12270).
- A list page's own `interfaceConfig.emptyState` no longer opens with `[PLANNED — not yet rendered]`. The console's list page prefers it, whole, over its source view's empty state (objectui#12270).
- A `record:details` section's `count` no longer opens with `[EXPERIMENTAL — not enforced]`. The record detail page fills the heading's `{{ count }}` hole (objectui#12192).
- The `object-grid` block's `emptyState` description names `link` among the members the grid draws.

The two liveness-ledger notes that excluded `emptyState.link` and `interfaceConfig.emptyState` from their rows' `live` verdict now say both are covered.

Every asserting citation (55, across 2047 spec sources) was mapped through the objectui diff `1fb1ced36243..b9814b334d8a`: 397 paths over 36 commits. Where a cited file changed, each cited line was re-read and its new number recorded; none changed what it reads. The moved files are `ObjectGrid.tsx`, `data-table.tsx`, `ListView.tsx`, `ObjectCalendar.tsx`, the `en` / `zh` / `de` packs, `record-details.tsx`, `record-highlights.tsx`, `record-quick-actions.tsx`, `data-objectstack/src/index.ts`, `objectql.ts`, `plugin-kanban/src/index.tsx`, `plugin-grid/src/index.tsx`, `plugin-calendar/src/index.tsx` and `block-types.ts`. Every other record cites only files that are byte-identical across the hop, and each gains a hop sentence that says so. Three quoted anchors of the `map` block record moved and were re-pointed; they are `case 'map':` in `ObjectView.tsx`, and `ObjectMapConfigSchema` and `LIST_VIEW_LOCAL_OVERRIDES` in `objectql.zod.ts`.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `1fb1ced36243` number. The corpus is now 8743 tracked files. A superset of 98 names reads 0: the 13 lifecycle, 31 metrics and 37 tracing exports, and 17 further names the entries count (their retired key names and the two logging defs). The unrelated `Span` 519 and `SpanSchema` 57 are unchanged. The lit controls moved with the corpus, for example `objectstack` from 18601 to 18854, `timeout` from 1700 to 1750 and `tenant` from 1415 to 1420.

No key, default, enum member or export moves.
