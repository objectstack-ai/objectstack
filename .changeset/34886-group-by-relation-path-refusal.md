---
'@objectstack/objectql': patch
---

fix(objectql): `aggregate` refuses a `groupBy` path through relations with `INVALID_FIELD` / 400, before any driver runs

Clause-②: no
Metadata-protocol: none

`groupBy` groups by the columns of the aggregated object itself. The REST query door already refused a dotted entry such as `purchase_order.name` at ingress, but a caller that reaches `engine.aggregate` past that door — the MCP `aggregate_records` tool, a flow, a hook — handed the dotted name to the driver as a qualified column. On SQLite a path of one or two hops came back as the driver's missing-column refusal (advising a schema sync that cannot help), and three or four hops (`purchase_order.requisition.requester.department.name`) came back `500 DATABASE_ERROR`; an engine that aggregates in memory put every row into one null group.

`engine.aggregate` now refuses such an entry, in either form (`'a.b'` or `{ field: 'a.b' }`, a date bucket included), with `INVALID_FIELD` / 400 at its position (`groupBy.N` or `groupBy.N.field`), naming the path, its depth in relation hops and the depth `groupBy` serves (0 hops). No statement reaches the database. When the path starts at a relation field, the refusal says to group by that field itself (one group per related record) or to aggregate the related object.

**Unchanged.** A `groupBy` naming the relation field itself (`purchase_order`), every other `groupBy` entry, an alias that contains a dot, and the REST door's own refusal of a dotted entry. A genuine database fault still answers `DATABASE_ERROR` / 500.
