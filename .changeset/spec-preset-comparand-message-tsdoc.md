---
'@objectstack/spec': minor
---

`bareDateRangePresetComparandMessage`'s TSDoc — published in `dist/*.d.ts` — now states both moments the wording is reported at: the field-agnostic schema door in `data/filter.zod.ts` (ordering positions only: without a field type, equality on a select column is legitimate) and `@objectstack/lint`'s `filter-preset-comparand` rule, which with the field type in hand refuses every comparand position on a declared `date` / `datetime` field (#16106). The message text itself is unchanged.
