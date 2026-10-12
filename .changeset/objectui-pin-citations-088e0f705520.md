---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `088e0f705520`.

Clause-②: no

Every anchor was mapped through the objectui diff `e5311165a8d6..088e0f705520`: 54 paths over 3 commits (objectui#12110's rich-text hint lines, objectui#12174 and objectui#12175). One file a record cites changed on the hop. In `form.tsx` (+3, objectui#12175 registering the `position-ref` / `permission-ref` widget hints), `spanLadderFor` held at `:275-302` byte-identical and its one call site moved `:3326` -> `:3329` with the call byte-identical, so `FormField.span: 'full'` still takes the whole row at every multi-column tier. Every other record cites only files that are byte-identical across the hop, and each gains a hop sentence that says so.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `e5311165a8d6` number. The corpus is now 8519 tracked files, and every retired name each entry counts still reads 0. The lit controls moved with the corpus, for example `objectstack` from 18355 to 18400 and `useState` from 2659 to 2661.

No key, default, enum member or export moves.
