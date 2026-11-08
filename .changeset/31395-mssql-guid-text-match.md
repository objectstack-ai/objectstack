---
'@objectstack/driver-sql': patch
---

fix(driver-sql): on SQL Server, the text operators match a `uniqueidentifier` column as the lower-case text a read answers

Clause-②: no
Metadata-protocol: none

A federated SQL Server table's `uniqueidentifier` columns read back lower-case, but `$contains`, `$startsWith`, `$endsWith`, `$notContains`, `$icontains`, `$like` and `$ilike` compared SQL Server's own upper-case text of the GUID, so a lower-case fragment copied from a read matched nothing. The driver now reads which columns are `uniqueidentifier` from the remote catalog (`INFORMATION_SCHEMA.COLUMNS`) once per object, the first time a read uses a text operator on it, and matches such a column as `LOWER(CONVERT(nvarchar(36), col))`.

The case-exact operators follow the read form: `$startsWith: '3f2504e0'` now matches, and `$startsWith: '3F2504E0'`, which matched SQL Server's upper-case rendering before, now does not; use `$icontains` / `$ilike` to match either case. Equality and `$in` are unchanged (SQL Server compares GUIDs by value). `nvarchar` columns, and every other dialect, compile exactly as before.
