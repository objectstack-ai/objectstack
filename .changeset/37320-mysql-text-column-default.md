---
'@objectstack/driver-sql': patch
---

fix(driver-sql): a MySQL TEXT column carries its field's declared literal default

Clause-②: no
Metadata-protocol: none

- On MySQL, a text-family field (`text`, `textarea`, `markdown`, `html`, `richtext`, `code`, an unbounded `string`, …) that declares a literal `defaultValue` now gets that DEFAULT on its column. Before, the DEFAULT was silently left out of the DDL, because MySQL takes a DEFAULT on a TEXT column only in the expression form (`DEFAULT ('d')`, MySQL 8.0.13+ / MariaDB 10.2+). So adding such a field with `storage: { notNull: true }` to a table that already held rows filled every existing row with `''` instead of the declared value, and any insert that left the field out was refused (`Field '…' doesn't have a default value`). Postgres and SQLite are unchanged.
- The schema differ reads MySQL's spelling of that DEFAULT (`_utf8mb4\'d\'`) as an expression, so it no longer proposes restating a default the column already carries.
- A table an earlier release created keeps its TEXT column without a DEFAULT. Nothing reports that difference, as before. Writes through the engine still store the declared default there.
