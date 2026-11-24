---
'@objectstack/driver-sql': patch
---

fix(driver-sql): on Oracle, a read scoped by a parent with a RAW(16) uuid key answers its rows on a driver that has not read the parent yet

Clause-②: no
Metadata-protocol: none

A child read whose composed `ReadableIds` scope names a federated parent with a `RAW(16)` uuid key, such as the read plugin-security derives for a `controlled_by_parent` object, answered no row on Oracle, and its negation answered every row, with no error. It recovered only once something had read the parent on that driver. The driver reads a federated table's `RAW(16)` columns from the Oracle catalog before it binds a comparand, and it read them for the door's own object only, so the parent's ids bound as text and Oracle compared them with the column's upper-case hex.

Each door that compiles a filter (`find`, `findOne`, `count`, `distinct`, `aggregate`, its measure filters and its joined parents, `updateMany`, `deleteMany`, `findWithWindowFunctions` and `analyzeQuery`) now also reads the `RAW(16)` columns of every object a composed `ReadableIds` scope in that filter names, at any depth. The parent's ids bind through `HEXTORAW`, for a list of ids and for the share-grant subquery alike. Nothing changes for any other dialect.
