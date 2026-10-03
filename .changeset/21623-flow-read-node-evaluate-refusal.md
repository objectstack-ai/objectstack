---
'@objectstack/service-automation': patch
---

fix(service-automation): a flow's `get_record` node refuses a filter that evaluates the stored-metadata tables' body or content hash, as the generic data door does (#21623)

Clause-②: no

The two stored-metadata tables (the current metadata bodies and their version history) hold each body as stored, credential material included, and content-hash columns computed over it. A flow's `get_record` node now serves those rows projected and keyed, but it still ran its `filter` against the stored values as written, under either run identity (`runAs: 'system'` and `runAs: 'user'`). A filter over the body column or a content-hash column was evaluated row by row, so whether a row came back answered the filter: a predicate over the withheld values. The generic data door refuses those filters before its query runs.

**What changes.** When the node reads either table, it judges its filter the way the data door judges the same filter, before the data engine is asked, on both branches (one row, and a row list when `limit` is above 1). The columns the filter reads are collected after interpolation, so a condition that a `{token}` supplies is judged too. A filter that reads the body column, or a content-hash column (the history table's parent hash and change note included), refuses the node with the data door's own message and error code, `INVALID_FIELD`. The refusal is a guard failure: the run fails, nothing downstream of the node runs, and a `fault` edge does not route it. A `try_catch` catch region reads the code on `{$error.code}`. To read a stored-metadata row from a flow, filter by `name`, `type`, `state` or another scalar column.

**What does not change.** A filter over scalar columns is served as before: the body projected and the hash keyed. Every other object is filtered and read exactly as before, including columns that share these names. The write nodes are unchanged. The node consumes the data door's own functions from `@objectstack/metadata-protocol` (`collectStoredMetadataFilterFields`, `storedMetadataBodyPredicateRefusal`, `storedMetadataHashEvaluateRefusal`) and keeps no copy of them.
