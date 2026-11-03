---
'@objectstack/objectql': patch
---

fix(objectql): a cleared optional unique text field stores `null`, so a second record cleared is no longer refused `409 UNIQUE_VIOLATION`

Clause-②: no
Metadata-protocol: none

A cleared text input is sent as `''`, and the write path stored it as sent. Every unique constraint the drivers build is NULL-distinct, so `null` never collides, but `''` is a value: the first record whose SKU (tax id, employee number, …) was cleared saved, and the second was refused "A record with this value already exists" although neither held a value. Measured on SQLite and the memory driver: two `''` rows collide, two `null` rows do not.

- **Now.** The engine's write door, which `insert`, `insertMany`, `update` (by id and by predicate) and the dry run (`validate`) apply before anything else reads the payload, stores exactly `''` as `null` on a column that is text-like (`text`, `textarea`, `email`, `url`, `phone`, `markdown`, `html`, `richtext`, `code`, `color`, `signature`, `qrcode`), not `required`, and covered by a unique constraint: the field's own `unique`, or membership in a declared `indexes[]` entry carrying `unique`. Every REST, batch, upsert and import door reaches the engine through those methods.
- **Unchanged.** A `required` field given `''` is refused `required` exactly as before, also when it declares a `defaultValue`. A real duplicate is still `409 UNIQUE_VIOLATION`. Whitespace is a value and is stored as sent. `password` and `secret` keep their `''` refusal. A text column no unique constraint covers keeps storing `''`. (Optional single-value `select` / `lookup` columns store a cleared `''` as `null` too, unique or not: a separate change in this release.)
- **Defaults.** An optional unique field that declares a `defaultValue` now takes it on insert when sent `''`, exactly as when sent `null`.
- **Rows already stored.** Existing `''` values are not migrated. They keep matching a `field = ''` filter; a newly cleared row matches `$null: true` instead. The `is_empty` filter (`$empty`) matches both, as before. A newly cleared row no longer collides with a stored `''`.
