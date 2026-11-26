---
'@objectstack/driver-sql': patch
---

fix(driver-sql): `distinct()` and aggregate group keys read a stored text `'0'` / `'false'` boolean as `false`, as `find()` does

Clause-②: no
Metadata-protocol: none

A declared `Field.boolean` / `Field.toggle` column can hold the text `'0'`, `'1'`, `'true'` or `'false'` on SQLite: a column whose type changed to boolean without a rebuild keeps TEXT affinity, and rows a boot has not converged yet still hold the legacy text. Record reads presented those values as their boolean, but `distinct()` and an `aggregate()` group key presented them as `Boolean(value)`, so a stored `'0'` or `'false'` showed as `true`. A group-by over a yes/no field then counted un-ticked rows in a `true` bucket, and `distinct()` could answer `[true]` for a column with no ticked row.

Both doors now present a boolean through the same function the record read uses: `0`, `'0'` and `'false'` read as `false`; `1`, `'1'` and `'true'` read as `true`. Any other value reads as it did. Postgres is unchanged, since it stores a real boolean. `min` / `max` / `sum` / `avg` over a boolean still answer a number, as before. No metadata key, value or default changes.
