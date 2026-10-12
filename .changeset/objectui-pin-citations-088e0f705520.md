---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `088e0f705520`.

Clause-②: no

Every anchor was mapped through the objectui diff `4997995022f8..088e0f705520`: 325 paths over 27 commits. Four files a record cites changed on the hop, and every cited line in them moved or held with its text byte-identical:

- `ObjectGrid.tsx` (+27/-11: objectui#12143's grouped-pager button names and objectui#12110 item 1's column-label override): the bulk-selection block moved by +16 and still hashes to `c88443302d40`; the `keyboardNavigation`, `inlineEditable` and grid empty-state reads moved by +6 or +16.
- `data-table.tsx` (+12/-1: objectui#12124's pager button names): the five arrow-key anchors moved by +7.
- `record-related-list.tsx` (+22/-3: objectui#12082, the fallback remove reads the affordance-to-grant map): the five `requiredPermissions` gate anchors moved by +17.
- `form.tsx` (+231/-79: objectui#12130, objectui#12155, objectui#12110 and objectui#7611 PR-5): `spanLadderFor` moved by +1 and its call site by +71, both unchanged, so `FormField.span: 'full'` still takes the whole row at every multi-column tier.

The records that cite only byte-identical files gain a hop sentence that says so. The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `4997995022f8` number. The corpus is now 8519 tracked files, and every retired name each entry counts still reads 0. The lit controls moved with the corpus, for example `objectstack` from 18271 to 18400 and `timeout` from 1704 to 1706.

No key, default, enum member or export moves.
