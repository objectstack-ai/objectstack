---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `088e0f705520`.

Clause-②: no

Every anchor was mapped through the objectui diff `e5311165a8d6..088e0f705520`: 54 paths over 3 commits (objectui#12110's rich-text hint lines, objectui#12174 and objectui#12175). Files that three records cite changed on the hop, all for objectui#12175, and every cited line in them held or moved with its text byte-identical:

- `form.tsx` (+3, registering the `position-ref` / `permission-ref` widget hints): `spanLadderFor` held at `:275-302`, and its one call site moved `:3326` -> `:3329` with the call unchanged. So `FormField.span: 'full'` still takes the whole row at every multi-column tier.
- `data-objectstack/src/index.ts` (+33 at `:5335`, the adapter's `listMetadataItems`): this lands below both reads the curated-public-blocks record cites, so `serializeOrderBy` `869-895` and the `translateFilterArray` arm `5066-5077` are unmoved.
- The `en` / `zh` / `de` packs (`fields.registryRef` keys, +4 each): the calendar record's `calendar.configRequired` strings moved by +4 and did not change.

Every other record cites only files that are byte-identical across the hop (`git diff --quiet`, checked file by file), and each gains a hop sentence that says so.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `e5311165a8d6` number. The corpus is now 8519 tracked files, and every retired name each entry counts still reads 0. The lit controls moved with the corpus, for example `objectstack` from 18355 to 18400 and `useState` from 2659 to 2661.

No key, default, enum member or export moves.
