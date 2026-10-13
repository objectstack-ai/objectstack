---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `e5311165a8d6`.

Clause-②: no

Every anchor was mapped through the objectui diff `4997995022f8..e5311165a8d6`: 287 paths over 24 commits, four deleted (`StudioHomePage.tsx`, its two tests and `permission-set-clone-dispatch.ts`, none of which a record cites) and none renamed. Five files a record cites changed on the hop, plus the `en` / `zh` / `de` packs (whose `calendar.configRequired` strings did not change): `ObjectGrid.tsx` (objectui#12110 and objectui#12143), `data-table.tsx` (objectui#12124 and objectui#12145), `form.tsx` (objectui#12110, objectui#12130 and objectui#12155), `record-related-list.tsx` (objectui#12082) and `data-objectstack/src/index.ts` (objectui#12112). Every cited line in them moved or held with its text byte-identical, and each record that cites one is re-pointed with a hop sentence that says by how much. The records that cite only byte-identical files gain a hop sentence that says so.

Two readings sit beside a cited read, and each hop sentence says what it found:

- `record-related-list.tsx`: the list's fallback remove now reads the affordance-to-grant map's `relatedRowDelete` row (objectui#12082). The hunks sit above and below the `requiredPermissions` gate; the gate and the related object's read gate are byte-identical, 17 lines down.
- `form.tsx`: the built-in branches now settle the widget a field hint renders and the props they hand their control (objectui#12110, objectui#12155, objectui#12130). `spanLadderFor` and its one call site are byte-identical, so the `span` describe's reading holds.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `4997995022f8` number. The corpus is now 8506 tracked files. Every token an entry counts as zero still reads zero: 124 candidate tokens (every export of the four spec files the entries name, and every key they name) read zero at both pins. `Span` reads 519 against 517, both new hits `colSpan`, and `SpanSchema` reads 57 at both pins, as the tracing entry records. The controls moved with the corpus, for example `objectstack` from 18271 to 18355 and `timeout` from 1704 to 1706.

No key, default, enum member or export moves.
