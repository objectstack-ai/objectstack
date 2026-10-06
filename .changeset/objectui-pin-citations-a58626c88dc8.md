---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `a58626c88dc8`.

Clause-②: no

Every anchor was mapped through the objectui diff `0abd4f9f8769..a58626c88dc8`, 252 paths over 36 commits. Fifteen of those paths are files an asserting record cites: `ObjectKanban.tsx`, `KanbanImpl.tsx`, `ObjectTree.tsx`, `ObjectTimeline.tsx`, `record-details.tsx`, `action-group.tsx`, `action-menu.tsx`, `static-params.ts`, `MetricWidget.tsx`, `MetricCard.tsx`, `form.tsx`, `plugin-kanban.mdx` and the `en` / `zh` / `de` packs. In each, every cited line is byte-identical at the new pin, so each anchor that moved was re-pointed to its new line and the record says by how much; no read point an asserting record cites changed content or died. Every other cited file is byte-identical across the hop (`git diff --quiet`). The seven quoted anchor lines verify against objectui at the new pin. Three records carry a count, and each count was re-taken by its record's own method with the same reading: the `keyboardNavigation` hit lines (15, against 3 for the `schema.editable` control), `ObjectKanban.tsx`'s `quickAdd` / `onQuickAdd` (2 each, against 11 for `onCardClick`), and the `ElementDataSourceGate` occurrences in five `src/index.tsx` shells (0, 3, 3, 3 and 4).

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that first reproduced every `0abd4f9f8769` number. The corpus is now 7754 tracked files. All 99 checked tokens (the export lists of `plugin-lifecycle-advanced.zod.ts`, `tracing.zod.ts` and `metrics.zod.ts`, plus every named key) still read zero, except `Span` / `SpanSchema`, which read 509 / 57: the one new `Span` hit is a `colSpan`.

No key, default, enum member or export moves.
