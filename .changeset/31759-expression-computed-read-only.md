---
'@object-ui/core': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-detail': patch
---

fix(ui): a stored field carrying an `expression` is read-only on every write surface, as a formula is

Clause-②: yes (widening)
Metadata-protocol: none

- **Before.** A non-`formula` field with an `expression` (for example a `currency` amount computed from quantity times unit price) is computed by the engine on every write, so a client-sent value never stands. The record form still drew it as an editable input, a list grid offered an editable cell, the record page offered inline edit, and the import wizard offered it as a column to write. The save then replaced what the user typed, with no message.
- **Now.** Such a field is computed exactly as a `formula` is. The auto-layout create form leaves it out. The auto-layout edit form, and an authored form section on create or edit, draw its type's read face (the formatted value, no input), and the edit save does not send it. A list grid cell, the record page's details body, its highlight strip and its path stage offer no editor. The import wizard offers it only as a match key, as it does a `readonly` field, and the spreadsheet import bar does not offer it. The value itself is unchanged: the engine computed it before and still does.
- **The widening.** `@object-ui/core` exports `isExpressionComputedField(def)`. It answers whether an object field carries a non-empty `expression`, either a bare CEL string or the `source` of the `{ dialect, source }` envelope, which is the spec's own reading. Every gate above asks it alongside its type list. Nothing is removed or renamed.
