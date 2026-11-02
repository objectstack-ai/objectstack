---
'@objectstack/objectql': patch
---

fix(objectql): a cleared optional single-value `select` or `lookup` stores `null`, so a second record cleared on a unique one is no longer refused `409 UNIQUE_VIOLATION`

Clause-②: no
Metadata-protocol: none

A cleared `select` or `lookup` sent as `''` was stored as sent. `''` is neither an option code nor a record id, so it held no value, yet it was one to the store and to the `is_empty` filter: on a unique column the second record cleared was refused "A record with this value already exists", and on every column the cleared record did not match `is_empty` (`$empty`), whose ruled table reads only `null` as empty on these types.

- **Now.** The engine's write door (`insert`, `insertMany`, `update` by id and by predicate, and the `validate` dry run; every REST, batch, upsert and import door reaches it) stores exactly `''` as `null` on every optional column whose type is a single-value option or reference type on the `$empty` table's `null_only` row: `select`, `radio`, `lookup`, `master_detail`, `user`, `tree`. Unique or not.
- **Read shape.** Such a field cleared from now on reads back `null`, not `''`. It matches `is_empty` / `$empty: true`, `$null: true` and `field = null`, and no longer matches `field = ''`.
- **Unchanged.** The `$empty` table itself. A `required` field given `''` is refused `required` as before, also when it declares a `defaultValue`. Whitespace is a value. A `multiple: true` option or reference column keeps what it stores. A real duplicate is still `409 UNIQUE_VIOLATION`.
- **Defaults.** An optional field that declares a `defaultValue` now takes it on insert when sent `''`, exactly as when sent `null`.
- **Rows already stored.** Existing `''` values are not migrated by this change; they keep answering as a value (`$empty: false`, `field = ''`) until a data step cleans them.
