---
'@objectstack/core': patch
---

fix(core): a banned user's assigned-work count and hand-over now include the platform's injected `owner_id`

Clause-②: no
Metadata-protocol: none

The field picker behind the assigned-work count and the bulk hand-over skipped every `system: true` user reference. The `owner_id` the platform injects on every business object is `system: true` (it is a platform column) but not `readonly` (ownership is transferable), so it was skipped: on any object whose author had not declared `owner_id` themselves, the records a banned user owned were counted as zero and never handed over. The picker now leaves out `readonly` user references only, so `created_by` / `updated_by` stay out and the injected `owner_id` is counted and handed over. Platform tables (`sys_*`), `managedBy` objects and injected columns with no storage stay excluded as before.
