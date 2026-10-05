---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `9dfaca654311`.

Clause-②: no

Every anchor was mapped through the objectui diff `2e818d0b51ec..9dfaca654311` and re-read at the new pin. One cited line changed: `ObjectKanban.tsx:10`, the type import, gained `SortConfig` beside the `ObjectKanbanSchema` the record cites. Every other change in a cited file sits outside the cited lines, and the anchors moved with their text byte-identical:

- `plugin-grid/src/ObjectGrid.tsx`, `plugin-tree/src/ObjectTree.tsx`, `plugin-gantt/src/ObjectGantt.tsx`, `plugin-calendar/src/ObjectCalendar.tsx`, `react/src/SchemaRenderer.tsx`, `plugin-map/src/index.tsx`, `plugin-gantt/src/index.tsx` and `plugin-view/src/ObjectView.tsx`: objectui#8347 re-worded docblocks that described `BaseSchema`'s index signature. Anchors below those docblocks moved by at most three lines.
- `plugin-kanban/src/ObjectKanban.tsx`: objectui#8347 added a private `GateBoundKanbanSchema` read type above the board's fetch, so the fetch, the navigation reads and the spread into `KanbanBoardCore` moved by 30 lines. The board still reads `limit` and `navigation` as `ObjectKanbanSchema` declares them.
- `plugin-kanban/src/index.tsx`, `plugin-dashboard/src/index.tsx` and `react/src/element-data-source/ElementDataSourceGate.tsx`: objectui#11605 made `objectName` a non-required input and added the "no object named" hint. The `object-metric` icon input moved from `:281` to `:299`, and it is still `{ name: 'icon', type: 'string' }`.
- `components/src/renderers/layout/containers.tsx`: objectui#11619 added the record picture to the record chrome. The `page:tabs` and `page:accordion` icon anchors moved by three lines.
- `packages/types/src/objectql.ts` and `packages/types/src/zod/objectql.zod.ts`: objectui#11615, objectui#11266 and objectui#8347 grew declarations above the cited members. `ObjectKanbanSchema.limit`, `ObjectMapConfigSchema` and `LIST_VIEW_LOCAL_OVERRIDES` moved with their text byte-identical.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that first reproduced every `2e818d0b51ec` number. The corpus is now 7632 tracked files. Every zero still reads zero; the three new `Span` hits are a `colSpan` in an objectui test.

No key, default, enum member or export moves.
