---
'@objectstack/driver-sql': patch
---

fix(driver-sql): paged reads of a federated object keyed through `external.columnMap` are a partition, ordered by that key, on every dialect

Clause-②: no
Metadata-protocol: none

A paged `find()` gets a unique tie-breaker so its pages partition the result set (objectui#3106, #4363). That tie-breaker was imposed only on tables this driver created. A federated object got none, even when its `external.columnMap` names the remote key column (`T_NO: 'id'`), which is the column the by-id doors already address. Ties within the caller's sort were not ordered at all, and an unsorted paged read had no order. SQLite hid this, because a heap scan returns rowid order every time. On Oracle 23ai ties reshuffle between executions, and a page walk repeated some rows and never served others on every `PAGINATION_CASES` and `PAGINATION_UNORDERED_CASES` row.

A paged read of such an object is now ordered by the mapped key after the caller's own keys, the same rule a managed table follows. A federated object with no mapped key keeps the old behaviour exactly: no column is guessed, and the existing warning still names the gap.
