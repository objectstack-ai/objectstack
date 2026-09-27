---
'@objectstack/spec': patch
---

One published `describe` sentence that dates itself to the `.objectui-sha` pin is re-pointed to the pin this release builds against, objectui `f8a9d0fb0596`, after being re-read there (#20029).

`Clause-②: no`

- `FormField.span`: the `'auto'` clause says that at the pin this repo builds against, only textarea, markdown, html, richtext and repeater resolve to the full column count. It named `62597c588`. Re-read at `f8a9d0fb0596`, the claim still holds: `plugin-form`'s `autoLayout.ts` (`WIDE_FIELD_TYPES`, `resolveColSpan`) is byte-identical, and `form.tsx` changed only in its registration's input list (a `children` slot input), with `spanLadderFor` byte-identical, so `'full'` is still the whole row at every multi-column tier. Only the pin the sentence names moves.

No key, default, enum member or export moves: the same authored metadata is accepted and refused as before, and `content/docs/references/ui/view.mdx` is regenerated from the sentence.
