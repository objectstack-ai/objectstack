---
'@objectstack/service-automation': patch
---

fix(service-automation): a flow write node's refusal of a stored-metadata table ends on the same prescription sentence as the save-time refusal (#21624)

Clause-②: no

A flow `create_record`, `update_record` or `delete_record` node aimed at a stored-metadata table is refused twice: at save by `FlowSchema`, and at run time by the node itself, for a definition the parse never judged. Both refusals tell the author where a metadata change goes instead, and until now they said it in two spellings of one sentence: the run-time refusal named the elevation as `runAs: 'system'`, the save-time one as `runAs`, a system context.

**What changes.** The run-time refusal's message keeps its lead (the node type, what it would have done and the table, and that the write was not run) and now ends on `STORED_METADATA_BODY_PRESCRIPTION`, imported from `@objectstack/spec/kernel`: the one sentence the save-time refusal and the hook refusal also end on. Its elevation clause now reads "Elevation (`runAs`, a system context) does not change this."

**What does not change.** Which writes are refused, the refusal's `PERMISSION_DENIED` code, its guard classification (a `fault` edge does not route it) and every other object's writes are exactly as before.
