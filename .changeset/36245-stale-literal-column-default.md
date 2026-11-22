---
'@objectstack/driver-sql': patch
'@objectstack/driver-turso': patch
---

Clause-②: no
Metadata-protocol: none

A column's literal DEFAULT now follows the field's declaration on a table an earlier release created, not only on a fresh database. When a field drops its literal `defaultValue`, schema drift reports the column's leftover DEFAULT (`drop_column_default`); when the declared literal changes, it reports the old one (`set_column_default`). Both are `safe`: dev auto-reconcile, a publish of the object, the artifact-pinned boot and `os migrate apply` apply them, in place on PostgreSQL and MySQL and by the table rebuild on SQLite. Before, the table kept the old DEFAULT, every insert that left the field unset stored the old value where a new database stored the declared one (or nothing), and `os migrate plan` showed nothing. Stored rows are never rewritten, and a DEFAULT that is an expression (a `NOW()` default, a sequence) is left alone. A plain production boot still alters no existing column: it logs the entry, and `os migrate apply` applies it.
