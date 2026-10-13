---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `1fb1ced36243`.

Clause-②: no

Every anchor was mapped through the objectui diff `7578323a544e..1fb1ced36243`: 116 paths over 11 commits. One set of cited files changed on the hop, and every cited line in it held its text:

- The `en` / `zh` / `de` packs (two commits each: objectui#12248, objectui `51c661e38`, and objectui#12268, objectui `7af0ab378`) gained keys below line 1100 only (`en.ts` +9, `zh.ts` +6, `de.ts` +6). Their `calendar.configRequired` strings did not change and held at `en.ts` `:953`, `zh.ts` `:726` and `de.ts` `:706`. The functional-completeness `calendar` row says so.

Every other asserting record cites only files that are byte-identical across the hop (`git diff --quiet`, checked file by file), and each gains a hop sentence that says so. That covers `form.tsx`, `autoLayout.ts` and `field-type-alias.ts`, so `FormField.span: 'full'` still takes the whole row at every multi-column tier, and `ObjectGrid.tsx` and `data-table.tsx`, so the `keyboardNavigation` read still finds 15 hit lines against 3 for the control (no line of the hop's diff names `keyboardNavigation`).

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `7578323a544e` number. The corpus is now 8642 tracked files, and every retired name each entry counts still reads 0 (a superset of 99 names: the 13 lifecycle, 31 metrics and 37 tracing exports, and 18 key names the entries retire or count; the unrelated `Span` 519 and `SpanSchema` 57 are unchanged). The lit controls moved with the corpus, for example `objectstack` from 18552 to 18601, `timeout` from 1686 to 1700 and `tenant` from 1404 to 1415.

No key, default, enum member or export moves.
