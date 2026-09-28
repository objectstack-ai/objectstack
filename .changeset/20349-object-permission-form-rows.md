---
"@objectstack/spec": minor
"@objectstack/platform-objects": patch
---

Five live structured metadata keys are authorable in the metadata form: `object.access`, `object.highlightFields`, `object.requiredPermissions`, `object.searchableFields` and `permission.adminScope`. Each was **declared** by its schema, graded `live` by the liveness ledger, and offered by **no** form in `METADATA_FORM_REGISTRY`, so an author's only door was the Source tab. Each now has exactly one row, whose control mirrors a row a registered form already carries for the same node shape:

- `highlightFields` and `searchableFields` (Basics, beside `nameField`) — `widget: 'string-tags'`, the view form's `searchableFields` row: a free-text chip list over `string[]`. A field picker is not offered because the object draft carries no source object for one to read its catalog from. A misspelt entry is not dropped quietly: publishing refuses it (`object-field-ref-unknown`, `searchable-field-unknown`, both at `error`), and so does `os validate`. The object schema's own parse does not judge these names.
- `access` (Advanced, beside `sharingModel`) — a `composite` over one declared `default` select (`public` / `private`), the `lifecycle` row's shape. Absent still resolves to `public`.
- `requiredPermissions` (Advanced) — `widget: 'json'`, **never** `string-tags`: the value is a union of `string[]` and a `{read, create, update, delete}` map, and the tag widget reads a non-array as an empty list and writes the list back, which would silently replace a stored per-operation map. With the `json` hint the renderer resolves the face from the stored value's branch, so a stored map is edited as a map.
- `permission.adminScope` (System Permissions) — `widget: 'json'`, the hint every structured row on the permission form carries; the renderer derives a nested form over its six keys, and edits merge into the stored scope.

The help text states what the runtime does with each value, including what absence resolves to.

⛔ **No schema accept set moves and no export changes.** `METADATA_FORM_REGISTRY` is declared as an opaque `Readonly<Record<string, FormView>>`, so row contents were never part of the declared surface. What changes is the **form payload** `getMetaTypes()` serves and the translation keys `os i18n extract` walks — hence the regenerated `platform-objects` metadata-form bundles, whose 12 new leaves are authored in `zh-CN`, `ja-JP` and `es-ES` rather than left as extractor fills.

⛔ **The gate that would notice a missing row is NOT landed here.** The reconciliation gate's top-level `zodOnly` direction stays unwired; this change lands offers only.
