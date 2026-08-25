---
"@objectstack/driver-sql": patch
---

`introspectUniqueConstraints` no longer reports a PRIMARY KEY column as unique on SQLite, so all three dialects now answer the same question (#11654). The SQLite arm read `PRAGMA index_list` keyed only on `unique === 1`, and SQLite materialises a non-INTEGER primary key as a unique auto-index — so a `varchar` key was reported while the Postgres and MySQL arms, which filter on `CONSTRAINT_TYPE = 'UNIQUE'`, never see a primary key at all. It also disagreed with itself: an `INTEGER PRIMARY KEY` is a rowid alias with no auto-index, so the same logical schema produced a different `isUnique` flag depending only on the declared type of its key. The arm now skips `origin: 'pk'` index rows, which closes both gaps at once (`WITHOUT ROWID` keys included).

This continues #11202's convention: `isUnique` means a *declared single-column UNIQUE constraint*. Nothing is lost — primary-key membership is still reported losslessly through `IntrospectedTable.primaryKeys` and `IntrospectedColumn.primaryKey`. The filter is on the index's `origin`, not on whether the column is in the key, so a key column that separately carries its own unique index stays flagged.

Consumer-visible effect: `introspectedSchemaToObjects` in `@objectstack/objectql` turns this flag into a drafted field's `unique: true`, so a federated-object draft (ADR-0015) taken from a SQLite table no longer gains a redundant `unique: true` on its key column that the same table drafted through Postgres or MySQL never had. Drivers extending `SqlDriver` (`driver-turso`, `driver-sqlite-wasm`) inherit the change.
