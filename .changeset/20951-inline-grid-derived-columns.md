---
'@objectstack/spec': minor
'@objectstack/lint': patch
---

`deriveInlineGridColumns` (`@objectstack/spec/data`) derives the default columns of an inline master-detail grid, and `field-no-consumers` stops calling two kinds of in-use child field "inert" (#20951).

Clause-②: yes (widening)

- **`@objectstack/spec`.** New exports from `@objectstack/spec/data`: `deriveInlineGridColumns(def, { relationshipField?, exclude?, maxColumns? })`, its element type `DerivedInlineGridColumn`, and `DEFAULT_MAX_INLINE_GRID_COLUMNS` (`6`). The function answers which child fields an inline grid draws when its author listed no columns: a relationship field with `inlineEdit` and no `inlineColumns`, or a `subforms` entry with no `columns`. It returns identity-only entries (`{ name }`, plus `defaultHidden: true` on columns past the visible budget, which collapse into the column chooser and are never dropped), in the child's field order, skipping system, audit, tenancy, ownership and sort-position names, the relationship field, `system` / `readonly` / `hidden` fields and the types a grid cell cannot edit. It is the renderer's current rule, reproduced exactly; the renderer hydrates each column from the child field. No schema accepts anything new or refuses anything new.
- **`@objectstack/lint`.** `field-no-consumers` now reads a `subforms` entry's `amountField` and `relationshipField` against the entry's `childObject`, and keeps `totalField` on the parent. It also credits the columns of a derived inline grid through `deriveInlineGridColumns`. Before, `os validate` warned that the child's summed amount column, the subform's relationship field and every derived grid column were inert, and credited a same-named parent field in the amount column's place. A field the derivation leaves out (for example a `hidden` one) is still reported.
