---
'@objectstack/spec': patch
---

One published `describe` sentence that dates itself to the `.objectui-sha` pin is re-pointed to the pin this release builds against, objectui `dd3f7e1be356`, after being re-read there.

Clause-②: no

- `FormField.span`: the `'auto'` clause says that at the pin this repo builds against, only textarea, markdown, html, richtext and repeater resolve to the full column count. It named `f8a9d0fb0596`. Re-read at `dd3f7e1be356`, the claim still holds. `plugin-form`'s `autoLayout.ts` `WIDE_FIELD_TYPES` (`:58-69`) and `resolveColSpan` (`:154`) are byte-identical; its only change is one docblock line. `form.tsx`'s `spanLadderFor` (`:204-231`) is byte-identical, so `'full'` is still the whole row at every multi-column tier. Only the pin the sentence names moves.

No key, default, enum member or export moves: the same authored metadata is accepted and refused as before, and `content/docs/references/ui/view.mdx` is regenerated from the sentence.
