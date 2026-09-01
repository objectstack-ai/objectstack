---
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
---

Canonicalise driver-materialised timestamps at the metadata adapter boundaries

`MetadataItem.authoredAt` is declared `z.string()` ('ISO-8601 timestamp') and
`MetadataStats.mtime` is declared `z.string().datetime()`, but three producers
adapted a driver row into those declared types without converting the value.
`created_at` / `updated_at` are builtin audit columns and `recorded_at` is a
declared `Field.datetime`; `SqlDriver#formatOutput` repairs both only inside its
`if (this.isSqlite)` arm, so on Postgres and MySQL a JS `Date` landed in a field
every consumer reads as a `string`.

`SysMetadataRepository#get` / `#getByHash` and `DatabaseLoader#stat` now emit
canonical ISO-8601 text on every dialect, matching the sibling producers that
already spelled it correctly. Values that were already canonical (SQLite) pass
through byte-identically.
