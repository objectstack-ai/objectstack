---
'@objectstack/driver-mongodb': patch
---

Clause-②: no
Metadata-protocol: none

MongoDB schema sync now builds a plain index on every single-valued `master_detail` field, named `idx_FIELD`. A detail object is read by its parent (a `controlled_by_parent` permission filter reads every detail that way), and without an index on the field that read scanned the whole collection. `lookup` and `user` fields were already indexed and are unchanged.

A multi-valued field gets no index. A field that a declared `indexes[]` entry already leads with, or that is field-level `unique`, gets no extra index, because those declarations already build a read index on it. The name matches what a declared `{ fields: [FIELD] }` produces, so an author who declares that index later ends up with the same single index.

Existing deployments gain the index on their next schema sync, which runs at every boot unless `OS_SKIP_SCHEMA_SYNC=1` (or the `skipSchemaSync` option) turns it off. The sync builds the index over the documents already stored and changes no data; a later sync finds it present and does nothing. Each index adds some cost to writes on the detail collection; that cost was not measured on MongoDB.
