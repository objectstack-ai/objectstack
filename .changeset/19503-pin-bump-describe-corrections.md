---
'@objectstack/spec': patch
---

One published `describe` sentence that dates itself to the `.objectui-sha` pin is re-pointed to the pin this release builds against, objectui `62597c588072`, after being re-read there (#19503).

`Clause-②: no`

- `FormField.span`: the `'auto'` clause says that at the pin this repo builds against, only textarea, markdown, html, richtext and repeater resolve to the full column count. It named `87af769e9`. Re-read at `62597c588`, the claim still holds: `plugin-form`'s `WIDE_FIELD_TYPES` is unchanged (it shifted one line when an import was added above it; repeater still reaches it through `field:grid`), and `form.tsx`'s `spanLadderFor` is byte-identical, so `'full'` is still the whole row at every multi-column tier. Only the pin the sentence names moves.

No key, default, enum member or export moves: the same authored metadata is accepted and refused as before, and `content/docs/references/ui/view.mdx` is regenerated from the sentence.
