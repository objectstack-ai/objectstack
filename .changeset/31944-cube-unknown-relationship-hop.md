---
'@objectstack/service-analytics': patch
---

fix(service-analytics): a hand-authored cube member whose relationship hop names no field of the object it leaves answers 400, not a 500

Clause-②: no
Metadata-protocol: none

On a hand-authored cube (`/analytics/query`, the SQL echo, and every door through `AnalyticsService.query`), a dotted member whose relationship hop names no field of the object it leaves, such as `nope.region` on an object with no `nope`, reached the native SQL strategy, which joined a table named after the hop and answered `DATABASE_ERROR` / 500 as a `where` leaf, a dimension and a windowed time dimension. The engine-aggregate strategy answered three different 400 sentences for the same mistake.

It is now refused `INVALID_FIELD` / 400 before either strategy compiles, with one sentence on both, naming the member, the hop and the object it leaves, and listing that object's fields; the error carries `field` (the hop) and `object` (the object it leaves). A path past a valid relationship is judged hop by hop (`supplier.nope.region` names `nope` on the supplier). The check stands down where the object's field list cannot be read and on a cube whose `sql` is a statement. A hop the cube declares as a join, a relationship field (`supplier.region`), and a compiled dataset (its `include` already refuses an undeclared path) answer as before.
