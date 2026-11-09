---
'@objectstack/spec': minor
---

feat(spec): an Oracle `RAW(16)` uuid column backs a `lookup`, `master_detail` or `user` field exactly again; its `text` pairing stays lossy

Clause-②: yes (widening)
Metadata-protocol: semantic

`isCompatible(rawType, fieldType, 'oracle')` now answers `true` instead of `'lossy'` for a `RAW(16)` column against `lookup`, `master_detail` and `user`. The SQL driver binds a comparison value, a written value and a by-id key for a `RAW(16)` column as `HEXTORAW(?)`, so a reference field over a `SYS_GUID()` key is filtered, written and resolved by the uuid string it reads. Before that bind existed, every pairing over the column was judged `'lossy'`.

What a caller sees:

- **Draft and validation.** A field of those three types over a `RAW(16)` column is no longer reported as a `type_mismatch` warning by object validation.
- **`text` is unchanged.** A `text` field over a `RAW(16)` column still answers `'lossy'`, and a draft still marks such a column for review. Its pattern operators (`$contains`, `$startsWith`, `$like` and the rest) are sent as text patterns, and Oracle compares them with the column's hex text (32 upper-case digits, no hyphens), not with the uuid string a read returns.
- **Other dialects and other `RAW` widths** answer as before.
