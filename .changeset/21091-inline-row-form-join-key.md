---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

`deriveInlineRowFormFields` and `isInlineRowFormOffered` (`@objectstack/spec/data`) state which fields an inline master-detail grid's per-row expand form draws and when that form is offered, and `field-no-consumers` stops calling four more kinds of in-use child field "inert" (#21091).

Clause-②: yes (widening)

- **`@objectstack/spec`.** Two new exports from `@objectstack/spec/data`, beside `deriveInlineGridColumns`:
  - `deriveInlineRowFormFields(def, { relationshipField?, exclude? })` returns the child field names of the per-row expand form, in the child's field order. It skips the same system, audit, tenancy, ownership and sort-position names as the grid, the relationship field, `exclude`, `system` and `hidden` fields, and the computed types (`formula`, `summary`, `rollup`, `autonumber`, `auto_number`). Unlike the grid it keeps `readonly` fields and the rich types a cell cannot edit (`richtext`, `json`, `markdown`, …), so the derived grid's columns are always a subset of its fields.
  - `isInlineRowFormOffered({ inlineMode?, formFields?, columns? })` is `true` when the form factor is `form`, or when the form has more fields than the grid has columns.
  - Both are the renderer's current rule, reproduced exactly. No schema accepts anything new or refuses anything new.
- **`@objectstack/lint`.** `os validate` no longer warns that these fields are inert:
  - a `lookup` field that sets `inlineEdit`: it is the inline grid's join key, read whatever columns the grid draws, as a `master_detail` field already was;
  - a field a derived inline grid's per-row expand form draws, through `deriveInlineRowFormFields`, such as a `readonly`, `richtext` or `json` child field;
  - a field named in an `object-master-detail-form` detail entry's `formFields`, now read against the entry's `childObject` instead of the block's object. When the form is never offered for the list, the list is reported as a carrier. That is judged on an entry that names both its `relationshipField` and its `columns` under its declared `inlineMode` or none. On any other entry it is judged under a declared `inlineMode` where the grid can be counted: authored `columns`, or the derived grid of a named `relationshipField`. Otherwise the list is credited as drawn;
  - a field named in a `record:line_items` block's `columns`, `relationshipField`, `amountField`, `sort` or `filter`, now read against the block's `childObject`.

  A parent field that shares a name with one of those child fields was credited in the child's place, and is now reported if nothing else reads it. A child field nothing draws or names, such as a `hidden` one, is still reported.
