---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `0abd4f9f8769`.

Clause-②: no

Every anchor was mapped through the objectui diff `9dfaca654311..0abd4f9f8769`, 50 paths over five commits. None of those paths is an objectui file that an asserting record cites, so every cited file is byte-identical across the hop (`git diff --quiet`) and every anchor held unmoved. The seven quoted anchor lines verify against objectui at the new pin. Three records carry a count, and each count was re-taken by its record's own method with the same reading: the `keyboardNavigation` hit lines (15, against 3 for the `schema.editable` control), `ObjectKanban.tsx`'s `quickAdd` / `onQuickAdd` (2 each, against 11 for `onCardClick`), and the `ElementDataSourceGate` occurrences in five `src/index.tsx` shells (0, 3, 3, 3 and 4).

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that first reproduced every `9dfaca654311` number. The corpus is now 7650 tracked files. All 98 checked tokens read as before: every zero still reads zero, and `Span` / `SpanSchema` still read 508 / 57.

No key, default, enum member or export moves.
