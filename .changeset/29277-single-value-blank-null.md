---
'@objectstack/objectql': patch
'@objectstack/core': patch
'@objectstack/metadata-protocol': patch
---

fix(objectql): a cleared optional single-value `select` or `lookup` stores `null`, so a second record cleared on a unique one is no longer refused `409 UNIQUE_VIOLATION`

Clause-②: yes (widening)
Metadata-protocol: none

A cleared `select`, `lookup` or single file field sent as `''` was stored as sent. `''` is neither an option code, a record id nor a file id, so it held no value, yet it was one to the store and to the `is_empty` filter: on a unique column the second record cleared was refused "A record with this value already exists", and on every column the cleared record did not match `is_empty` (`$empty`), whose ruled table reads only `null` as empty on these types.

- **Now.** The engine's write door (`insert`, `insertMany`, `update` by id and by predicate, and the `validate` dry run; every REST, batch, upsert and import door reaches it) stores exactly `''` as `null` on every optional column the `$empty` table puts on its `null_only` row whose value is one string: the option types (`select`, `radio`), the reference types (`lookup`, `master_detail`, `user`, `tree`) and the file references (`image`, `file`, `avatar`, `video`, `audio`). Unique or not. Object- and array-valued types (`json`, `composite`, `location`, …) and the engine-owned `formula` / `autonumber` keep what they store.
- **Read shape.** Such a field cleared from now on reads back `null`, not `''`. It matches `is_empty` / `$empty: true`, `$null: true` and `field = null`, and no longer matches `field = ''`.
- **Unchanged.** The `$empty` table itself. A `required` field given `''` is refused `required` as before, also when it declares a `defaultValue`. Whitespace is a value. A `multiple: true` option or reference column keeps what it stores. A real duplicate is still `409 UNIQUE_VIOLATION`.
- **Defaults.** An optional field that declares a `defaultValue` now takes it on insert when sent `''`, exactly as when sent `null`.
- **Rows already stored.** Existing `''` values are not migrated by this change; they keep answering as a value (`$empty: false`, `field = ''`) until a data step cleans them.
- **Seed replay.** A seed that writes `''` on such a column, or on any column whose blank the door already stored as `null` (an optional unique text column, a number / boolean / date column), is compared in that stored form, so replaying it is no longer a change on every boot. Before, the replay compared the seed's `''` with the stored `null` and rewrote the row each time (bumping `updated_at`).
- **New export.** `@objectstack/core` exports the rule itself, `blankAsNullColumns` and `blankStorageForm` (with `ENGINE_LIFECYCLE_COLUMNS`), which the write door and the seed loader both read.
