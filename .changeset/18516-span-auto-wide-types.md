---
'@objectstack/spec': patch
---

`FormField.span`'s `'auto'` description now names the field types the form renderer actually widens, instead of three that it does not (#18516).

`Clause-②: no`

The clause told authors that wide widgets *"like textarea/richtext/json/file/subform take the whole row"*. Three of those five names were wrong and two real ones were missing. Re-measured against objectui at the `.objectui-sha` pin `53ded82bf7` by executing that tree's own `mapFieldTypeToFormType`, `isWideFieldType` and `resolveColSpan` over the whole `FieldType` population (**49** members, agreed by two instruments — the executed `.options` and the enum's source tokens with comments stripped):

- `WIDE_FIELD_TYPES` is **ten** entries — `textarea` / `markdown` / `html` / `grid` / `richtext`, each bare and `field:`-prefixed — in `plugin-form/src/autoLayout.ts` and again in its `plugin-detail` twin.
- `json` and `file` **are** spec field types, and both resolve to **one cell**, not the row (`json` maps to `field:code`, `file` to `field:file`). `subform` is not a spec field type at all.
- `markdown` and `html` **are** widened, and the sentence named neither.
- The set that resolves to the full column count is **five**: `textarea`, `markdown`, `html`, `richtext` and **`repeater`**. The measurement has to follow the path the form actually walks — every site that assigns `FormField.type` maps the spec name through `mapFieldTypeToFormType` first — and on that path `repeater` becomes `field:grid`, which is a member of `WIDE_FIELD_TYPES`. Measured only on the bare spec name the set is the four long-form types, which is what objectui's own pin asserts at that sha ("its spec-facing surface is EXACTLY the long-form family"); that reading is true of the bare path and is not the one an author's field takes. The literal `grid` stays unnamed because it is an objectui-local metadata key rather than a `FieldType`, so `type: 'grid'` is refused — but `repeater` is the spec spelling that reaches the same widget, and it is accepted.

An author reads that sentence to decide a form layout, so the cost of a wrong name is a layout decided on a type that behaves the opposite way — in either direction.

What the clause says now: those five resolve to the full **column count** — the number `resolveColSpan` really returns — leaving the sentence beside it to state how far down the container-query tiers that span is emitted. At this pin only the widest tier's class is emitted (`@2xl:col-span-3` for a 3-column grid, whose container class is `grid-cols-1 @md:grid-cols-2 @2xl:grid-cols-3`), so a wide field is one cell of two at the `@md` tier. Promising a whole row at every tier would be the same defect with its sign flipped.

Both readings are of one pin, so the citation moves from the historical spelling to the **asserting** one (`` `.objectui-sha` = `<sha>` ``): `check:objectui-pin-citations` compares an asserting citation against the pin file, so the next pin bump reds on this sentence and it cannot rot silently. That matters here — objectui `bd09957380` is already ahead of the pin and emits one clamped class per multi-column tier, which makes this sentence's tier half wrong the moment a bump absorbs it.

No key, default, enum member or export moves: the same authored metadata is accepted and refused as before.
