---
'@objectstack/spec': patch
---

Two published `describe` sentences that the `.objectui-sha` bump to objectui `87af769e9a3e` makes false are corrected against the new pin (#17429).

`Clause-②: no`

Both are claims about what the SHIPPED console renderer does, so the pin is what dates them — and both were re-read by executing the pinned tree, not by refreshing a sha.

- `Dataset` measure `format`: the clause said "a datetime value ignores it". objectui#8352 lands inside the `53ded82bf7a4...87af769e9a3e` range and makes the datetime arm of `formatMeasureDate` honour the same two words the date arm does — `relative` through `formatRelativeDate`, `short` through `formatDateTime(v, { locale, style: 'compact' })`. A date PATTERN is still ignored on both arms, which is the half of the sentence that survives.
- `FormField.span`: the clause said only the widest container-query tier's class is emitted, so a `'full'` field took one cell of two at the 720px modal width (objectstack#17328). objectui#9244 / objectui#9253 (objectui `bd09957380`) are also inside the range: `spanLadderFor` now emits one clamped col-span class per multi-column tier, so `'full'` is the whole row at every multi-column tier. The `'auto'` half — textarea, markdown, html, richtext and repeater — re-measured unchanged at the new pin.

No key, default, enum member or export moves: the same authored metadata is accepted and refused as before, and `content/docs/references/ui/{dataset,view}.mdx` are regenerated from these two sentences.
