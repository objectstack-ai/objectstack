---
'@objectstack/driver-sql': patch
---

fix(driver-sql): a boolean field declaring the string `'false'` / `'true'` as its default no longer reads as schema drift on SQLite

Clause-②: no
Metadata-protocol: none

The schema sync stores a boolean column's literal DEFAULT in the boolean's own spelling: on SQLite, `'0'` for `defaultValue: 'false'` and `'1'` for `defaultValue: 'true'`, on both Turso faces. The drift differ compared a string declaration as text, so such a column was reported as `default_mismatch` / `set_column_default` on every drift read (the boot drift warning and `os migrate plan`), and `os migrate apply` wrote the same DEFAULT again without clearing the entry. On a `boolean` or `toggle` column the differ now reads the exact strings `'true'` and `'false'` as the booleans they spell. A column whose DEFAULT really differs from the declaration is still reported, and one apply clears it.
