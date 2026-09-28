---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
---

Clause-②: no

Sixteen live structured metadata keys are authorable in the metadata form: eleven on the field form — `accept`, `currencyConfig`, `dependsOn`, `lookupColumns`, `lookupFilters`, `readonlyWhen`, `relatedListColumns`, `requiredPermissions`, `requiredWhen`, `storage`, `visibleWhen` — and five on the action form — `bodyExtra`, `description`, `errorMessage`, `patch`, `requiredPermissions`. Each was **declared** by its schema, graded `live` by the liveness ledger, and offered by **no** form in `METADATA_FORM_REGISTRY`, so an author's only door was the Source tab. Each now has exactly one row, whose control copies a row a registered form already carries for the same node shape:

- `visibleWhen`, `readonlyWhen`, `requiredWhen` — `type: 'code'`, `language: 'expression'`, the object designer's per-field rows for the same three keys.
- `lookupFilters` — `widget: 'json'`, the object designer's per-field row for the same key; no inline operator list, because `notIn` is not a spellable option value.
- `lookupColumns`, `dependsOn` — `widget: 'json'`, **never** `string-tags`: each is an array of a union (a field name, or an object entry), and the tag widget is a chip input for strings only, which cannot show or edit a stored object entry.
- `accept`, `relatedListColumns`, and both `requiredPermissions` — `widget: 'string-tags'`, the app form's `requiredPermissions` row: a chip input over a plain `string[]`.
- `currencyConfig`, `storage` — a `composite` with declared sub-rows (`currencyMode` as a `dynamic` / `fixed` select, `defaultCurrency`; `notNull`), the shape of the object form's `access` row.
- `patch`, `bodyExtra` — `widget: 'json'` over a string-keyed record.
- `description` — `widget: 'textarea'`, the page form's `description` row, over the same `I18nLabel` node; `errorMessage` — a plain row, the twin of `successMessage`.

Each type-specific row is gated to the types its runtime reader serves: the media types for `accept`, `currency` for `currencyConfig`, `lookup` / `master_detail` for the picker and related-list rows, those two plus the four option types for `dependsOn`, `operation: 'update'` for `patch` (the parse refuses it anywhere else), and `type: 'api'` for `bodyExtra`. The help text states what the runtime does with each value, including what absence resolves to. The four field-name lists (`relatedListColumns`, `lookupColumns`, `lookupFilters[].field`, `dependsOn`) are free text: no authoring door judges their names today — not the schema parse, not the publish door and not `os validate` — so the help text claims no such refusal.

⛔ **No schema accept set moves and no export changes.** `METADATA_FORM_REGISTRY` is declared as an opaque `Readonly<Record<string, FormView>>`, so row contents were never part of the declared surface. What changes is the **form payload** `getMetaTypes()` serves and the translation keys `os i18n extract` walks — hence the regenerated `platform-objects` metadata-form bundles, whose 38 new leaves are authored in `zh-CN`, `ja-JP` and `es-ES` rather than left as extractor fills.

⛔ **The gate that would notice a missing row is NOT landed here.** The reconciliation gate's top-level `zodOnly` direction stays unwired; this change lands offers only.
