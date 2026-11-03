---
'@objectstack/objectql': patch
'@objectstack/core': patch
---

fix(objectql): a cleared optional multi-value field stores `null`, so a second record cleared on a unique one is no longer refused `409 UNIQUE_VIOLATION`

Clause-②: yes (widening)
Metadata-protocol: none

This executes ruling A on #29343 (record 6591577985), which amends the #9447 sentence "an emptied multi-value lookup reads back as `[]`, never `null`" for optional columns: a cleared optional multi-value field is stored as `null`, the same as one never set. The spec half (the `multiple` and `required` doc blocks of `FieldSchema`) landed separately; this is the runtime half. It is a widening (Clause-②): a write that used to be refused `409` now lands, and no write that used to land is refused.

A cleared `multiselect`, `checkboxes` or `tags` field, or a `select`, `radio`, `lookup`, `user`, `file` or `image` field with `multiple: true`, sent as `[]` was stored as the empty list (the JSON text `[]` on SQL), and sent as `''` was stored as the JSON text `""`. Neither holds a member, yet each was a value to the store: on a unique column, or a column in a unique index, the second record cleared was refused "A record with this value already exists".

- **Now.** The engine's write door (`insert`, `insertMany`, `update` by id and by predicate, and the `validate` dry run; every REST, batch, upsert and import door reaches it) stores `[]`, or exactly `''`, as `null` on every optional column the `$empty` table puts on its `multi_value` row. Unique or not. A non-empty list is stored as sent.
- **Read change.** An optional multi-value field cleared from now on reads back `null`, not `[]`, whoever clears it: an API or form write of `[]` or `''`, and the `set_null` cascade repair that removes the last member of a multi-value reference (it used to leave `[]`). A reader that branched on `Array.isArray` alone reads `null` and `[]` alike as empty. It still matches `is_empty` / `$empty: true` (the table reads `null` and `[]` as empty on that row), and now also matches `$null: true` and `field = null`.
- **Unchanged.** The `$empty` table itself. A `required` multi-value field given `[]` or `''` is refused `required` as before, also when it declares a `defaultValue`. Whitespace is a value. A real duplicate is still `409 UNIQUE_VIOLATION`.
- **Defaults.** An optional multi-value field that declares a `defaultValue` now takes it on insert when sent `[]` or `''`, exactly as when sent `null`.
- **Rows already stored.** Existing `[]` and `""` values are not migrated by this change. They keep their stored form, still answer `$empty: true`, and still collide with each other on a unique column until a data step cleans them. `os migrate blank-single-values` does not touch these columns.
- **Seed replay.** A seed that writes `[]` or `''` on such a column is compared in the form the door stores it, `null`. A row that already stores `[]` is rewritten to `null` once on the next replay, then no longer changes.
- **Export.** `@objectstack/core`'s `BlankAsNullReach` gains the member `'emptyList'`, which `blankAsNullColumns` returns for these columns and `blankStorageForm` reads.
