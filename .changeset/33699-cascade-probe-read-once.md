---
'@objectstack/objectql': patch
---

perf(objectql): a cascade delete reads its first relation's dependents once, not twice

Clause-②: no
Metadata-protocol: none

A delete that cascades first collects every row it will remove, then walks the relations and deletes them. The walk asked the collection's dependents probe again, with nothing written in between: the same relation, the same parent ids, the same system-identity read. It now takes the collection's answer for each probe it repeats, until its own first write. A cascaded child's delete or a `set_null` clear runs hooks, and a hook may write a row the next probe must see, so every probe after that first write reads as before.

Deleting a record with one cascading relation runs one SQL statement fewer: measured locally on the SQL-performance bench, one opportunity with 10 line items went from 58 to 57 statements on SQLite and on PostgreSQL 16. What a delete hook, the caller and a restore see is unchanged; an `afterFind` hook on the child object is called for one system-identity read fewer. The recycle-bin snapshot keeps its own read, because it stores the rows as the database holds them, and the probe's rows come through the engine's read.
