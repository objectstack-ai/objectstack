---
'@objectstack/spec': patch
---

`element:record_picker`'s `filter` docblock now says what the `object-*` blocks actually declare

The docblock on `ElementRecordPickerPropsSchema.filter` (anchor:
`Filter rules narrowing which records the picker offers`) carried a
parenthetical claiming *"the four `object-*` blocks declare `filter` as
`z.unknown()`, no orthography at all"*. Measured on the file itself: there is no
`filter` key anywhere in `packages/spec/src/ui/component.zod.ts` declared
`z.unknown()` — zero occurrences, against 61 occurrences of `z.unknown()` in the
same file on the same instrument, so the zero is a reading and not a broken
matcher. All eight Zod `filter` declarations in the file are
`z.array(ViewFilterRuleSchema).optional()`; the one remaining `filter:` line is a
`KeySetGuidance` prose entry, not a declaration.

The `object-*` family in `ComponentPropsMap` has **six** entries. **Four** of
them carry a `filter` door — `object-grid`, `object-metric`, `object-kanban`,
`object-calendar` — and all four declare `z.array(ViewFilterRuleSchema)`. The
other two, `object-form` and `object-master-detail-form`, declare no `filter`
key at all. The corrected parenthetical states both numbers and names all six,
and keeps the `#15449` citation, which is accurate as provenance for when those
four doors moved onto the array form.

**Why this is worth a patch rather than a silent tidy.** The sentence sat in the
one docblock that tells an author what the sibling `filter` doors accept, and it
told them those doors accept anything. The record form it thereby invited —
`{ field: { $eq: ... } }`, the MongoDB-style shape this very docblock says the
picker moved OFF — is refused at parse by all four. Prose only: no declaration
moves and no accept set changes.
