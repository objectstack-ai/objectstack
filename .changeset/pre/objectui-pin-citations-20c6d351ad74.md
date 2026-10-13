---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `20c6d351ad74`.

Clause-②: no

Every anchor was mapped through the objectui diff `47b1f0bb7174..20c6d351ad74`: 320 paths over 24 commits, 2 of them deleted test files, none renamed. Ten files a record cites changed on the hop, plus the `en` / `zh` / `de` packs: `ListView.tsx` and `ObjectTimeline.tsx` (objectui#6152 rounds 14 and 15), plugin-view's `ObjectView.tsx`, `objectql.ts` and `objectql.zod.ts` (the same rounds and objectui#12063), `KanbanImpl.tsx` and `plugin-grid/src/index.tsx` (objectui#6349 batch 7), `ActionRunner.ts` (objectui#6349 batch 4), `data-objectstack/src/index.ts` (objectui#5144) and `previews/block-config.ts` (objectui#12056). Every cited line in them moved or held with its text byte-identical, except in the four readings below, and each record that cites one is re-pointed with a hop sentence that says by how much. The records that cite only byte-identical files gain a hop sentence that says so.

Three readings changed around a cited read, and each hop sentence says what it found:

- The calendar, gantt and tree arms of `ListView.tsx` changed inside (objectui `3fd862510` retired their raw block spreads, the calendar's `defaultView` lift and the tree's `titleField` label rung). The calendar and gantt rows of `functional-completeness.ts` still hold: their date bindings stay conditional, with no floor.
- `previews/block-config.ts` now writes the repeater's object and limit into the node-level `dataSource` (objectui#12056); the two inspectors span `311-351`.
- `ObjectTimeline.tsx`'s start-date chain lost its nested `timeline.dateField` rung; it still ends without a literal rung, and the component's `schema.*` read set is unchanged.

The fourth reading: one record names a read that is gone at this pin. The `OBJECT_TREE_FLAT_CONFIG_GUIDANCE` docblock keeps `titleField` in the flat tree key set because `ListView`'s flatten resolved `treeCfg.titleField` into `labelField`. objectui `3fd862510` removed that rung. The hop sentence records it; the paragraph and the key set are left as they are, because changing the key set is a schema decision this re-read does not make.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `47b1f0bb7174` number. The corpus is now 8351 tracked files. Every token an entry counts as zero still reads zero (97 tokens). The controls moved with the corpus, for example `objectstack` from 17980 to 18047 and `timeout` from 1674 to 1694.

No key, default, enum member or export moves.
