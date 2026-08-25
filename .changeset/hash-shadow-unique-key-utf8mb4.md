---
'@objectstack/driver-sql': minor
---

driver-sql (MySQL): carry an over-long UNIQUE index on a hash-shadow column

On utf8mb4 InnoDB a key part holds at most 3072 bytes (768 characters), so a
full-value UNIQUE index over a longer column is inexpressible — an OAuth access
token that is a multi-KB JWT cannot be made keyable by any declared bound.
Measured on live MySQL 8.0.46, 7 of 44 exported platform objects failed
`syncSchema` outright and landed registered with their declared uniqueness
absent (Postgres 16.13: 0 of 44).

Such a UNIQUE index is now carried by a driver-owned `<index>__hash` column — a
`STORED GENERATED` `VARBINARY(32)` holding the full, untruncated SHA-256 of the
key values — with the unique index on that column. Uniqueness is still enforced
over the whole value: distinct values sharing a long prefix are both accepted
(the property that ruled out prefix-unique indexes), NULLs stay distinct, and a
composite tuple containing NULL conflicts with nothing.

The shadow is created only *after* the server refuses the direct index, so the
dialect divergence is selected by the error code rather than by a dialect check:
Postgres and SQLite are byte-identical to before. Non-unique indexes are
deliberately left refused — an index over a digest accelerates no lookup the
planner can reach.
