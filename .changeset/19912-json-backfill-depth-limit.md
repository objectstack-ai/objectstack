---
"@objectstack/driver-sql": patch
"@objectstack/driver-turso": patch
---

fix(driver-sql): the local SQLite `Field.json` storage backfill no longer turns a deeply nested array or object into a string on the next schema sync (#19912)

The backfill that converges legacy json cells on their JSON-encoded form (#12380) ran one `UPDATE … set col = json_quote(col)` over every TEXT cell SQLite's `json_valid()` rejects. `json_valid()` answers 0 for JSON nested more than 1000 levels deep (SQLite's JSON depth limit in every build this repository bundles), while the driver reads such a cell with `JSON.parse` without trouble. So a deep array written correctly through the driver was quoted into a JSON string by the next `syncSchema` / `initObjects`, and read back as a string from then on — silently, with no error.

SQL now only pre-selects the candidate cells, a page at a time. The driver's own codec decides each one: a cell `JSON.parse` reads is left exactly as stored; a cell it cannot read is a legacy plain string and is rewritten to `JSON.stringify` of that string — byte-for-byte what the old statement wrote for it. Each rewrite is a compare-and-set on the text it was decided from, so a value written concurrently is never overwritten, and a re-run over a converged table still writes nothing. This covers every local SQLite face that inherits the backfill: `SqlDriver` on better-sqlite3, `SqliteWasmDriver`, and `TursoDriver` in local mode.

The decision rule is exported from `@objectstack/driver-sql` as `recoverUnencodedJsonText(stored)`, and `@objectstack/driver-turso`'s remote codec-residue backfill now imports it instead of carrying its own copy, so the local and remote backfills apply one rule. The remote backfill's behaviour is unchanged.
