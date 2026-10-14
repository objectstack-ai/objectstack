---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `0df67f237c5a`.

Clause-②: no

Every anchor was mapped through the objectui diff `20c6d351ad74..0df67f237c5a`: 293 paths over 21 commits, none deleted and one renamed (`resolveActionParams.ts`, which no record cites). Seventeen files a record cites changed on the hop, plus the `en` / `zh` / `de` packs (whose `calendar.configRequired` strings did not change): `ObjectGrid.tsx`, `ListView.tsx`, `ObjectCalendar.tsx`, `plugin-calendar/src/index.tsx`, `ObjectTimeline.tsx` and plugin-timeline's `renderer.tsx`, `ObjectKanban.tsx`, `KanbanBoardCore.tsx`, `KanbanImpl.tsx`, `plugin-kanban.mdx`, `MePermissionsProvider.tsx`, `PermissionProvider.tsx`, `record-details.tsx`, `basic/data-list.tsx`, `data-objectstack/src/index.ts`, `form.tsx` and plugin-view's `ObjectView.tsx`. Every cited line in them moved or held with its text byte-identical, and each record that cites one is re-pointed with a hop sentence that says by how much. The records that cite only byte-identical files gain a hop sentence that says so.

Three readings changed around a cited read, and each hop sentence says what it found:

- `basic/data-list.tsx`: the `element:repeater` registration no longer publishes the flat `object` / `filter` / `sort` / `limit` inputs; the node-level `dataSource` binding is its one published query input (objectui#12085). The renderer still reads the four as the binding's fallback. The row's two sentences that named the published inputs are rewritten where they stand.
- `ObjectGrid.tsx`: the `delete` verdict the implicit bulk-delete is gated on now comes from the affordance-to-grant map's `rowDelete` row (objectui#12082). It still asks the managed-object policy and the object's effective API operations, now with the caller's delete grant beside them, so the `sys_api_key` reading holds. The `inlineEditable` verdict reads the same map's `listInlineEdit` row.
- `ListView.tsx`: the calendar arm gained objectui#12081's fetch window. Its date-field reads are byte-identical and still declared-only, with no floor.

The re-read also corrects two anchors the previous hop left on the `object-tree` flat-config record: its opening still named the `case 'tree'` arm at its `47b1f0bb7` span, and its hop cited the `labelField` line one line low.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `20c6d351ad74` number. The corpus is now 8424 tracked files. Every token an entry counts as zero still reads zero (98 tokens). The controls moved with the corpus, for example `objectstack` from 18047 to 18248 and `timeout` from 1694 to 1705.

No key, default, enum member or export moves.
