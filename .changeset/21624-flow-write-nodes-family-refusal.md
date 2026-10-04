---
'@objectstack/service-automation': patch
---

fix(service-automation): a flow's `create_record`, `update_record` and `delete_record` nodes refuse a stored-metadata table as their target (#21624)

Clause-②: no

The two stored-metadata tables (the current metadata bodies and their version history) have one writer for app-authored work: the metadata protocol, where a change is validated and its provenance is recorded. A flow's write nodes wrote those tables directly, outside it. Under `runAs: 'system'` the write ran elevated, so the security middleware never judged it; under `runAs: 'user'` only a composition with the security plugin refused it, as a routable runtime failure with no code. A write node's `filter` was also evaluated against the stored rows, so whether the write acted answered a predicate over the stored body.

**What changes.** A `create_record`, `update_record` or `delete_record` node whose `objectName` is either table is refused before it resolves its filter or its field values and before any engine write, under either run identity. The refusal names the metadata API as the way to change metadata and carries the standard `PERMISSION_DENIED` code, the code the data door answers a non-platform principal's write to these tables with. It is a guard failure: the run fails, nothing downstream of the node runs, and a `fault` edge does not route it. A `try_catch` catch region reads the code on `{$error.code}`. Metadata is changed through the metadata API (`PUT /api/v1/meta/:type/:name`), never through a flow's data nodes.

**What does not change.** Every other object is created, updated and deleted exactly as before. `get_record` keeps serving these tables projected and keyed.
