---
'@objectstack/driver-sql': patch
---

fix(driver-sql): an array insert of more than 500 rows no longer throws on SQLite

Clause-②: no
Metadata-protocol: none

`engine.insert(object, rows)` hands an array to the driver's `bulkCreate`, which sent the whole batch as one INSERT. SQLite refuses one INSERT past either of two bounds: 500 rows (`too many terms in compound SELECT`) or 32766 bound values, rows times columns (`too many SQL variables`, reached first on an object of more than 65 columns). So a batch past them threw on SQLite and on no other dialect. A REST `createMany` reaches it when `batch.maxBatchSize` is raised above 500 (it allows up to 1000), and so does any in-process `insert` of a larger array.

On SQLite, a batch past either bound now goes as several INSERTs, in row order, inside one transaction (a savepoint of the caller's transaction when one is passed). The batch keeps every guarantee it had: all rows land or none do, the auto-number values are reserved once for the whole batch before the transaction opens and are dealt in row order, and a failed batch burns its reserved numbers exactly as a failed single INSERT does. A batch within both bounds is still sent as one INSERT with no transaction, and other dialects are unchanged.

What to do: nothing. Callers that split their own arrays to stay under 500 rows on SQLite may stop.
